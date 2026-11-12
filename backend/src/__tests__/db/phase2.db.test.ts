/**
 * Phase 2 end-to-end: diary, notices, calendar, parent home, device tokens, fee reminders.
 *   RUN_DB_TESTS=1 npm test -- src/__tests__/db/phase2
 */
import 'dotenv/config';
import os from 'os';
import path from 'path';
import fs from 'fs';
import request from 'supertest';

const UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-p2-'));
process.env.UPLOAD_DIR = UPLOAD_DIR;

import app from '../../app';
import { basePrisma } from '../../config/database';
import { connectRedis } from '../../config/redis';
import { dayInTimezone, toDate, addDays, toIso } from '../../utils/dates';
import { createTestSchool, tokenFor } from './helpers';

const d = process.env.RUN_DB_TESTS ? describe : describe.skip;
jest.setTimeout(60_000);

const PDF = Buffer.from('%PDF-1.4\n%%EOF');

d('Phase 2 API (database)', () => {
  let t: Awaited<ReturnType<typeof createTestSchool>>;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const today = dayInTimezone('Asia/Karachi');

  const as = (role: string) => {
    const h = { Authorization: `Bearer ${tok[role]}` };
    return {
      get: (u: string) => request(app).get(`/api/v1${u}`).set(h),
      post: (u: string, b?: object) => request(app).post(`/api/v1${u}`).set(h).send(b ?? {}),
      put: (u: string, b: object) => request(app).put(`/api/v1${u}`).set(h).send(b),
      patch: (u: string, b: object) => request(app).patch(`/api/v1${u}`).set(h).send(b),
      del: (u: string, b?: object) => request(app).delete(`/api/v1${u}`).set(h).send(b ?? {}),
      multipart: (u: string) => request(app).post(`/api/v1${u}`).set(h),
    };
  };
  const notifications = async (role: string) => (await as(role).get('/notifications')).body.data as any[];

  beforeAll(async () => {
    await connectRedis();
    t = await createTestSchool('p2');
    for (const r of ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT'] as const) tok[r] = (await t.user(r)).token;

    const cls = await as('ADMIN').post('/academics/classes', { name: 'Class 3', level: 3, sections: ['A', 'B'] });
    ids.class = cls.body.data.id;
    ids.secA = cls.body.data.sections.find((s: any) => s.name === 'A').id;
    ids.secB = cls.body.data.sections.find((s: any) => s.name === 'B').id;

    for (const [key, name] of [['TEACHER', 'Teacher A'], ['TEACHER2', 'Teacher Two']]) {
      const r = await as('ADMIN').post('/staff', { name, login: { email: `${key.toLowerCase()}.${t.code}@test.local` } });
      ids[`${key}_staff`] = r.body.data.staff.id;
      tok[key] = tokenFor(await basePrisma.user.findUniqueOrThrow({ where: { id: r.body.data.login.user.id } }));
    }
    const subj = await as('ADMIN').post('/academics/subjects', { name: 'English', code: 'ENG' });
    ids.subject = subj.body.data.id;
    await as('ADMIN').put(`/academics/sections/${ids.secA}/subjects`, { assignments: [{ subjectId: ids.subject, teacherId: ids.TEACHER_staff }] });

    for (const [key, sec, phone] of [['PARENT_A', ids.secA, '03001110001'], ['PARENT_B', ids.secB, '03001110002']]) {
      const r = await as('ADMIN').post('/students', { admissionNo: `T-${Math.random().toString(36).slice(2, 10)}`,
        name: `Child of ${key}`, sectionId: sec,
        guardians: [{ name: `${key} Name`, phone, relation: 'FATHER', loginEmail: `${key.toLowerCase()}.${t.code}@test.local` }],
      });
      ids[`${key}_child`] = r.body.data.student.id;
      tok[key] = tokenFor(await basePrisma.user.findUniqueOrThrow({ where: { id: r.body.data.parentLogins[0].user.id } }));
    }
  });

  afterAll(async () => {
    await t?.destroy();
    await basePrisma.$disconnect();
    fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
  });

  // ─── Diary ───

  it('teacher posts homework with an attachment; only that section is notified', async () => {
    const r = await as('TEACHER').multipart('/diary')
      .field('sectionId', ids.secA).field('subjectId', ids.subject).field('content', 'Read chapter 4 and answer Q1–5')
      .field('isHomework', 'true').field('dueDate', toIso(addDays(toDate(today), 2)))
      .attach('files', PDF, 'worksheet.pdf');
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ isHomework: true, familiesNotified: 1, subject: { name: 'English' } });
    expect(r.body.data.attachments[0].href).toMatch(/\/api\/v1\/files\//);
    ids.diary = r.body.data.id;

    expect((await notifications('PARENT_A')).some((n) => n.type === 'DIARY_POSTED')).toBe(true);
    expect((await notifications('PARENT_B')).some((n) => n.type === 'DIARY_POSTED')).toBe(false);
  });

  it('diary posting rules', async () => {
    expect((await as('TEACHER').post('/diary', { sectionId: ids.secB, content: 'x' })).status).toBe(404);
    expect((await as('TEACHER').post('/diary', { sectionId: ids.secA, content: 'x', date: toIso(addDays(toDate(today), 1)) })).status).toBe(422);
    expect((await as('TEACHER').post('/diary', { sectionId: ids.secA, content: 'x', isHomework: true, dueDate: toIso(addDays(toDate(today), -1)) })).status).toBe(422);
    expect((await as('PARENT_A').post('/diary', { sectionId: ids.secA, content: 'x' })).status).toBe(403);
  });

  it('parents read only their child\'s section diary', async () => {
    const a = await as('PARENT_A').get('/diary');
    expect(a.body.data.map((e: any) => e.id)).toEqual([ids.diary]);
    const file = new URL(a.body.data[0].attachments[0].href);
    expect((await request(app).get(file.pathname + file.search)).status).toBe(200);

    expect((await as('PARENT_B').get('/diary')).body.data).toHaveLength(0);
    expect((await as('PARENT_A').get(`/diary?studentId=${ids.PARENT_B_child}`)).status).toBe(404);
    expect((await as('PARENT_A').get(`/diary?sectionId=${ids.secB}`)).status).toBe(404);
  });

  it('only the author edits or deletes an entry', async () => {
    expect((await as('TEACHER2').patch(`/diary/${ids.diary}`, { content: 'hacked' })).status).toBe(403);
    const ok = await as('TEACHER').patch(`/diary/${ids.diary}`, { title: 'English homework' });
    expect(ok.body.data.title).toBe('English homework');
  });

  // ─── Notices ───

  it('section notice reaches only that section; read tracking works', async () => {
    const r = await as('ADMIN').post('/notices', { title: 'Class 3-B trip', body: 'Trip on Friday', audience: 'SECTIONS', sectionIds: [ids.secB] });
    expect(r.status).toBe(201);
    expect(r.body.data.notified).toBe(1);
    ids.tripNotice = r.body.data.id;

    expect((await as('PARENT_A').get('/notices')).body.data.map((n: any) => n.title)).not.toContain('Class 3-B trip');
    const b = await as('PARENT_B').get('/notices');
    expect(b.body.data.map((n: any) => n.title)).toContain('Class 3-B trip');
    expect(b.body.unread).toBe(1);

    expect((await as('PARENT_A').post(`/notices/${ids.tripNotice}/read`)).status).toBe(404);
    await as('PARENT_B').post(`/notices/${ids.tripNotice}/read`);
    expect((await as('PARENT_B').get('/notices')).body.unread).toBe(0);
  });

  it('audiences: parents-only notice is hidden from staff; drafts are hidden until published', async () => {
    await as('PRINCIPAL').post('/notices', { title: 'PTM for parents', body: 'Saturday 10am', audience: 'PARENTS' });
    expect((await as('TEACHER').get('/notices')).body.data.map((n: any) => n.title)).not.toContain('PTM for parents');
    expect((await as('PARENT_A').get('/notices')).body.data.map((n: any) => n.title)).toContain('PTM for parents');

    const draft = await as('ADMIN').post('/notices', { title: 'Draft circular', body: 'tbd', audience: 'ALL', publish: false });
    expect(draft.status).toBe(201);
    expect((await as('PARENT_A').get('/notices')).body.data.map((n: any) => n.title)).not.toContain('Draft circular');
    const pub = await as('ADMIN').post(`/notices/${draft.body.data.id}/publish`);
    expect(pub.body.data.notified).toBeGreaterThanOrEqual(7); // everyone in the school except the author
    expect((await as('PARENT_A').get('/notices')).body.data.map((n: any) => n.title)).toContain('Draft circular');
    expect((await as('ADMIN').post(`/notices/${draft.body.data.id}/publish`)).status).toBe(409);
  });

  it('teachers cannot publish notices; section notices need sections', async () => {
    expect((await as('TEACHER').post('/notices', { title: 'Hi', body: 'x' })).status).toBe(403);
    expect((await as('ADMIN').post('/notices', { title: 'Hi', body: 'x', audience: 'SECTIONS' })).status).toBe(422);
  });

  // ─── Calendar ───

  it('admin manages holidays; everyone can see them', async () => {
    const r = await as('ADMIN').post('/calendar', { title: 'Sports day', type: 'EVENT', startDate: toIso(addDays(toDate(today), 5)) });
    expect(r.status).toBe(201);
    expect(r.body.data.endDate).toBe(r.body.data.startDate);
    expect((await as('PARENT_A').get('/calendar')).body.data.map((e: any) => e.title)).toContain('Sports day');
    expect((await as('TEACHER').post('/calendar', { title: 'x', startDate: today })).status).toBe(403);
    expect((await as('ADMIN').post('/calendar', { title: 'Bad', startDate: today, endDate: toIso(addDays(toDate(today), -1)) })).status).toBe(422);
  });

  // ─── Parent home ───

  it('parent home shows today, fees, latest diary, upcoming events and unread notices', async () => {
    await as('TEACHER').put('/attendance/students', { sectionId: ids.secA, records: [{ studentId: ids.PARENT_A_child, status: 'ABSENT' }] });
    const head = await as('ADMIN').post('/fees/heads', { name: 'Tuition', frequency: 'MONTHLY' });
    await as('ADMIN').put(`/fees/structure/${ids.class}`, { items: [{ feeHeadId: head.body.data.id, amount: 2500 }] });
    await as('ACCOUNTANT').post('/fees/invoices/generate', { period: '2026-10' });

    const kids = await as('PARENT_A').get('/family/children');
    expect(kids.body.data.map((k: any) => k.name)).toEqual(['Child of PARENT_A']);

    const r = await as('PARENT_A').get(`/family/home?studentId=${ids.PARENT_A_child}`);
    expect(r.status).toBe(200);
    const h = r.body.data;
    expect(h.today.status).toBe('ABSENT');
    expect(h.fees).toMatchObject({ pending: '2500', nextDue: { period: '2026-10', amount: '2500', overdue: true } });
    expect(h.latestDiary.title).toBe('English homework');
    expect(h.upcoming.map((e: any) => e.title)).toContain('Sports day');
    expect(h.unreadNotices).toBeGreaterThanOrEqual(2);

    expect((await as('PARENT_A').get(`/family/home?studentId=${ids.PARENT_B_child}`)).status).toBe(404);
    expect((await as('ADMIN').get(`/family/home?studentId=${ids.PARENT_A_child}`)).status).toBe(403);
  });

  // ─── Push devices ───

  it('registers Expo push tokens and hands a device over on re-login', async () => {
    const token = `ExponentPushToken[test-${t.code}]`;
    expect((await as('PARENT_A').post('/push/devices', { token: 'not-a-token' })).status).toBe(422);
    expect((await as('PARENT_A').post('/push/devices', { token, platform: 'android' })).status).toBe(201);
    expect((await as('PARENT_A').post('/push/devices', { token, platform: 'android' })).status).toBe(201); // idempotent
    await as('PARENT_B').post('/push/devices', { token, platform: 'android' });
    const rows = await basePrisma.deviceToken.findMany({ where: { token } });
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).not.toBe(undefined);
    await as('PARENT_B').del('/push/devices', { token });
    expect(await basePrisma.deviceToken.count({ where: { token } })).toBe(0);
  });

  // ─── Fee reminders ───

  it('fee reminders go once a day per parent and child', async () => {
    const first = await as('ACCOUNTANT').post('/fees/reminders', {});
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ students: 2, parentsReminded: 2, skippedAlreadyRemindedToday: 0 });
    const again = await as('ACCOUNTANT').post('/fees/reminders', {});
    expect(again.body.data).toMatchObject({ parentsReminded: 0, skippedAlreadyRemindedToday: 2 });
    const n = (await notifications('PARENT_B')).find((x) => x.type === 'FEE_DUE');
    expect(n.title).toMatch(/overdue/);
    expect((await as('TEACHER').post('/fees/reminders', {})).status).toBe(403);
  });
});
