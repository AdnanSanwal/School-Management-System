/**
 * Regression tests for the review fixes: account profile + two-step login, timetable
 * busy times, browser push subscribe/unsubscribe, late fees in a student's pending total,
 * transport not offered in the class fee structure.
 *   RUN_DB_TESTS=1 npm test -- src/__tests__/db/fixes
 */
import 'dotenv/config';
import request from 'supertest';
import { authenticator } from 'otplib';
import app from '../../app';
import { basePrisma } from '../../config/database';
import { connectRedis } from '../../config/redis';
import { createTestSchool } from './helpers';

const d = process.env.RUN_DB_TESTS ? describe : describe.skip;
jest.setTimeout(120_000);

d('Review fixes (database)', () => {
  let t: Awaited<ReturnType<typeof createTestSchool>>;
  const users: Record<string, Awaited<ReturnType<Awaited<ReturnType<typeof createTestSchool>>['user']>>> = {};
  const as = (role: string) => {
    const h = { Authorization: `Bearer ${users[role].token}` };
    return {
      get: (u: string) => request(app).get(`/api/v1${u}`).set(h),
      post: (u: string, b?: object) => request(app).post(`/api/v1${u}`).set(h).send(b ?? {}),
      put: (u: string, b: object) => request(app).put(`/api/v1${u}`).set(h).send(b),
      patch: (u: string, b: object) => request(app).patch(`/api/v1${u}`).set(h).send(b),
      del: (u: string, b?: object) => request(app).delete(`/api/v1${u}`).set(h).send(b ?? {}),
    };
  };

  beforeAll(async () => {
    await connectRedis();
    t = await createTestSchool('fix');
    for (const r of ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT'] as const) users[r] = await t.user(r);
  });
  afterAll(async () => { await t.destroy(); });

  it('every role can edit their own profile; email stays', async () => {
    const res = await as('ACCOUNTANT').patch('/auth/profile', { name: 'Kashif Updated', phone: '03001112233' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'Kashif Updated', phone: '03001112233', email: users.ACCOUNTANT.email });
    const bad = await as('ACCOUNTANT').patch('/auth/profile', { name: 'X', email: 'new@x.com' });
    expect(bad.status).toBe(422);
  });

  it('two-step login: set up, sign in with a code, turning off needs the password', async () => {
    const A = as('PRINCIPAL');
    const setup = await A.post('/auth/mfa/enable');
    expect(setup.status).toBe(200);
    const { secret } = setup.body.data;
    expect((await A.post('/auth/mfa/verify', { code: '000000' })).status).toBe(400);
    expect((await A.post('/auth/mfa/verify', { code: authenticator.generate(secret) })).status).toBe(200);
    // Can't silently replace an active secret.
    expect((await A.post('/auth/mfa/enable')).status).toBe(409);

    const login = (mfaCode?: string) => request(app).post('/api/v1/auth/login').send({ email: users.PRINCIPAL.email, password: 'Test@12345', mfaCode });
    const noCode = await login();
    expect(noCode.status).toBe(403);
    expect(noCode.body.message).toBe('MFA code required');
    expect((await login(authenticator.generate(secret))).status).toBe(200);

    expect((await A.post('/auth/mfa/disable', { password: 'wrong' })).status).toBe(400);
    expect((await A.post('/auth/mfa/disable', { password: 'Test@12345' })).status).toBe(200);
    expect((await login()).status).toBe(200);
  });

  it('reset-password rejects short passwords; forgot-password never fails', async () => {
    expect((await request(app).post('/api/v1/auth/reset-password').send({ token: 'x'.repeat(20), newPassword: '123' })).status).toBe(422);
    expect((await request(app).post('/api/v1/auth/forgot-password').send({ email: users.ADMIN.email })).status).toBe(200);
  });

  it('timetable busy list shows other sections only, so the editor can grey teachers out', async () => {
    const A = as('ADMIN');
    const cls = await A.post('/academics/classes', { name: 'Class 5', level: 5, sections: ['A', 'B'] });
    const [sA, sB] = cls.body.data.sections.map((s: any) => s.id);
    const subject = await basePrisma.subject.create({ data: { schoolId: t.school.id, name: 'Maths', code: 'M5' } });
    const teacher = await basePrisma.staff.create({ data: { schoolId: t.school.id, employeeNo: 'T-1', name: 'Busy Teacher', isTeacher: true } });
    const slot = { dayOfWeek: 'MONDAY', period: 1, startTime: '09:00', endTime: '09:40', subjectId: subject.id, teacherId: teacher.id };
    expect((await A.put(`/timetable/section/${sA}`, { slots: [slot] })).status).toBe(200);

    const busyForB = await A.get(`/timetable/busy?excludeSectionId=${sB}`);
    expect(busyForB.status).toBe(200);
    expect(busyForB.body.data).toEqual([expect.objectContaining({ teacherId: teacher.id, dayOfWeek: 'MONDAY', startTime: '09:00', section: 'Class 5-A' })]);
    // Editing section A itself: its own periods are not "busy".
    expect((await A.get(`/timetable/busy?excludeSectionId=${sA}`)).body.data).toEqual([]);
    // Saving B with the same teacher at an overlapping time is still refused on the server.
    const clash = await A.put(`/timetable/section/${sB}`, { slots: [{ ...slot, startTime: '09:20', endTime: '10:00' }] });
    expect(clash.status).toBe(409);
    // Teachers can't read it.
    const teacherUser = await t.user('TEACHER');
    users.TEACHER = teacherUser;
    expect((await as('TEACHER').get(`/timetable/busy?excludeSectionId=${sB}`)).status).toBe(403);
  });

  it('browser push: subscribe with the browser shape; unsubscribe removes only that device', async () => {
    const A = as('ADMIN');
    const sub = (n: number) => ({ endpoint: `https://push.example/${t.code}/${n}`, keys: { p256dh: `p${n}`, auth: `a${n}` } });
    expect((await A.post('/push/subscribe', sub(1))).status).toBe(201);
    expect((await A.post('/push/subscribe', sub(2))).status).toBe(201);
    expect((await A.post('/push/subscribe', { endpoint: 'https://x' })).status).toBe(422);
    expect((await A.del('/push/unsubscribe', { endpoint: sub(1).endpoint })).status).toBe(200);
    const left = await basePrisma.pushSubscription.findMany({ where: { userId: users.ADMIN.id } });
    expect(left.map((s) => s.endpoint)).toEqual([sub(2).endpoint]);
  });

  it("a student's pending fee includes late fees, like the ledger", async () => {
    const student = await basePrisma.student.create({ data: { schoolId: t.school.id, admissionNo: 'F-1', name: 'Late Payer', admissionDate: new Date('2026-04-01') } });
    await basePrisma.feeInvoice.create({
      data: {
        schoolId: t.school.id, studentId: student.id, academicYearId: t.year.id, invoiceNo: 'INV-F1', period: '2026-10',
        issueDate: new Date('2026-10-01'), dueDate: new Date('2026-10-10'), grossAmount: 5000, netAmount: 5000, fineAmount: 300, paidAmount: 1000, status: 'PARTIAL',
      },
    });
    const res = await as('ACCOUNTANT').get(`/students/${student.id}`);
    expect(Number(res.body.data.fees.pending)).toBe(4300);
    const ledger = await as('ACCOUNTANT').get(`/fees/students/${student.id}`);
    expect(Number(ledger.body.data.pending)).toBe(4300);
  });

  it('the class fee structure does not offer Transport (billed per route)', async () => {
    await basePrisma.feeHead.create({ data: { schoolId: t.school.id, name: 'Transport', frequency: 'MONTHLY' } });
    await basePrisma.feeHead.create({ data: { schoolId: t.school.id, name: 'Tuition', frequency: 'MONTHLY' } });
    const res = await as('ADMIN').get('/fees/structure');
    expect(res.body.data.heads.map((h: any) => h.name)).toEqual(['Tuition']);
  });
});
