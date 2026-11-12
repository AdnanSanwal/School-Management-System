/**
 * SchoolPro change request (Nov 2026): CR-01 dashboard drill-downs, CR-02 report view,
 * CR-03 class archive, CR-04 per-student monthly fee, CR-05 usernames + first-login password,
 * plus staff reactivation.
 *   RUN_DB_TESTS=1 npm test -- src/__tests__/db/changeRequest
 */
import 'dotenv/config';
import request from 'supertest';
import app from '../../app';
import { basePrisma } from '../../config/database';
import { connectRedis } from '../../config/redis';
import { dayInTimezone } from '../../utils/dates';
import { createTestSchool } from './helpers';

const d = process.env.RUN_DB_TESTS ? describe : describe.skip;
jest.setTimeout(120_000);

d('Change request CR-01…CR-05 (database)', () => {
  let t: Awaited<ReturnType<typeof createTestSchool>>;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const as = (token: string) => {
    const h = { Authorization: `Bearer ${token}` };
    return {
      get: (u: string) => request(app).get(`/api/v1${u}`).set(h),
      post: (u: string, b?: object) => request(app).post(`/api/v1${u}`).set(h).send(b ?? {}),
      put: (u: string, b: object) => request(app).put(`/api/v1${u}`).set(h).send(b),
      patch: (u: string, b: object) => request(app).patch(`/api/v1${u}`).set(h).send(b),
    };
  };
  const login = (email: string, password: string) => request(app).post('/api/v1/auth/login').send({ email, password });
  const uname = (base: string) => `${base}.${t.code.replace(/[^a-z0-9]/g, '').slice(-10)}`;

  beforeAll(async () => {
    await connectRedis();
    t = await createTestSchool('cr');
    for (const r of ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT'] as const) tok[r] = (await t.user(r)).token;
    const A = as(tok.ADMIN);
    const cls = await A.post('/academics/classes', { name: 'Class 4', level: 4, sections: ['A'] });
    ids.class = cls.body.data.id;
    ids.section = cls.body.data.sections[0].id;
    const heads: Record<string, string> = {};
    for (const [name, frequency] of [['Tuition', 'MONTHLY'], ['Lab', 'MONTHLY'], ['Annual Charges', 'ANNUAL']] as const) {
      heads[name] = (await A.post('/fees/heads', { name, frequency })).body.data.id;
    }
    await A.put(`/fees/structure/${ids.class}`, { items: [{ feeHeadId: heads.Tuition, amount: 4000 }, { feeHeadId: heads.Lab, amount: 500 }, { feeHeadId: heads['Annual Charges'], amount: 6000 }] });
  });
  afterAll(async () => { await t.destroy(); });

  // ─── CR-05 ───
  it('CR-05: usernames are checked live, with free alternatives when taken', async () => {
    const A = as(tok.ADMIN);
    const wanted = uname('ali');
    const free = await A.get(`/users/username-check?username=${wanted}&name=Ali Raza`);
    expect(free.body.data).toMatchObject({ username: wanted, valid: true, available: true });
    const created = await A.post('/staff', { name: 'Ali Raza', isTeacher: true, login: { username: wanted, password: 'Initial@123', role: 'TEACHER' } });
    expect(created.status).toBe(201);
    expect(created.body.data.login.user).toMatchObject({ username: wanted, email: null });
    ids.staffAli = created.body.data.staff.id;

    const taken = await A.get(`/users/username-check?username=${wanted}&name=Ali Raza`);
    expect(taken.body.data.available).toBe(false);
    expect(taken.body.data.message).toMatch(/already taken/);
    expect(taken.body.data.suggestions.length).toBeGreaterThan(0);
    expect(taken.body.data.suggestions).not.toContain(wanted);
    expect((await A.get('/users/username-check?username=a b@c')).body.data.valid).toBe(false);
    // Creating the same username again is refused with a clear message.
    const dup = await A.post('/staff', { name: 'Other Ali', login: { username: wanted, password: 'Initial@123', role: 'TEACHER' } });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toMatch(/already taken/);
  });

  it('CR-05: first sign-in with the admin-set password must set a new one before anything else', async () => {
    const s = await login(uname('ali'), 'Initial@123');
    expect(s.status).toBe(200);
    expect(s.body.data.user.mustChangePassword).toBe(true);
    const tokenBefore = s.body.data.accessToken;
    const blocked = await as(tokenBefore).get('/timetable/today');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await as(tokenBefore).get('/auth/me')).status).toBe(200);

    expect((await as(tokenBefore).post('/auth/change-password', { currentPassword: 'Initial@123', newPassword: 'Initial@123' })).status).toBe(400);
    const changed = await as(tokenBefore).post('/auth/change-password', { currentPassword: 'Initial@123', newPassword: 'MyOwn@2026' });
    expect(changed.status).toBe(200);
    expect(changed.body.data.user.mustChangePassword).toBe(false);
    expect((await as(changed.body.data.accessToken).get('/timetable/today')).status).toBe(200);
    expect((await as(tokenBefore).get('/auth/me')).status).toBe(401); // the old session is gone
    expect((await login(uname('ali'), 'MyOwn@2026')).body.data.user.mustChangePassword).toBe(false);
  });

  it('CR-05: staff can change their own username / email with their password; nobody else’s', async () => {
    const me = (await login(uname('ali'), 'MyOwn@2026')).body.data.accessToken;
    const noPw = await as(me).patch('/auth/profile', { name: 'Ali Raza', username: uname('ali.r') });
    expect(noPw.status).toBe(400);
    const ok = await as(me).patch('/auth/profile', { name: 'Ali Raza', username: uname('ali.r'), email: `ali.${t.code}@test.local`, currentPassword: 'MyOwn@2026' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.username).toBe(uname('ali.r'));
    expect((await login(`ali.${t.code}@test.local`, 'MyOwn@2026')).status).toBe(200); // email works now too
    // The profile route only ever edits the caller.
    const other = await as(me).patch('/auth/profile', { name: 'Hacked', userId: 'x' });
    expect(other.status).toBe(422);
  });

  it('staff can be reactivated after leaving; their login works again', async () => {
    const A = as(tok.ADMIN);
    expect((await A.patch(`/staff/${ids.staffAli}`, { status: 'LEFT' })).status).toBe(200);
    expect((await login(uname('ali.r'), 'MyOwn@2026')).status).toBe(403);
    const back = await A.patch(`/staff/${ids.staffAli}`, { status: 'ACTIVE' });
    expect(back.status).toBe(200);
    expect(back.body.data.status).toBe('ACTIVE');
    expect((await login(uname('ali.r'), 'MyOwn@2026')).status).toBe(200);
  });

  // ─── CR-04 ───
  it('CR-04: the accountant admits a student with their own monthly fee; invoices use it', async () => {
    const C = as(tok.ACCOUNTANT);
    const admit = await C.post('/students', { admissionNo: `T-${Math.random().toString(36).slice(2, 10)}`,
      name: 'Own Fee Student', sectionId: ids.section, monthlyFee: 3000,
      guardians: [{ name: 'Parent One', phone: '03001112233', relation: 'FATHER', isPrimary: true }],
    });
    expect(admit.status).toBe(201);
    expect(Number(admit.body.data.student.monthlyFee)).toBe(3000);
    ids.ownFee = admit.body.data.student.id;
    const classFee = await as(tok.ADMIN).post('/students', { admissionNo: `T-${Math.random().toString(36).slice(2, 10)}`,
      name: 'Class Fee Student', sectionId: ids.section,
      guardians: [{ name: 'Parent Two', phone: '03001112244', relation: 'MOTHER', isPrimary: true }],
    });
    ids.classFee = classFee.body.data.student.id;
    // Admission only: the accountant can't edit students.
    expect((await C.patch(`/students/${ids.ownFee}`, { name: 'Renamed' })).status).toBe(403);

    const gen = await C.post('/fees/invoices/generate', { period: '2026-11', classIds: [ids.class], includeAnnual: true });
    expect(gen.status).toBe(201);
    const invoices = await basePrisma.feeInvoice.findMany({ where: { schoolId: t.school.id }, include: { items: { include: { feeHead: true } } } });
    const lines = (sid: string) => Object.fromEntries(invoices.find((i) => i.studentId === sid)!.items.map((it) => [it.feeHead.name, Number(it.amount)]));
    expect(lines(ids.ownFee)).toEqual({ 'Monthly Fee': 3000, 'Annual Charges': 6000 });
    expect(lines(ids.classFee)).toEqual({ Tuition: 4000, Lab: 500, 'Annual Charges': 6000 });

    // The per-student head never appears as a column of the class fee grid.
    const grid = await as(tok.ADMIN).get('/fees/structure');
    expect(grid.body.data.heads.map((h: any) => h.name)).not.toContain('Monthly Fee');
  });

  it('CR-04: the fee can be changed later, or cleared to follow the class again', async () => {
    const C = as(tok.ACCOUNTANT);
    expect(Number((await C.put(`/students/${ids.ownFee}/monthly-fee`, { monthlyFee: 3500 })).body.data.monthlyFee)).toBe(3500);
    expect((await C.put(`/students/${ids.ownFee}/monthly-fee`, { monthlyFee: -1 })).status).toBe(422);
    expect((await C.put(`/students/${ids.ownFee}/monthly-fee`, { monthlyFee: null })).body.data.monthlyFee).toBeNull();
    expect((await as(tok.PRINCIPAL).put(`/students/${ids.ownFee}/monthly-fee`, { monthlyFee: 1 })).status).toBe(403);
  });

  // ─── CR-01 ───
  it('CR-01: every dashboard card has its live detail list', async () => {
    const C = as(tok.ACCOUNTANT);
    const inv = await basePrisma.feeInvoice.findFirstOrThrow({ where: { studentId: ids.classFee } });
    const pay = await C.post('/fees/payments', { studentId: ids.classFee, amount: 2000, method: 'CASH', invoiceIds: [inv.id] });
    expect(pay.status).toBe(201);

    const fees = await C.get('/dashboard/details/fees-today');
    expect(fees.status).toBe(200);
    expect(fees.body.data.rows).toEqual([expect.objectContaining({ student: 'Class Fee Student', receiptNo: pay.body.data.payment.receiptNo })]);
    expect(Number(fees.body.data.total)).toBe(2000);

    const out = await C.get('/dashboard/details/outstanding');
    const byName = Object.fromEntries(out.body.data.rows.map((r: any) => [r.student, Number(r.pending)]));
    expect(byName).toEqual({ 'Own Fee Student': 9000, 'Class Fee Student': 8500 });
    expect(Number(out.body.data.total)).toBe(17500);

    await as(tok.ADMIN).put('/attendance/students', { sectionId: ids.section, records: [{ studentId: ids.ownFee, status: 'PRESENT' }, { studentId: ids.classFee, status: 'ABSENT' }] });
    const present = await as(tok.PRINCIPAL).get('/dashboard/details/students-present');
    expect(present.body.data.rows.map((r: any) => r.student)).toEqual(['Own Fee Student']);
    expect(present.body.data.date).toBe(dayInTimezone('Asia/Karachi'));

    const staff = await as(tok.PRINCIPAL).get('/dashboard/details/staff-present');
    expect(staff.status).toBe(200);
    const teachers = await basePrisma.staff.count({ where: { schoolId: t.school.id, status: 'ACTIVE', isTeacher: true } });
    expect(staff.body.data.counts.total).toBe(teachers);
    expect(staff.body.data.rows.map((r: any) => r.name)).toContain('Ali Raza');

    const alerts = await as(tok.PRINCIPAL).get('/dashboard/details/alerts');
    expect(alerts.status).toBe(200);
    expect(Array.isArray(alerts.body.data.groups)).toBe(true);
    // The accountant has no attendance rights: that card is closed to them.
    expect((await C.get('/dashboard/details/students-present')).status).toBe(403);
  });

  // ─── CR-02 ───
  it('CR-02: reports open on screen as data, filterable by student, never as a download', async () => {
    const C = as(tok.ACCOUNTANT);
    const today = dayInTimezone('Asia/Karachi');
    const all = await C.get(`/reports/fee-collection?format=view&from=${today}&to=${today}`);
    expect(all.status).toBe(200);
    expect(all.headers['content-disposition']).toBeUndefined();
    expect(all.body.data).toMatchObject({ title: 'Fee collection', columns: expect.any(Array) });
    expect(all.body.data.rows).toHaveLength(1);
    const other = await C.get(`/reports/fee-collection?format=view&from=${today}&to=${today}&studentId=${ids.ownFee}`);
    expect(other.body.data.rows).toHaveLength(0);
    const summary = await C.get(`/reports/fee-monthly-summary?format=view&classId=${ids.class}`);
    expect(summary.status).toBe(200);
    // The PDF is still a separate download.
    const pdf = await C.get(`/reports/fee-collection?format=pdf&from=${today}&to=${today}`);
    expect(pdf.headers['content-disposition']).toMatch(/attachment/);
  });

  // ─── CR-03 ───
  it('CR-03: a class is archived (hidden everywhere, history kept) and can be restored', async () => {
    const A = as(tok.ADMIN);
    const busy = await A.post(`/academics/classes/${ids.class}/archive`);
    expect(busy.status).toBe(409);
    expect(busy.body.message).toMatch(/active student/);

    const empty = await A.post('/academics/classes', { name: 'Class 10', level: 10, sections: ['A'] });
    const id = empty.body.data.id;
    expect((await A.post(`/academics/classes/${id}/archive`)).status).toBe(200);
    expect((await A.get('/academics/classes')).body.data.map((c: any) => c.name)).not.toContain('Class 10');
    expect((await A.get('/academics/classes?archived=true')).body.data.map((c: any) => c.name)).toEqual(['Class 10']);
    expect((await A.get('/fees/structure')).body.data.classes.map((c: any) => c.name)).not.toContain('Class 10');
    const again = await A.post('/academics/classes', { name: 'Class 10', level: 10 });
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/Restore it instead/);

    expect((await A.post(`/academics/classes/${id}/restore`)).status).toBe(200);
    expect((await A.get('/academics/classes')).body.data.map((c: any) => c.name)).toContain('Class 10');
  });
});
