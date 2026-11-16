/**
 * Notification pipeline: saved rows are the delivery queue; workers claim, push, retry and
 * settle; urgent types fall back to a text; open screens hear about it live; and it holds
 * up for a whole school at once.
 *   RUN_DB_TESTS=1 npx jest src/__tests__/db/notifications
 */
import 'dotenv/config';
import http from 'http';
import type { AddressInfo } from 'net';
import request from 'supertest';
import { io as connect, type Socket } from 'socket.io-client';
import app from '../../app';
import { basePrisma } from '../../config/database';
import { connectRedis } from '../../config/redis';
import { runWithTenant } from '../../config/tenancy';
import { closeSocketIO, initSocketIO } from '../../config/socket';
import { notify, notifyEach } from '../../utils/notify';
import { BATCH, MAX_ATTEMPTS, drainOnce, transport, type ExpoMessage, type Outcome } from '../../utils/notificationDelivery';
import { createTestSchool } from './helpers';

const d = process.env.RUN_DB_TESTS ? describe : describe.skip;
jest.setTimeout(240_000);

d('Notifications (database)', () => {
  let t: Awaited<ReturnType<typeof createTestSchool>>;
  let other: Awaited<ReturnType<typeof createTestSchool>>;
  type TestUser = Awaited<ReturnType<Awaited<ReturnType<typeof createTestSchool>>['user']>>;
  const u: Record<string, TestUser> = {};
  const real = { ...transport };
  const env = { push: process.env.PUSH_DISABLED, provider: process.env.MESSAGING_PROVIDER };

  let sent: ExpoMessage[] = [];
  let expoAnswer: (m: ExpoMessage) => Outcome = () => 'ok';

  const inSchool = <T>(fn: () => Promise<T>) => runWithTenant(t.school.id, fn);
  const only = () => ({ schoolId: t.school.id });
  const drainAll = async () => { let n = 0; let got: number; do { got = await drainOnce(only()); n += got; } while (got === BATCH); return n; };
  const stateOf = async (userId: string, type?: string) =>
    (await basePrisma.notification.findMany({ where: { userId, ...(type ? { type } : {}) }, orderBy: { createdAt: 'desc' } }))[0];
  const device = (userId: string, token: string) => basePrisma.deviceToken.create({ data: { schoolId: t.school.id, userId, token, platform: 'android' } });
  const clear = async () => {
    await basePrisma.notification.deleteMany({ where: { schoolId: t.school.id } });
    await basePrisma.outboundMessage.deleteMany({ where: { schoolId: t.school.id } });
    sent = [];
    expoAnswer = () => 'ok';
  };
  const api = (who: TestUser) => {
    const h = { Authorization: `Bearer ${who.token}` };
    return {
      get: (url: string) => request(app).get(`/api/v1${url}`).set(h),
      put: (url: string) => request(app).put(`/api/v1${url}`).set(h).send({}),
    };
  };

  beforeAll(async () => {
    process.env.PUSH_DISABLED = 'false';
    process.env.MESSAGING_PROVIDER = 'test';
    await connectRedis();
    t = await createTestSchool('ntf');
    other = await createTestSchool('ntf-other');
    for (const name of ['withPhone', 'noPhone', 'second']) u[name] = await t.user('PARENT', name);
    u.outsider = await other.user('PARENT', 'outsider');
    await device(u.withPhone.id, `ExponentPushToken[${t.code}-a]`);
    transport.expo = async (messages) => { sent.push(...messages); return messages.map(expoAnswer); };
    transport.web = async () => 'ok';
  });
  afterAll(async () => {
    Object.assign(transport, real);
    process.env.PUSH_DISABLED = env.push;
    process.env.MESSAGING_PROVIDER = env.provider;
    await t.destroy();
    await other.destroy();
  });
  beforeEach(clear);

  // ─── The queue ───

  it('a saved notification is owed a delivery, and the worker pays it', async () => {
    await inSchool(() => notify([u.withPhone.id, u.noPhone.id], { type: 'DIARY_POSTED', title: 'Homework', body: 'Maths ex. 5', data: { diaryId: 'x1' } }));
    expect((await stateOf(u.withPhone.id)).deliveryState).toBe('PENDING');

    expect(await drainAll()).toBe(2);
    const a = await stateOf(u.withPhone.id);
    expect(a).toMatchObject({ deliveryState: 'DELIVERED', deliveryAttempts: 1, deliveryLock: null });
    expect(a.deliveredAt).not.toBeNull();
    // Nothing is registered for the other parent: nowhere to push.
    expect((await stateOf(u.noPhone.id)).deliveryState).toBe('UNREACHED');

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ title: 'Homework', body: 'Maths ex. 5', data: { type: 'DIARY_POSTED', diaryId: 'x1', notificationId: a.id, schoolId: t.school.id } });
    expect(await drainAll()).toBe(0); // settled rows are never sent again
  });

  it('a push service that is down is retried later, then given up on', async () => {
    expoAnswer = () => 'retry';
    await inSchool(() => notify([u.withPhone.id], { type: 'NOTICE_PUBLISHED', title: 'Notice', body: 'PTM on Friday' }));
    await drainAll();
    let n = await stateOf(u.withPhone.id);
    expect(n).toMatchObject({ deliveryState: 'PENDING', deliveryAttempts: 1 });
    expect(n.deliverAfter!.getTime()).toBeGreaterThan(Date.now() + 20_000); // waits before trying again
    expect(await drainAll()).toBe(0); // not due yet

    for (let i = 2; i <= MAX_ATTEMPTS; i++) {
      await basePrisma.notification.update({ where: { id: n.id }, data: { deliverAfter: new Date(Date.now() - 1000) } });
      await drainAll();
    }
    n = await stateOf(u.withPhone.id);
    expect(n).toMatchObject({ deliveryState: 'FAILED', deliveryAttempts: MAX_ATTEMPTS });
    expect(n.deliveryError).toBeTruthy();
    expect(sent).toHaveLength(MAX_ATTEMPTS);
  });

  it('recovers on a later attempt', async () => {
    expoAnswer = () => 'retry';
    await inSchool(() => notify([u.withPhone.id], { type: 'NOTICE_PUBLISHED', title: 'Notice', body: 'Back soon' }));
    await drainAll();
    const n = await stateOf(u.withPhone.id);
    expoAnswer = () => 'ok';
    await basePrisma.notification.update({ where: { id: n.id }, data: { deliverAfter: new Date(Date.now() - 1000) } });
    await drainAll();
    expect(await stateOf(u.withPhone.id)).toMatchObject({ deliveryState: 'DELIVERED', deliveryAttempts: 2 });
  });

  it('forgets a phone that uninstalled the app', async () => {
    const gone = `ExponentPushToken[${t.code}-gone]`;
    await device(u.second.id, gone);
    expoAnswer = (m) => (m.to === gone ? 'gone' : 'ok');
    await inSchool(() => notify([u.second.id], { type: 'NOTICE_PUBLISHED', title: 'Notice', body: 'Hello' }));
    await drainAll();
    expect(await basePrisma.deviceToken.count({ where: { token: gone } })).toBe(0);
    expect((await stateOf(u.second.id)).deliveryState).toBe('FAILED'); // it had a phone; the phone is gone
  });

  it('a worker that died mid-batch does not strand its rows', async () => {
    await inSchool(() => notify([u.withPhone.id], { type: 'NOTICE_PUBLISHED', title: 'Notice', body: 'Stranded' }));
    const n = await stateOf(u.withPhone.id);
    // Held by a worker that is still within its time: left alone.
    await basePrisma.notification.update({ where: { id: n.id }, data: { deliveryLock: 'dead-worker', deliveryLockedUntil: new Date(Date.now() + 60_000) } });
    expect(await drainAll()).toBe(0);
    // Its time ran out: someone else takes over.
    await basePrisma.notification.update({ where: { id: n.id }, data: { deliveryLockedUntil: new Date(Date.now() - 1000) } });
    expect(await drainAll()).toBe(1);
    expect((await stateOf(u.withPhone.id)).deliveryState).toBe('DELIVERED');
  });

  it('does not push what was already read, or what is a day old', async () => {
    await inSchool(() => notifyEach([
      { userId: u.withPhone.id, type: 'NOTICE_PUBLISHED', title: 'Read', body: 'Seen in the app' },
      { userId: u.withPhone.id, type: 'DIARY_POSTED', title: 'Old', body: 'From yesterday' },
    ]));
    await basePrisma.notification.updateMany({ where: { userId: u.withPhone.id, title: 'Read' }, data: { readAt: new Date() } });
    await basePrisma.notification.updateMany({ where: { userId: u.withPhone.id, title: 'Old' }, data: { createdAt: new Date(Date.now() - 25 * 60 * 60_000) } });
    await drainAll();
    expect(sent).toHaveLength(0);
    expect((await stateOf(u.withPhone.id, 'NOTICE_PUBLISHED')).deliveryState).toBe('DELIVERED');
    expect((await stateOf(u.withPhone.id, 'DIARY_POSTED')).deliveryState).toBe('EXPIRED');
  });

  it('several workers at once never send the same notification twice', async () => {
    const ids = Array.from({ length: 1200 }, () => u.withPhone.id);
    await inSchool(() => notifyEach(ids.map((userId, i) => ({ userId, type: 'DIARY_POSTED' as const, title: `N${i}`, body: 'x' }))));
    const worker = async () => { while ((await drainOnce(only())) > 0) { /* until empty */ } };
    await Promise.all([worker(), worker(), worker(), worker()]);
    expect(sent).toHaveLength(1200);
    expect(new Set(sent.map((m) => m.data.notificationId)).size).toBe(1200);
    expect(await basePrisma.notification.count({ where: { schoolId: t.school.id, deliveryState: 'DELIVERED' } })).toBe(1200);
  });

  // ─── Text fallback ───

  describe('urgent alerts fall back to a text', () => {
    const texts = () => basePrisma.outboundMessage.findMany({ where: { schoolId: t.school.id } });
    const school = (data: object) => basePrisma.school.update({ where: { id: t.school.id }, data });
    const absent = () => inSchool(() => notify([u.noPhone.id, u.withPhone.id], { type: 'ATTENDANCE_ABSENT', title: 'Absent today', body: 'Ali was marked absent.' }));

    beforeAll(async () => {
      await basePrisma.user.update({ where: { id: u.noPhone.id }, data: { phone: '0300-1112233' } });
      await basePrisma.user.update({ where: { id: u.withPhone.id }, data: { phone: '0300-4445566' } });
    });
    afterAll(() => school({ messagingFallback: false, messagingEnabled: false, messagingTypes: [] }));

    it('off by default', async () => {
      await absent();
      await drainAll();
      expect(await texts()).toHaveLength(0);
    });

    it('texts only the person the app could not reach', async () => {
      await school({ messagingFallback: true });
      await absent();
      await drainAll();
      const out = await texts();
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ to: '+923001112233', type: 'ATTENDANCE_ABSENT' });
      expect(out[0].body).toContain('Ali was marked absent.');
    });

    it('also when the push failed for good', async () => {
      await school({ messagingFallback: true });
      expoAnswer = () => 'error';
      await inSchool(() => notify([u.withPhone.id], { type: 'FEE_DUE', title: 'Fee due', body: 'Rs 4,500 was due on 10 Nov.' }));
      await drainAll();
      expect((await texts()).map((m) => m.to)).toEqual(['+923004445566']);
    });

    it('not for ordinary types, and not twice for the same words', async () => {
      await school({ messagingFallback: true });
      await inSchool(() => notify([u.noPhone.id], { type: 'DIARY_POSTED', title: 'Homework', body: 'Maths' }));
      await drainAll();
      expect(await texts()).toHaveLength(0);

      await absent();
      await drainAll();
      await absent();
      await drainAll();
      expect(await texts()).toHaveLength(1);
    });

    it('not when the school already texts that type to every family', async () => {
      await school({ messagingFallback: true, messagingEnabled: true, messagingTypes: ['ATTENDANCE_ABSENT'] });
      await absent();
      await drainAll();
      expect(await texts()).toHaveLength(0);
    });
  });

  // ─── The bell ───

  it('the bell: count, pages, mark as read, and only your own', async () => {
    await inSchool(() => notifyEach(Array.from({ length: 5 }, (_, i) => ({ userId: u.second.id, type: 'NOTICE_PUBLISHED' as const, title: `Notice ${i}`, body: 'x' }))));
    // Spread them out so the order is certain.
    const rows = await basePrisma.notification.findMany({ where: { userId: u.second.id }, orderBy: { title: 'asc' } });
    await Promise.all(rows.map((r, i) => basePrisma.notification.update({ where: { id: r.id }, data: { createdAt: new Date(Date.now() - (5 - i) * 60_000) } })));

    expect((await api(u.second).get('/notifications/unread-count')).body.data).toEqual({ count: 5 });
    const first = (await api(u.second).get('/notifications?limit=2')).body.data;
    expect(first.map((n: any) => n.title)).toEqual(['Notice 4', 'Notice 3']);
    expect(first[0]).not.toHaveProperty('deliveryLock'); // queue internals stay on the server
    const next = (await api(u.second).get(`/notifications?limit=2&before=${encodeURIComponent(first[1].createdAt)}`)).body.data;
    expect(next.map((n: any) => n.title)).toEqual(['Notice 2', 'Notice 1']);

    // Someone else cannot mark it read.
    await api(u.withPhone).put(`/notifications/${first[0].id}/read`);
    expect((await api(u.second).get('/notifications/unread-count')).body.data.count).toBe(5);
    await api(u.second).put(`/notifications/${first[0].id}/read`);
    expect((await api(u.second).get('/notifications/unread-count')).body.data.count).toBe(4);
    await api(u.second).put('/notifications/read-all');
    expect((await api(u.second).get('/notifications/unread-count')).body.data.count).toBe(0);
    expect((await api(u.withPhone).get('/notifications')).body.data).toHaveLength(0);
  });

  // ─── Live ───

  describe('open screens hear about it live', () => {
    let server: http.Server;
    let url: string;
    const sockets: Socket[] = [];
    const open = (token: string) => new Promise<Socket>((resolve, reject) => {
      const s = connect(url, { transports: ['websocket'], auth: { token }, reconnection: false });
      sockets.push(s);
      s.once('connect', () => resolve(s));
      s.once('connect_error', reject);
    });
    const next = <T>(s: Socket, event: string, ms = 5000) => new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no "${event}" within ${ms} ms`)), ms);
      s.once(event, (payload: T) => { clearTimeout(timer); resolve(payload); });
    });
    const quiet = (s: Socket, event: string, ms = 700) => new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(true), ms);
      s.once(event, () => { clearTimeout(timer); resolve(false); });
    });

    beforeAll(async () => {
      server = http.createServer(app);
      initSocketIO(server);
      await new Promise<void>((r) => server.listen(0, r));
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      await new Promise((r) => setTimeout(r, 300)); // let the Redis subscription settle
    });
    afterAll(async () => {
      sockets.forEach((s) => s.close());
      await closeSocketIO();
    });

    it('refuses a connection without a valid login', async () => {
      await expect(open('not-a-token')).rejects.toThrow(/Authentication/);
    });

    it('delivers to that user only, on every screen they have open', async () => {
      const [tab1, tab2, someoneElse, otherSchool] = await Promise.all([open(u.second.token), open(u.second.token), open(u.noPhone.token), open(u.outsider.token)]);
      const got = Promise.all([next<any>(tab1, 'notification'), next<any>(tab2, 'notification')]);
      const silent = Promise.all([quiet(someoneElse, 'notification'), quiet(otherSchool, 'notification')]);
      await inSchool(() => notify([u.second.id], { type: 'DIARY_POSTED', title: 'Homework', body: 'Science p. 40', data: { diaryId: 'd9' } }));

      const [a, b] = await got;
      const saved = await stateOf(u.second.id);
      expect(a).toMatchObject({ id: saved.id, type: 'DIARY_POSTED', title: 'Homework', body: 'Science p. 40', data: { diaryId: 'd9' } });
      expect(b.id).toBe(saved.id);
      expect(await silent).toEqual([true, true]);
    });

    it('reading on one screen clears the badge on the others', async () => {
      const [phone] = await Promise.all([open(u.second.token)]);
      await inSchool(() => notify([u.second.id], { type: 'NOTICE_PUBLISHED', title: 'Notice', body: 'x' }));
      const cleared = next(phone, 'notifications:read');
      await api(u.second).put('/notifications/read-all');
      await cleared;
    });
  });

  // ─── A whole school ───

  it('5,000 parents: saved in seconds, all delivered or accounted for', async () => {
    const N = 5000;
    const WITH_APP = 2000;
    const users = Array.from({ length: N }, (_, i) => ({
      id: `${t.code}-bulk-${i}`.slice(0, 36), schoolId: t.school.id, role: 'PARENT' as const, name: `Parent ${i}`, email: `bulk${i}.${t.code}@test.local`, password: 'x',
    }));
    for (let i = 0; i < N; i += 1000) await basePrisma.user.createMany({ data: users.slice(i, i + 1000) });
    await basePrisma.deviceToken.createMany({
      data: users.slice(0, WITH_APP).map((x, i) => ({ schoolId: t.school.id, userId: x.id, token: `ExponentPushToken[${t.code}-bulk-${i}]`, platform: 'android' })),
    });

    const t0 = Date.now();
    const notified = await inSchool(() => notify(users.map((x) => x.id), { type: 'NOTICE_PUBLISHED', title: 'School closed tomorrow', body: 'Due to weather, the school is closed on Tuesday.' }));
    const saveMs = Date.now() - t0;
    expect(notified).toBe(N);

    const t1 = Date.now();
    const worker = async () => { while ((await drainOnce(only())) > 0) { /* until empty */ } };
    await Promise.all([worker(), worker(), worker()]);
    const drainMs = Date.now() - t1;

    const counts = await basePrisma.notification.groupBy({ by: ['deliveryState'], where: { schoolId: t.school.id, type: 'NOTICE_PUBLISHED' }, _count: true });
    const by = Object.fromEntries(counts.map((c) => [c.deliveryState, c._count]));
    console.log(`5,000 notifications: saved in ${saveMs} ms, delivered in ${drainMs} ms`, by);
    expect(by).toEqual({ DELIVERED: WITH_APP, UNREACHED: N - WITH_APP });
    expect(sent).toHaveLength(WITH_APP);
    expect(new Set(sent.map((m) => m.to)).size).toBe(WITH_APP);
    expect(saveMs).toBeLessThan(30_000);
    expect(drainMs).toBeLessThan(60_000);
  });
});
