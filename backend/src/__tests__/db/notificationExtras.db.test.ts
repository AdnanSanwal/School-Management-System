/**
 * Notification extras: per-person mutes, school quiet hours, targeted and scheduled office
 * broadcasts with a delivery report, and the clean-up of old notifications.
 *   RUN_DB_TESTS=1 npx jest src/__tests__/db/notificationExtras
 */
import 'dotenv/config';
import request from 'supertest';
import app from '../../app';
import { basePrisma } from '../../config/database';
import { connectRedis } from '../../config/redis';
import { runWithTenant } from '../../config/tenancy';
import { notify } from '../../utils/notify';
import { BATCH, drainOnce, transport, type ExpoMessage } from '../../utils/notificationDelivery';
import { cleanUpNotifications, quietUntil } from '../../utils/notificationRules';
import { sendBroadcast, sendDueBroadcasts } from '../../modules/notifications/broadcasts';
import { createTestSchool } from './helpers';

const d = process.env.RUN_DB_TESTS ? describe : describe.skip;
jest.setTimeout(240_000);

describe('quiet hours (clock arithmetic)', () => {
  const school = (start: string | null, end: string | null, timezone = 'Asia/Karachi') => ({ quietHoursStart: start, quietHoursEnd: end, timezone });
  const at = (iso: string) => new Date(iso);

  it('overnight: 21:00 to 07:00 school time', () => {
    // 18:30 UTC = 23:30 in Karachi: inside, ends 07:00 Karachi = 02:00 UTC next day.
    expect(quietUntil(school('21:00', '07:00'), at('2026-11-16T18:30:00Z'))?.toISOString()).toBe('2026-11-17T02:00:00.000Z');
    // 01:00 UTC = 06:00 in Karachi: still inside, one hour to go.
    expect(quietUntil(school('21:00', '07:00'), at('2026-11-17T01:00:00Z'))?.toISOString()).toBe('2026-11-17T02:00:00.000Z');
    // 02:00 UTC = 07:00 in Karachi: over.
    expect(quietUntil(school('21:00', '07:00'), at('2026-11-17T02:00:00Z'))).toBeNull();
    // Midday.
    expect(quietUntil(school('21:00', '07:00'), at('2026-11-16T08:00:00Z'))).toBeNull();
  });

  it('same-day window, and off when not set', () => {
    expect(quietUntil(school('13:00', '15:00', 'UTC'), at('2026-11-16T14:10:00Z'))?.toISOString()).toBe('2026-11-16T15:00:00.000Z');
    expect(quietUntil(school('13:00', '15:00', 'UTC'), at('2026-11-16T15:00:00Z'))).toBeNull();
    expect(quietUntil(school(null, null), at('2026-11-16T18:30:00Z'))).toBeNull();
    expect(quietUntil(school('21:00', null), at('2026-11-16T18:30:00Z'))).toBeNull();
    expect(quietUntil(school('21:00', '07:00', 'Not/AZone'), at('2026-11-16T18:30:00Z'))).toBeNull();
  });
});

d('Notification extras (database)', () => {
  let t: Awaited<ReturnType<typeof createTestSchool>>;
  let other: Awaited<ReturnType<typeof createTestSchool>>;
  type TestUser = Awaited<ReturnType<Awaited<ReturnType<typeof createTestSchool>>['user']>>;
  const u: Record<string, TestUser> = {};
  const ids: Record<string, string> = {};
  const real = { ...transport };
  const env = { push: process.env.PUSH_DISABLED, keep: process.env.NOTIFICATION_RETENTION_DAYS };
  let sent: ExpoMessage[] = [];

  const inSchool = <T>(fn: () => Promise<T>) => runWithTenant(t.school.id, fn);
  const drainAll = async () => { let n = 0; let got: number; do { got = await drainOnce({ schoolId: t.school.id }); n += got; } while (got === BATCH); return n; };
  const latest = async (userId: string) => (await basePrisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }))[0];
  const school = (data: object) => basePrisma.school.update({ where: { id: t.school.id }, data });
  const api = (who: TestUser) => {
    const h = { Authorization: `Bearer ${who.token}` };
    return {
      get: (url: string) => request(app).get(`/api/v1${url}`).set(h),
      put: (url: string, body: object = {}) => request(app).put(`/api/v1${url}`).set(h).send(body),
      post: (url: string, body: object = {}) => request(app).post(`/api/v1${url}`).set(h).send(body),
      patch: (url: string, body: object = {}) => request(app).patch(`/api/v1${url}`).set(h).send(body),
      del: (url: string) => request(app).delete(`/api/v1${url}`).set(h).send({}),
    };
  };
  /** HH:MM, `hours` from now, on the UTC clock (the test school runs on UTC). */
  const clock = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString().slice(11, 16);

  beforeAll(async () => {
    process.env.PUSH_DISABLED = 'false';
    await connectRedis();
    t = await createTestSchool('nx');
    other = await createTestSchool('nx-other');
    await school({ timezone: 'UTC' });
    for (const role of ['OWNER', 'PRINCIPAL', 'ADMIN', 'TEACHER'] as const) u[role] = await t.user(role);
    for (const name of ['parentA', 'parentA2', 'parentB']) u[name] = await t.user('PARENT', name);
    u.studentA = await t.user('STUDENT', 'studentA');

    // Class 5 with sections A and B; one pupil in each, each with a parent login.
    const cls = await basePrisma.class.create({ data: { schoolId: t.school.id, name: 'Class 5', level: 5 } });
    const secA = await basePrisma.section.create({ data: { schoolId: t.school.id, classId: cls.id, name: 'A' } });
    const secB = await basePrisma.section.create({ data: { schoolId: t.school.id, classId: cls.id, name: 'B' } });
    const pupil = (name: string, sectionId: string, userId?: string) => basePrisma.student.create({
      data: { schoolId: t.school.id, admissionNo: `${t.code}-${name}`.slice(0, 30), name, admissionDate: new Date('2026-04-01'), sectionId, userId },
    });
    const a = await pupil('Ali', secA.id, u.studentA.id);
    const a2 = await pupil('Sara', secA.id);
    const b = await pupil('Bilal', secB.id);
    const link = async (studentId: string, parent: TestUser) => {
      const g = await basePrisma.guardian.create({ data: { schoolId: t.school.id, name: parent.name, phone: '03001234567', userId: parent.id } });
      await basePrisma.studentGuardian.create({ data: { schoolId: t.school.id, studentId, guardianId: g.id } });
    };
    await link(a.id, u.parentA);
    await link(a2.id, u.parentA2);
    await link(b.id, u.parentB);
    Object.assign(ids, { cls: cls.id, secA: secA.id, secB: secB.id, ali: a.id, bilal: b.id });
    const foreign = await basePrisma.class.create({ data: { schoolId: other.school.id, name: 'Elsewhere', level: 1 } });
    ids.foreignClass = foreign.id;

    // parentA and the principal have the app on a phone.
    await basePrisma.deviceToken.createMany({ data: [
      { schoolId: t.school.id, userId: u.parentA.id, token: `ExponentPushToken[${t.code}-pa]`, platform: 'android' },
      { schoolId: t.school.id, userId: u.PRINCIPAL.id, token: `ExponentPushToken[${t.code}-pr]`, platform: 'ios' },
    ] });
    transport.expo = async (messages) => { sent.push(...messages); return messages.map(() => 'ok' as const); };
    transport.web = async () => 'ok';
  });
  afterAll(async () => {
    Object.assign(transport, real);
    process.env.PUSH_DISABLED = env.push;
    if (env.keep === undefined) delete process.env.NOTIFICATION_RETENTION_DAYS; else process.env.NOTIFICATION_RETENTION_DAYS = env.keep;
    await t.destroy();
    await other.destroy();
  });
  beforeEach(async () => {
    await basePrisma.notification.deleteMany({ where: { schoolId: t.school.id } });
    await basePrisma.broadcast.deleteMany({ where: { schoolId: t.school.id } });
    await school({ quietHoursStart: null, quietHoursEnd: null });
    await basePrisma.user.updateMany({ where: { schoolId: t.school.id }, data: { mutedNotifications: [] } });
    sent = [];
  });

  // ─── Mutes ───

  describe('a person can mute routine types', () => {
    it('lists what applies to them; urgent alerts and office messages cannot be muted', async () => {
      const mine = (await api(u.parentA).get('/notifications/preferences')).body.data.types;
      const of = (type: string) => mine.find((x: any) => x.type === type);
      expect(of('DIARY_POSTED')).toMatchObject({ canMute: true, muted: false, label: 'Diary and homework' });
      expect(of('ATTENDANCE_ABSENT')).toMatchObject({ canMute: false, urgent: true });
      expect(of('BROADCAST')).toMatchObject({ canMute: false });
      expect(of('PAYROLL_APPROVAL')).toBeUndefined(); // staff matters are not shown to parents
      expect((await api(u.PRINCIPAL).get('/notifications/preferences')).body.data.types.some((x: any) => x.type === 'PAYROLL_APPROVAL')).toBe(true);

      const saved = await api(u.parentA).put('/notifications/preferences', { muted: ['DIARY_POSTED', 'ATTENDANCE_ABSENT', 'BROADCAST', 'NOT_A_TYPE'] });
      expect(saved.body.data.muted).toEqual(['DIARY_POSTED']);
      expect((await api(u.parentA).get('/notifications/preferences')).body.data.types.find((x: any) => x.type === 'DIARY_POSTED').muted).toBe(true);
    });

    it('a muted type is still in the list, but is not pushed; other types and other people are', async () => {
      await api(u.parentA).put('/notifications/preferences', { muted: ['DIARY_POSTED'] });
      await inSchool(() => notify([u.parentA.id, u.PRINCIPAL.id], { type: 'DIARY_POSTED', title: 'Homework', body: 'Maths' }));
      expect(await latest(u.parentA.id)).toMatchObject({ deliveryState: 'NONE', deliverAfter: null });
      await drainAll();
      expect(sent.map((m) => m.to)).toEqual([`ExponentPushToken[${t.code}-pr]`]);
      // Still in the bell, still counted.
      expect((await api(u.parentA).get('/notifications')).body.data[0].title).toBe('Homework');
      expect((await api(u.parentA).get('/notifications/unread-count')).body.data.count).toBe(1);

      sent = [];
      await inSchool(() => notify([u.parentA.id], { type: 'ATTENDANCE_ABSENT', title: 'Absent today', body: 'Ali' }));
      await inSchool(() => notify([u.parentA.id], { type: 'NOTICE_PUBLISHED', title: 'Notice', body: 'PTM' }));
      await drainAll();
      expect(sent.map((m) => m.title).sort()).toEqual(['Absent today', 'Notice']);
    });

    it('un-muting restores the push', async () => {
      await api(u.parentA).put('/notifications/preferences', { muted: ['DIARY_POSTED'] });
      await api(u.parentA).put('/notifications/preferences', { muted: [] });
      await inSchool(() => notify([u.parentA.id], { type: 'DIARY_POSTED', title: 'Homework', body: 'Science' }));
      await drainAll();
      expect(sent).toHaveLength(1);
    });
  });

  // ─── Quiet hours ───

  describe('school quiet hours', () => {
    it('the office sets them; both times or neither', async () => {
      expect((await api(u.ADMIN).patch('/school', { quietHoursStart: '21:00' })).status).toBe(422);
      expect((await api(u.ADMIN).patch('/school', { quietHoursStart: '21:00', quietHoursEnd: '21:00' })).status).toBe(422);
      expect((await api(u.ADMIN).patch('/school', { quietHoursStart: '9pm', quietHoursEnd: '07:00' })).status).toBe(422);
      expect((await api(u.TEACHER).patch('/school', { quietHoursStart: '21:00', quietHoursEnd: '07:00' })).status).toBe(403);
      const ok = await api(u.ADMIN).patch('/school', { quietHoursStart: '21:00', quietHoursEnd: '07:00' });
      expect(ok.body.data).toMatchObject({ quietHoursStart: '21:00', quietHoursEnd: '07:00' });
      expect((await api(u.ADMIN).patch('/school', { quietHoursStart: null, quietHoursEnd: null })).body.data.quietHoursStart).toBeNull();
    });

    it('a routine alert raised in quiet hours waits until they end; urgent ones and office messages do not', async () => {
      await school({ quietHoursStart: clock(-1), quietHoursEnd: clock(2) });
      await inSchool(() => notify([u.parentA.id], { type: 'DIARY_POSTED', title: 'Homework', body: 'Late post' }));
      await inSchool(() => notify([u.parentA.id], { type: 'ATTENDANCE_ABSENT', title: 'Absent today', body: 'Ali' }));
      await inSchool(() => notify([u.parentA.id], { type: 'BROADCAST', title: 'From the office', body: 'Gates close early' }));

      const held = (await basePrisma.notification.findFirst({ where: { userId: u.parentA.id, type: 'DIARY_POSTED' } }))!;
      const wait = held.deliverAfter!.getTime() - Date.now();
      expect(wait).toBeGreaterThan(100 * 60_000); // about two hours
      expect(wait).toBeLessThan(121 * 60_000);
      // It is in the app straight away all the same.
      expect((await api(u.parentA).get('/notifications/unread-count')).body.data.count).toBe(3);

      await drainAll();
      expect(sent.map((m) => m.title).sort()).toEqual(['Absent today', 'From the office']);
      expect(held.deliveryState).toBe('PENDING');

      // Morning comes.
      sent = [];
      await basePrisma.notification.update({ where: { id: held.id }, data: { deliverAfter: new Date(Date.now() - 1000) } });
      await drainAll();
      expect(sent.map((m) => m.title)).toEqual(['Homework']);
    });

    it('outside quiet hours nothing waits', async () => {
      await school({ quietHoursStart: clock(2), quietHoursEnd: clock(5) });
      await inSchool(() => notify([u.parentA.id], { type: 'DIARY_POSTED', title: 'Homework', body: 'Daytime' }));
      await drainAll();
      expect(sent).toHaveLength(1);
    });
  });

  // ─── Broadcasts ───

  describe('office broadcasts', () => {
    const compose = (who: TestUser, body: object) => api(who).post('/notifications/broadcasts', { title: 'Sports day', message: 'Friday, 9am, white kit.', ...body });
    const got = async (broadcastId: string) => (await basePrisma.notification.findMany({ where: { broadcastId }, select: { userId: true } })).map((n) => n.userId).sort();
    const users = (...names: string[]) => names.map((n) => u[n].id).sort();

    it('needs the right to send messages, an audience, and this school\'s own classes', async () => {
      expect((await compose(u.TEACHER, { audience: { everyone: true } })).status).toBe(403);
      expect((await compose(u.parentA, { audience: { everyone: true } })).status).toBe(403);
      expect((await compose(u.PRINCIPAL, { audience: {} })).status).toBe(422);
      expect((await compose(u.PRINCIPAL, { audience: { classIds: [ids.foreignClass] } })).status).toBe(422);
      expect((await compose(u.PRINCIPAL, { audience: { everyone: true }, scheduledAt: new Date(Date.now() - 60_000).toISOString() })).status).toBe(422);
      expect(await basePrisma.broadcast.count({ where: { schoolId: t.school.id } })).toBe(0);
    });

    it('one section: only that section\'s families', async () => {
      expect((await api(u.PRINCIPAL).post('/notifications/broadcasts/preview', { audience: { sectionIds: [ids.secA] } })).body.data.recipients).toBe(3);
      const res = await compose(u.PRINCIPAL, { audience: { sectionIds: [ids.secA] } });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ status: 'SENT', recipients: 3 });
      expect(await got(res.body.data.id)).toEqual(users('parentA', 'parentA2', 'studentA'));
    });

    it('a whole class, one pupil, or roles, and they can be combined', async () => {
      const cls = await compose(u.ADMIN, { audience: { classIds: [ids.cls] } });
      expect(await got(cls.body.data.id)).toEqual(users('parentA', 'parentA2', 'parentB', 'studentA'));

      const one = await compose(u.ADMIN, { audience: { studentIds: [ids.bilal] } });
      expect(await got(one.body.data.id)).toEqual(users('parentB'));

      const mixed = await compose(u.ADMIN, { audience: { roles: ['TEACHER'], studentIds: [ids.ali] } });
      expect(await got(mixed.body.data.id)).toEqual(users('TEACHER', 'parentA', 'studentA'));

      const all = await compose(u.OWNER, { audience: { everyone: true } });
      expect(all.body.data.recipients).toBe(8);
    });

    it('scheduled: nothing goes out until the time, it can be cancelled, and it goes out once', async () => {
      const when = new Date(Date.now() + 3_600_000).toISOString();
      const a = (await compose(u.PRINCIPAL, { audience: { sectionIds: [ids.secA] }, scheduledAt: when })).body.data;
      const b = (await compose(u.PRINCIPAL, { audience: { sectionIds: [ids.secB] }, scheduledAt: when })).body.data;
      expect(a).toMatchObject({ status: 'SCHEDULED', recipients: 0 });
      expect(await sendDueBroadcasts()).toBe(0);
      expect(await basePrisma.notification.count({ where: { schoolId: t.school.id } })).toBe(0);

      // Cancel one; a sent or cancelled message cannot be cancelled again.
      expect((await api(u.PRINCIPAL).del(`/notifications/broadcasts/${b.id}`)).status).toBe(200);
      expect((await api(u.PRINCIPAL).del(`/notifications/broadcasts/${b.id}`)).status).toBe(409);

      // The hour arrives. Two workers notice at the same moment.
      const due = new Date(Date.now() + 3_700_000);
      const [x, y] = await Promise.all([sendDueBroadcasts(due), sendDueBroadcasts(due)]);
      expect(x + y).toBe(1);
      expect(await got(a.id)).toEqual(users('parentA', 'parentA2', 'studentA'));
      expect(await got(b.id)).toEqual([]);
      expect(await sendDueBroadcasts(due)).toBe(0);
      expect((await basePrisma.broadcast.findUniqueOrThrow({ where: { id: a.id } }))).toMatchObject({ status: 'SENT', recipients: 3 });
    });

    it('a send that was cut off is finished by another worker, without repeats', async () => {
      const b = await basePrisma.broadcast.create({
        data: { schoolId: t.school.id, title: 'Cut off', body: 'x', audience: { classIds: [ids.cls] }, createdById: u.PRINCIPAL.id, status: 'SENDING', sendingSince: new Date() },
      });
      // The first worker got as far as one parent before it died.
      await inSchool(() => notify([u.parentA.id], { type: 'BROADCAST', title: 'Cut off', body: 'x' }, { broadcastId: b.id }));

      expect(await sendBroadcast(b.id)).toBeNull(); // too soon: it may still be working
      await basePrisma.broadcast.update({ where: { id: b.id }, data: { sendingSince: new Date(Date.now() - 6 * 60_000) } });
      expect(await sendDueBroadcasts()).toBe(1);
      expect(await got(b.id)).toEqual(users('parentA', 'parentA2', 'parentB', 'studentA')); // parentA once, not twice
      expect((await basePrisma.broadcast.findUniqueOrThrow({ where: { id: b.id } }))).toMatchObject({ status: 'SENT', recipients: 4 });
    });

    it('the delivery report: sent, delivered, not reached, read', async () => {
      const b = (await compose(u.PRINCIPAL, { audience: { classIds: [ids.cls] } })).body.data;
      const report = (await api(u.PRINCIPAL).get(`/notifications/broadcasts/${b.id}`)).body.data.report;
      expect(report).toMatchObject({ sent: 4, waiting: 4, delivered: 0 });

      await drainAll();
      await api(u.parentB).put('/notifications/read-all'); // read in the app although the push never reached them
      const detail = (await api(u.PRINCIPAL).get(`/notifications/broadcasts/${b.id}`)).body.data;
      expect(detail.report).toEqual({ sent: 4, delivered: 1, unreached: 3, failed: 0, waiting: 0, muted: 0, read: 1 });
      // Who to follow up with: not reached and has not read it.
      expect(detail.notReached.map((p: any) => p.id).sort()).toEqual(users('parentA2', 'studentA'));
      expect(detail.notReached[0]).toHaveProperty('name');

      const list = (await api(u.ADMIN).get('/notifications/broadcasts')).body.data;
      expect(list[0]).toMatchObject({ id: b.id, title: 'Sports day', status: 'SENT', recipients: 4, report: { delivered: 1, read: 1 } });
      expect(list[0].createdBy).toContain('principal');
      // Another school cannot see it.
      const outsider = await other.user('PRINCIPAL', 'out');
      expect((await api(outsider).get(`/notifications/broadcasts/${b.id}`)).status).toBe(404);
      expect((await api(outsider).get('/notifications/broadcasts')).body.data).toHaveLength(0);
    });
  });

  // ─── Clean-up ───

  describe('old notifications are removed', () => {
    const age = (title: string, days: number, extra: object = {}) =>
      basePrisma.notification.updateMany({ where: { schoolId: t.school.id, title }, data: { createdAt: new Date(Date.now() - days * 86_400_000), ...extra } });
    const titles = async () => (await basePrisma.notification.findMany({ where: { schoolId: t.school.id }, select: { title: true } })).map((n) => n.title).sort();

    beforeEach(async () => {
      for (const title of ['recent', 'old', 'old but still owed']) await inSchool(() => notify([u.parentA.id], { type: 'NOTICE_PUBLISHED', title, body: 'x' }));
      await drainAll();
      await age('recent', 30);
      await age('old', 200);
      await age('old but still owed', 200, { deliveryState: 'PENDING', deliverAfter: new Date(Date.now() + 3_600_000) });
    });

    it('past the keep-for period (180 days unless set), except anything still owed a delivery', async () => {
      delete process.env.NOTIFICATION_RETENTION_DAYS;
      expect(await cleanUpNotifications(new Date(), { schoolId: t.school.id })).toBeGreaterThanOrEqual(1);
      expect(await titles()).toEqual(['old but still owed', 'recent']);
    });

    it('the period can be changed, or the clean-up switched off', async () => {
      process.env.NOTIFICATION_RETENTION_DAYS = '0';
      expect(await cleanUpNotifications(new Date(), { schoolId: t.school.id })).toBe(0);
      expect(await titles()).toHaveLength(3);
      process.env.NOTIFICATION_RETENTION_DAYS = '20';
      await cleanUpNotifications(new Date(), { schoolId: t.school.id });
      expect(await titles()).toEqual(['old but still owed']);
    });
  });
});
