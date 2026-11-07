/**
 * Phase 5 end-to-end: transport (with fees), library (with fines), homework tracking,
 * WhatsApp/SMS channel, platform admin, office staff records, year-end promotion.
 *   RUN_DB_TESTS=1 npm test -- src/__tests__/db/phase5
 */
import 'dotenv/config';
import request from 'supertest';

process.env.MESSAGING_PROVIDER = 'test';

import app from '../../app';
import { basePrisma } from '../../config/database';
import { connectRedis } from '../../config/redis';
import { addDays, dayInTimezone, toDate } from '../../utils/dates';
import { toE164 } from '../../utils/messaging';
import { createTestSchool, tokenFor } from './helpers';

const d = process.env.RUN_DB_TESTS ? describe : describe.skip;
jest.setTimeout(120_000);

describe('toE164', () => {
  it.each([
    ['0300-1234567', '+923001234567'],
    ['03001234567', '+923001234567'],
    ['923001234567', '+923001234567'],
    ['+44 20 7946 0958', '+442079460958'],
    ['0044 20 7946 0958', '+442079460958'],
    ['12', null],
    [null, null],
  ])('%s → %s', (raw, out) => expect(toE164(raw)).toBe(out));
});

d('Phase 5 API (database)', () => {
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
      del: (u: string) => request(app).delete(`/api/v1${u}`).set(h),
    };
  };
  const messages = () => basePrisma.outboundMessage.findMany({ where: { schoolId: t.school.id }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    await connectRedis();
    t = await createTestSchool('p5');
    for (const r of ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT'] as const) tok[r] = (await t.user(r)).token;
    const sa = await basePrisma.user.findUniqueOrThrow({ where: { email: 'superadmin@platform.com' } });
    tok.SUPER = tokenFor(sa);
    const A = as('ADMIN');
    for (const [name, level] of [['Class 1', 1], ['Class 2', 2]] as const) {
      const c = await A.post('/academics/classes', { name, level, sections: ['A'] });
      ids[`c${level}`] = c.body.data.id;
      ids[`s${level}`] = c.body.data.sections[0].id;
    }
    const st = await A.post('/staff', { name: 'P5 Teacher', login: { email: `p5t.${t.code}@test.local` } });
    ids.staff = st.body.data.staff.id;
    tok.TEACHER = tokenFor(await basePrisma.user.findUniqueOrThrow({ where: { id: st.body.data.login.user.id } }));
    ids.subject = (await A.post('/academics/subjects', { name: 'Maths', code: 'MATH' })).body.data.id;
    await A.put(`/academics/sections/${ids.s1}/subjects`, { assignments: [{ subjectId: ids.subject, teacherId: ids.staff }] });

    for (const [key, sec, phone] of [['k1', ids.s1, '0300-5550101'], ['k2', ids.s1, '03005550102'], ['k3', ids.s2, '03005550103']]) {
      const r = await A.post('/students', {
        name: `Kid ${key}`, sectionId: sec,
        guardians: [{ name: `Parent ${key}`, phone, relation: 'FATHER', ...(key === 'k1' ? { loginEmail: `p5parent.${t.code}@test.local` } : {}) }],
      });
      ids[key] = r.body.data.student.id;
      if (key === 'k1') tok.PARENT = tokenFor(await basePrisma.user.findUniqueOrThrow({ where: { id: r.body.data.parentLogins[0].user.id } }));
    }
    const head = await A.post('/fees/heads', { name: 'Tuition', frequency: 'MONTHLY' });
    for (const c of [ids.c1, ids.c2]) await A.put(`/fees/structure/${c}`, { items: [{ feeHeadId: head.body.data.id, amount: 3000 }] });
  });

  afterAll(async () => {
    await t?.destroy();
    await basePrisma.$disconnect();
  });

  // ─── Office staff records ───

  it('office users created by the owner get a staff record (so a principal can apply for leave)', async () => {
    const r = await as('OWNER').post('/users', { name: 'New Principal', email: `np.${t.code}@test.local`, role: 'PRINCIPAL' });
    expect(r.status).toBe(201);
    expect(r.body.data.staff.employeeNo).toMatch(/^EMP-/);
    const np = tokenFor(await basePrisma.user.findUniqueOrThrow({ where: { id: r.body.data.user.id } }));
    tok.NEW_PRINCIPAL = np;
    const leave = await as('NEW_PRINCIPAL').post('/leave', { fromDate: today, toDate: today, reason: 'Conference' });
    expect(leave.status).toBe(201);
    const parent = await as('OWNER').post('/users', { name: 'Not Staff', email: `ns.${t.code}@test.local`, role: 'OWNER' });
    expect(parent.body.data.staff).toBeNull();
  });

  // ─── Transport ───

  it('routes, stops, capacity and the parent view', async () => {
    const r = await as('ADMIN').post('/transport/routes', { name: 'Route 1', vehicleNo: 'LEB-1234', driverName: 'Aslam', driverPhone: '03211234567', capacity: 1, monthlyFee: 1500 });
    expect(r.status).toBe(201);
    ids.route = r.body.data.id;
    await as('ADMIN').put(`/transport/routes/${ids.route}/stops`, { stops: [{ name: 'Model Town', pickupTime: '07:10', dropTime: '13:40' }, { name: 'Garden Town', pickupTime: '07:25' }] });
    const routes = await as('ADMIN').get('/transport/routes');
    ids.stop = routes.body.data[0].stops[0].id;
    expect(routes.body.data[0].stops.map((s: any) => s.name)).toEqual(['Model Town', 'Garden Town']);

    expect((await as('ADMIN').put(`/transport/students/${ids.k1}`, { routeId: ids.route, stopId: ids.stop })).status).toBe(200);
    expect((await as('ADMIN').put(`/transport/students/${ids.k2}`, { routeId: ids.route })).status).toBe(409); // full
    expect((await as('TEACHER').put(`/transport/students/${ids.k2}`, { routeId: ids.route })).status).toBe(403);

    const mine = await as('PARENT').get(`/transport/students/${ids.k1}`);
    expect(mine.body.data).toMatchObject({ route: { name: 'Route 1', vehicleNo: 'LEB-1234', driverName: 'Aslam' }, stop: { name: 'Model Town', pickupTime: '07:10' } });
    expect((await as('PARENT').get(`/transport/students/${ids.k3}`)).status).toBe(404);
    expect((await as('PARENT').get('/transport/routes')).status).toBe(403);
  });

  it('transport fee is billed on monthly invoices for riders only', async () => {
    const g = await as('ACCOUNTANT').post('/fees/invoices/generate', { period: '2026-11', dueDay: 28 });
    expect(g.body.data.created).toBe(3);
    const ledger = async (sid: string) => (await as('ACCOUNTANT').get(`/fees/students/${sid}`)).body.data.invoices[0];
    const k1 = await ledger(ids.k1);
    expect(k1.netAmount).toBe('4500');
    expect(k1.items.map((i: any) => i.feeHead.name).sort()).toEqual(['Transport', 'Tuition']);
    expect((await ledger(ids.k2)).netAmount).toBe('3000');
  });

  // ─── Library ───

  it('issue, availability, limits, late fine, paid', async () => {
    await as('ADMIN').patch('/school', { libraryFinePerDay: 10 });
    const book = await as('ADMIN').post('/library/books', { title: 'The Clever Crow', author: 'A. Writer', copies: 1 });
    ids.book = book.body.data.id;
    const issue = await as('ADMIN').post('/library/issues', { bookId: ids.book, studentId: ids.k1 });
    expect(issue.status).toBe(201);
    ids.loan = issue.body.data.id;
    expect((await as('ADMIN').post('/library/issues', { bookId: ids.book, studentId: ids.k2 })).status).toBe(409); // no copy left
    const list = await as('ADMIN').get('/library/books?search=crow');
    expect(list.body.data[0]).toMatchObject({ copies: 1, issued: 1, available: 0 });

    // Pretend it was due 5 days ago.
    await basePrisma.bookIssue.update({ where: { id: ids.loan }, data: { dueDate: addDays(toDate(today), -5) } });
    const overdue = await as('ADMIN').get('/library/issues?status=overdue');
    expect(overdue.body.data[0]).toMatchObject({ daysLate: 5, fineSoFar: '50' });
    const ret = await as('ADMIN').post(`/library/issues/${ids.loan}/return`);
    expect(ret.body.data).toEqual({ daysLate: 5, fine: '50' });
    expect((await as('ADMIN').post(`/library/issues/${ids.loan}/return`)).status).toBe(409);

    const acct = await as('PARENT').get(`/library/students/${ids.k1}`);
    expect(acct.body.data.unpaidFines).toBe(50);
    expect((await as('PARENT').get(`/library/students/${ids.k3}`)).status).toBe(404);
    expect((await as('PARENT').post('/library/books', { title: 'x' })).status).toBe(403);
    await as('ADMIN').post(`/library/issues/${ids.loan}/fine`, { action: 'paid' });
    expect((await as('PARENT').get(`/library/students/${ids.k1}`)).body.data.unpaidFines).toBe(0);
  });

  // ─── Homework tracking ───

  it('families tick homework done; the teacher sees who has', async () => {
    const hw = await as('TEACHER').post('/diary', { sectionId: ids.s1, subjectId: ids.subject, content: 'Exercise 3', isHomework: true });
    ids.hw = hw.body.data.id;
    expect((await as('PARENT').post(`/diary/${ids.hw}/done`, { studentId: ids.k1 })).status).toBe(200);
    expect((await as('PARENT').post(`/diary/${ids.hw}/done`, { studentId: ids.k3 })).status).toBe(404);
    const fam = await as('PARENT').get(`/diary?studentId=${ids.k1}`);
    expect(fam.body.data.find((e: any) => e.id === ids.hw).done).toBe(true);
    const c = await as('TEACHER').get(`/diary/${ids.hw}/completion`);
    expect(c.body.data).toMatchObject({ done: 1, total: 2 });
    expect((await as('TEACHER').get('/diary?mine=true')).body.data.find((e: any) => e.id === ids.hw).doneCount).toBe(1);
    await request(app).delete(`/api/v1/diary/${ids.hw}/done?studentId=${ids.k1}`).set({ Authorization: `Bearer ${tok.PARENT}` });
    expect((await as('TEACHER').get(`/diary/${ids.hw}/completion`)).body.data.done).toBe(0);
  });

  // ─── WhatsApp / SMS ───

  it('nothing is texted until the school turns it on, then only the chosen alerts', async () => {
    await as('TEACHER').put('/attendance/students', { sectionId: ids.s1, records: [{ studentId: ids.k2, status: 'ABSENT' }] });
    expect(await messages()).toHaveLength(0);

    expect((await as('TEACHER').put('/messaging', { messagingEnabled: true, messagingChannel: 'WHATSAPP', messagingTypes: [] })).status).toBe(403);
    await as('ADMIN').put('/messaging', { messagingEnabled: true, messagingChannel: 'WHATSAPP', messagingTypes: ['ATTENDANCE_ABSENT', 'FEE_PAID'] });

    await as('TEACHER').put('/attendance/students', { sectionId: ids.s1, records: [{ studentId: ids.k1, status: 'ABSENT' }] });
    await as('ACCOUNTANT').post('/fees/payments', { studentId: ids.k2, amount: 3000, method: 'CASH' });
    await as('ACCOUNTANT').post('/fees/reminders', {}); // FEE_DUE not enabled → no text
    await new Promise((r) => setTimeout(r, 300)); // background delivery

    const msgs = await messages();
    expect(msgs.map((m) => [m.type, m.to, m.channel, m.status])).toEqual([
      ['ATTENDANCE_ABSENT', '+923005550101', 'WHATSAPP', 'SENT'],
      ['FEE_PAID', '+923005550102', 'WHATSAPP', 'SENT'],
    ]);
    expect(msgs[0].body).toMatch(/^Test .*: Kid k1 was marked absent today/);

    const log = await as('ADMIN').get('/messaging');
    expect(log.body.data).toMatchObject({ messagingEnabled: true, provider: 'test', last30Days: { SENT: 2 } });
    const test = await as('ADMIN').post('/messaging/test', { phone: '0333 1112223' });
    expect(test.body.data).toMatchObject({ to: '+923331112223', status: 'SENT' });
  });

  // ─── Platform admin ───

  it('platform admin lists schools with counts; school users cannot', async () => {
    const r = await as('SUPER').get('/platform/schools');
    const mine = r.body.data.find((s: any) => s.id === t.school.id);
    expect(mine).toMatchObject({ activeStudents: 3 });
    expect(mine.owners.length).toBeGreaterThanOrEqual(1);
    expect((await as('OWNER').get('/platform/schools')).status).toBe(403);
  });

  // ─── Year-end promotion (last: it changes the current year) ───

  it('promotion preview, run once, carry teachers and fees forward', async () => {
    const next = await as('ADMIN').post('/school/academic-years', { name: '2027-28', startDate: '2027-04-01', endDate: '2028-03-31' });
    ids.nextYear = next.body.data.id;
    expect((await as('TEACHER').get(`/promotions/preview?toAcademicYearId=${ids.nextYear}`)).status).toBe(403);

    const p = await as('PRINCIPAL').get(`/promotions/preview?toAcademicYearId=${ids.nextYear}`);
    expect(p.status).toBe(200);
    const c1 = p.body.data.classes.find((c: any) => c.class.name === 'Class 1');
    const c2 = p.body.data.classes.find((c: any) => c.class.name === 'Class 2');
    expect(c1.nextClass.name).toBe('Class 2');
    expect(c1.students.every((s: any) => s.outcome === 'PROMOTED' && s.toSectionId === ids.s2)).toBe(true);
    expect(c2.nextClass).toBeNull();
    expect(c2.students[0].outcome).toBe('GRADUATED');

    // Keep k2 back a year.
    const decisions = [...c1.students, ...c2.students].map((s: any) => (s.id === ids.k2 ? { studentId: s.id, outcome: 'RETAINED', toSectionId: ids.s1 } : { studentId: s.id, outcome: s.outcome, toSectionId: s.toSectionId }));
    const run = await as('PRINCIPAL').post('/promotions/run', { toAcademicYearId: ids.nextYear, decisions });
    expect(run.status).toBe(200);
    expect(run.body.data).toMatchObject({ counts: { PROMOTED: 1, RETAINED: 1, GRADUATED: 1 }, teachersCopied: 1, feesCopied: 2, currentYear: '2027-28' });

    const stu = await basePrisma.student.findMany({ where: { schoolId: t.school.id }, select: { id: true, sectionId: true, status: true } });
    const by = Object.fromEntries(stu.map((s) => [s.id, s]));
    expect(by[ids.k1].sectionId).toBe(ids.s2);
    expect(by[ids.k2].sectionId).toBe(ids.s1);
    expect(by[ids.k3].status).toBe('GRADUATED');

    const again = await as('PRINCIPAL').post('/promotions/run', { toAcademicYearId: ids.nextYear, decisions: [{ studentId: ids.k1, outcome: 'PROMOTED', toSectionId: ids.s2 }] });
    // The new year is now current, so promoting "into" it again is refused outright.
    expect(again.status).toBe(422);
    expect(again.body.message).toMatch(/new academic year/);
    const hist = await as('PRINCIPAL').get(`/promotions/history?toAcademicYearId=${ids.nextYear}`);
    expect(hist.body.data).toHaveLength(3);
  });
});
