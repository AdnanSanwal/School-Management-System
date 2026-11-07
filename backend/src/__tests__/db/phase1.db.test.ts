/**
 * Phase 1 end-to-end: real HTTP API + real MySQL, in a throwaway school.
 *   RUN_DB_TESTS=1 npm test -- src/__tests__/db
 */
import 'dotenv/config';
import request from 'supertest';
import app from '../../app';
import { basePrisma } from '../../config/database';
import { connectRedis } from '../../config/redis';
import { dayInTimezone, toDate, addDays, toIso } from '../../utils/dates';
import { createTestSchool, tokenFor } from './helpers';

const d = process.env.RUN_DB_TESTS ? describe : describe.skip;
jest.setTimeout(60_000);

d('Phase 1 API (database)', () => {
  let t: Awaited<ReturnType<typeof createTestSchool>>;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const today = dayInTimezone('Asia/Karachi');
  const yesterday = toIso(addDays(toDate(today), -1));
  const tomorrow = toIso(addDays(toDate(today), 1));

  const api = (role: string) => ({
    get: (url: string) => request(app).get(`/api/v1${url}`).set('Authorization', `Bearer ${tok[role]}`),
    post: (url: string, body?: object) => request(app).post(`/api/v1${url}`).set('Authorization', `Bearer ${tok[role]}`).send(body ?? {}),
    put: (url: string, body: object) => request(app).put(`/api/v1${url}`).set('Authorization', `Bearer ${tok[role]}`).send(body),
    patch: (url: string, body: object) => request(app).patch(`/api/v1${url}`).set('Authorization', `Bearer ${tok[role]}`).send(body),
  });

  beforeAll(async () => {
    await connectRedis();
    t = await createTestSchool('p1');
    for (const role of ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT'] as const) tok[role] = (await t.user(role)).token;
    const gf = await basePrisma.user.findUnique({ where: { email: 'admin@school.com' } });
    if (gf) tok.OTHER_SCHOOL_ADMIN = tokenFor(gf);
  });

  afterAll(async () => {
    await t?.destroy();
    await basePrisma.$disconnect();
  });

  // ─── Setup: classes, staff, subjects ───

  it('admin creates a class with sections', async () => {
    const r = await api('ADMIN').post('/academics/classes', { name: 'Class 5', level: 5, sections: ['A', 'B'] });
    expect(r.status).toBe(201);
    ids.class5 = r.body.data.id;
    ids.secA = r.body.data.sections.find((s: any) => s.name === 'A').id;
    ids.secB = r.body.data.sections.find((s: any) => s.name === 'B').id;
  });

  it('admin adds a teacher with a login, gets a one-time password', async () => {
    const r = await api('ADMIN').post('/staff', { name: 'Test Teacher', login: { email: `teacher.${t.code}@test.local` } });
    expect(r.status).toBe(201);
    expect(r.body.data.login.temporaryPassword).toMatch(/^\w+-\d{4}-\w+$/);
    expect(r.body.data.staff.employeeNo).toBe('EMP-0001');
    ids.teacherStaff = r.body.data.staff.id;
    const u = await basePrisma.user.findUniqueOrThrow({ where: { id: r.body.data.login.user.id } });
    tok.TEACHER = tokenFor(u);

    const login = await request(app).post('/api/v1/auth/login').send({ email: u.email, password: r.body.data.login.temporaryPassword });
    expect(login.status).toBe(200);
  });

  it('a teacher only sees sections they teach', async () => {
    const subj = await api('ADMIN').post('/academics/subjects', { name: 'Maths', code: 'math' });
    expect(subj.body.data.code).toBe('MATH');
    const put = await api('ADMIN').put(`/academics/sections/${ids.secA}/subjects`, {
      assignments: [{ subjectId: subj.body.data.id, teacherId: ids.teacherStaff }],
    });
    expect(put.status).toBe(200);
    const r = await api('TEACHER').get('/academics/classes');
    expect(r.body.data).toHaveLength(1);
    expect(r.body.data[0].sections.map((s: any) => s.id)).toEqual([ids.secA]);
  });

  it('role hierarchy: admin cannot create a principal, principal can create an admin', async () => {
    const no = await api('ADMIN').post('/users', { name: 'Pp Test', email: `p2.${t.code}@test.local`, role: 'PRINCIPAL' });
    expect(no.status).toBe(403);
    const yes = await api('PRINCIPAL').post('/users', { name: 'Aa Test', email: `a2.${t.code}@test.local`, role: 'ADMIN' });
    expect(yes.status).toBe(201);
    expect(yes.body.data.temporaryPassword).toBeTruthy();
  });

  // ─── Admission, guardians, siblings ───

  it('admits a student with a new guardian + parent login', async () => {
    const r = await api('ADMIN').post('/students', {
      name: 'Ali Test', sectionId: ids.secA, gender: 'MALE',
      guardians: [{ name: 'Father Test', phone: '03009990001', relation: 'FATHER', loginEmail: `parent.${t.code}@test.local` }],
    });
    expect(r.status).toBe(201);
    expect(r.body.data.student.admissionNo).toBe('ADM-00001');
    expect(r.body.data.parentLogins).toHaveLength(1);
    ids.ali = r.body.data.student.id;
    const parent = await basePrisma.user.findUniqueOrThrow({ where: { id: r.body.data.parentLogins[0].user.id } });
    tok.PARENT = tokenFor(parent);
  });

  it('finds the guardian by phone and links a sibling', async () => {
    const found = await api('ADMIN').get('/students/guardians/search?q=9990001');
    expect(found.body.data).toHaveLength(1);
    expect(found.body.data[0].children.map((c: any) => c.name)).toEqual(['Ali Test']);
    const r = await api('ADMIN').post('/students', {
      name: 'Sara Test', sectionId: ids.secA, guardians: [{ guardianId: found.body.data[0].id, relation: 'FATHER' }],
    });
    expect(r.status).toBe(201);
    expect(r.body.data.parentLogins).toHaveLength(0);
    ids.sara = r.body.data.student.id;
  });

  it('admits a third student in another section', async () => {
    const r = await api('ADMIN').post('/students', {
      name: 'Other Child', sectionId: ids.secB, guardians: [{ name: 'Other Parent', phone: '03111234567', relation: 'MOTHER' }],
    });
    ids.other = r.body.data.student.id;
    expect(r.status).toBe(201);
  });

  it('parent sees only their two children', async () => {
    const r = await api('PARENT').get('/students');
    expect(r.body.data.map((s: any) => s.name).sort()).toEqual(['Ali Test', 'Sara Test']);
    expect((await api('PARENT').get(`/students/${ids.other}`)).status).toBe(404);
    expect((await api('PARENT').get(`/students/${ids.ali}`)).status).toBe(200);
  });

  it('another school cannot see these students', async () => {
    if (!tok.OTHER_SCHOOL_ADMIN) return;
    expect((await api('OTHER_SCHOOL_ADMIN').get(`/students/${ids.ali}`)).status).toBe(404);
  });

  it('teacher cannot admit students', async () => {
    const r = await api('TEACHER').post('/students', { name: 'X', sectionId: ids.secA, guardians: [{ name: 'Y Z', phone: '0300000000', relation: 'FATHER' }] });
    expect(r.status).toBe(403);
  });

  // ─── Attendance ───

  it('teacher marks today for their section; absent parent is notified', async () => {
    const roster = await api('TEACHER').get(`/attendance/students?sectionId=${ids.secA}`);
    expect(roster.body.data.students).toHaveLength(2);
    expect(roster.body.data.marked).toBe(false);

    const r = await api('TEACHER').put('/attendance/students', {
      sectionId: ids.secA,
      records: [{ studentId: ids.ali, status: 'PRESENT' }, { studentId: ids.sara, status: 'ABSENT' }],
    });
    expect(r.status).toBe(200);
    expect(r.body.data.parentsNotified).toBe(1);
    expect(r.body.data.summary.percent).toBe(50);

    const n = await api('PARENT').get('/notifications');
    expect(n.body.data.some((x: any) => x.type === 'ATTENDANCE_ABSENT' && x.title.includes('Sara'))).toBe(true);
  });

  it('re-saving the same absence does not notify again', async () => {
    const r = await api('TEACHER').put('/attendance/students', {
      sectionId: ids.secA, records: [{ studentId: ids.sara, status: 'ABSENT' }],
    });
    expect(r.body.data.parentsNotified).toBe(0);
  });

  it('attendance date and scope rules', async () => {
    const rec = [{ studentId: ids.other, status: 'PRESENT' }];
    expect((await api('TEACHER').put('/attendance/students', { sectionId: ids.secB, records: rec })).status).toBe(404);
    const recA = [{ studentId: ids.ali, status: 'PRESENT' }];
    expect((await api('TEACHER').put('/attendance/students', { sectionId: ids.secA, date: yesterday, records: recA })).status).toBe(403);
    expect((await api('ADMIN').put('/attendance/students', { sectionId: ids.secA, date: yesterday, records: recA })).status).toBe(200);
    expect((await api('ADMIN').put('/attendance/students', { sectionId: ids.secA, date: tomorrow, records: recA })).status).toBe(422);
    // A student from another section can't be slipped into this section's list.
    expect((await api('ADMIN').put('/attendance/students', { sectionId: ids.secA, records: rec })).status).toBe(422);
  });

  it('parent sees the monthly calendar of their child', async () => {
    const r = await api('PARENT').get(`/attendance/students/${ids.ali}/calendar?month=${today.slice(0, 7)}`);
    expect(r.status).toBe(200);
    expect(r.body.data.days.find((x: any) => x.date === today)?.status).toBe('PRESENT');
    expect((await api('PARENT').get(`/attendance/students/${ids.other}/calendar`)).status).toBe(404);
  });

  it('admin marks staff attendance; teacher cannot', async () => {
    const body = { records: [{ staffId: ids.teacherStaff, status: 'PRESENT' }] };
    expect((await api('TEACHER').put('/attendance/staff', body)).status).toBe(403);
    expect((await api('ADMIN').put('/attendance/staff', body)).status).toBe(200);
    const r = await api('OWNER').get('/attendance/staff');
    expect(r.body.data.staff.find((s: any) => s.id === ids.teacherStaff).status).toBe('PRESENT');
  });

  // ─── Fees ───

  it('fee heads + class structure', async () => {
    const tuition = await api('ADMIN').post('/fees/heads', { name: 'Tuition', frequency: 'MONTHLY' });
    const admission = await api('ADMIN').post('/fees/heads', { name: 'Admission', frequency: 'ONE_TIME' });
    ids.tuition = tuition.body.data.id;
    const r = await api('ADMIN').put(`/fees/structure/${ids.class5}`, {
      items: [{ feeHeadId: ids.tuition, amount: 3000 }, { feeHeadId: admission.body.data.id, amount: 5000 }],
    });
    expect(r.status).toBe(200);
    expect((await api('PRINCIPAL').put(`/fees/structure/${ids.class5}`, { items: [] })).status).toBe(403);
    const s = await api('ACCOUNTANT').get('/fees/structure');
    expect(s.body.data.classes[0].monthlyTotal).toBe('3000');
  });

  it('concession: admin requests, accountant cannot approve, principal approves', async () => {
    const req1 = await api('ADMIN').post('/fees/concessions', {
      studentId: ids.sara, feeHeadId: ids.tuition, type: 'PERCENT', value: 50, reason: 'Sibling', validFrom: '2026-04-01',
    });
    expect(req1.status).toBe(201);
    expect((await api('ACCOUNTANT').post(`/fees/concessions/${req1.body.data.id}/decision`, { approve: true })).status).toBe(403);
    expect((await api('PRINCIPAL').post(`/fees/concessions/${req1.body.data.id}/decision`, { approve: true })).status).toBe(200);
    expect((await api('PRINCIPAL').post(`/fees/concessions/${req1.body.data.id}/decision`, { approve: false })).status).toBe(409);
    const bad = await api('ADMIN').post('/fees/concessions', {
      studentId: ids.ali, type: 'PERCENT', value: 150, reason: 'Too much', validFrom: '2026-04-01',
    });
    expect(bad.status).toBe(422);
  });

  it('generates monthly invoices with concessions; re-running skips', async () => {
    const r = await api('ACCOUNTANT').post('/fees/invoices/generate', { period: '2026-10' });
    expect(r.status).toBe(201);
    expect(r.body.data.created).toBe(3);
    expect(r.body.data.totalBilled).toBe('7500'); // 3000 + 1500 (50% off) + 3000; one-time head excluded
    const again = await api('ACCOUNTANT').post('/fees/invoices/generate', { period: '2026-10' });
    expect(again.body.data).toMatchObject({ created: 0, skipped: 3 });
    await api('ACCOUNTANT').post('/fees/invoices/generate', { period: '2026-11', dueDay: 28 });
    expect((await api('ACCOUNTANT').post('/fees/invoices/generate', { period: '2027-06' })).status).toBe(422);
  });

  it('collection settles oldest month first and numbers receipts per school', async () => {
    const over = await api('ACCOUNTANT').post('/fees/payments', { studentId: ids.ali, amount: 6000.01, method: 'CASH' });
    expect(over.status).toBe(422);
    const noRef = await api('ACCOUNTANT').post('/fees/payments', { studentId: ids.ali, amount: 100, method: 'JAZZCASH' });
    expect(noRef.status).toBe(422);

    const r = await api('ACCOUNTANT').post('/fees/payments', { studentId: ids.ali, amount: 4500, method: 'CASH' });
    expect(r.status).toBe(201);
    expect(r.body.data.payment.receiptNo).toBe('RCP-00001');
    expect(r.body.data.allocations.map((a: any) => [a.period, a.amount, a.settles])).toEqual([
      ['2026-10', '3000', true],
      ['2026-11', '1500', false],
    ]);
    ids.aliPayment = r.body.data.payment.id;

    const r2 = await api('ADMIN').post('/fees/payments', { studentId: ids.other, amount: 3000, method: 'EASYPAISA', reference: 'EP123' });
    expect(r2.body.data.payment.receiptNo).toBe('RCP-00002');
    ids.otherPayment = r2.body.data.payment.id;
  });

  it('student fee ledger and receipt, scoped for parents', async () => {
    const ledger = await api('PARENT').get(`/fees/students/${ids.ali}`);
    expect(ledger.status).toBe(200);
    expect(ledger.body.data).toMatchObject({ pending: '1500', paidTill: '2026-10' });

    const rc = await api('PARENT').get(`/fees/payments/${ids.aliPayment}/receipt`);
    expect(rc.status).toBe(200);
    expect(rc.body.data.remainingBalance).toBe('1500');
    expect((await api('PARENT').get(`/fees/payments/${ids.otherPayment}/receipt`)).status).toBe(404);
    expect((await api('PARENT').get(`/fees/students/${ids.other}`)).status).toBe(404);

    const n = await api('PARENT').get('/notifications');
    expect(n.body.data.some((x: any) => x.type === 'FEE_PAID')).toBe(true);
  });

  it('teachers and parents cannot use finance screens', async () => {
    expect((await api('TEACHER').get('/fees/invoices')).status).toBe(403);
    expect((await api('PARENT').get('/fees/defaulters')).status).toBe(403);
    expect((await api('PARENT').get('/fees/payments')).status).toBe(403);
    expect((await api('TEACHER').post('/fees/payments', { studentId: ids.ali, amount: 1, method: 'CASH' })).status).toBe(403);
    // Parent's invoice list only contains their own children.
    const inv = await api('PARENT').get('/fees/invoices');
    expect(new Set(inv.body.data.map((i: any) => i.student.name))).toEqual(new Set(['Ali Test', 'Sara Test']));
  });

  it("today's collection and defaulters", async () => {
    const p = await api('ACCOUNTANT').get('/fees/payments');
    expect(p.body.totals.amount).toBe('7500');
    expect(p.body.data).toHaveLength(2);

    const def = await api('ACCOUNTANT').get('/fees/defaulters');
    // October (due on the 10th) is overdue and unpaid only for Sara.
    const sara = def.body.data.students.find((s: any) => s.name === 'Sara Test');
    expect(sara.months).toContain('2026-10');
    expect(def.body.data.students.every((s: any) => s.name === 'Sara Test' || !s.months.includes('2026-10'))).toBe(true);
  });

  // ─── Dashboard ───

  it('owner dashboard numbers match what happened', async () => {
    const r = await api('OWNER').get('/dashboard/overview');
    expect(r.status).toBe(200);
    const { fees, studentAttendance, staffAttendance, classStrength } = r.body.data;
    expect(fees.collectedToday).toBe('7500');
    // Open: Ali Nov 1500 + Sara Oct 1500 + Sara Nov 1500 + Other Nov 3000
    expect(fees.totalRemaining).toBe('7500');
    expect(studentAttendance).toMatchObject({ totalActive: 3, marked: 2, present: 1, absent: 1, sectionsMarked: 1, sectionsTotal: 2 });
    expect(staffAttendance).toMatchObject({ teachersTotal: 1, teachersPresent: 1 });
    expect(classStrength).toEqual([{ id: ids.class5, name: 'Class 5', strength: 3 }]);
  });

  it('dashboard blocks follow permissions', async () => {
    const acc = await api('ACCOUNTANT').get('/dashboard/overview');
    expect(acc.body.data.fees).not.toBeNull();
    expect(acc.body.data.studentAttendance).toBeNull();
    expect((await api('TEACHER').get('/dashboard/overview')).status).toBe(403);
    expect((await api('PARENT').get('/dashboard/overview')).status).toBe(403);
  });

  // ─── Leaving ───

  it('a student who left drops out of the roster and cannot be marked', async () => {
    const r = await api('ADMIN').post(`/students/${ids.other}/status`, { status: 'LEFT', reason: 'Moved city' });
    expect(r.status).toBe(200);
    const roster = await api('ADMIN').get(`/attendance/students?sectionId=${ids.secB}`);
    expect(roster.body.data.students).toHaveLength(0);
    const mark = await api('ADMIN').put('/attendance/students', { sectionId: ids.secB, records: [{ studentId: ids.other, status: 'PRESENT' }] });
    expect(mark.status).toBe(422);
  });

  it('a section with students cannot be deleted', async () => {
    expect((await request(app).delete(`/api/v1/academics/sections/${ids.secA}`).set('Authorization', `Bearer ${tok.ADMIN}`)).status).toBe(409);
  });
});
