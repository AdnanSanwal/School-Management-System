/**
 * HR step 1: staff profile fields and documents, department/designation lists,
 * salary structures with history, leave policy and balances.
 *   RUN_DB_TESTS=1 npm test -- src/__tests__/db/hr
 */
import 'dotenv/config';
import request from 'supertest';
import app from '../../app';
import { basePrisma } from '../../config/database';
import { connectRedis } from '../../config/redis';
import { addDays, dayInTimezone, toDate, toIso } from '../../utils/dates';
import { daysWithin } from '../../utils/hr';
import { createTestSchool } from './helpers';

const d = process.env.RUN_DB_TESTS ? describe : describe.skip;
jest.setTimeout(120_000);

describe('daysWithin', () => {
  const day = (s: string) => new Date(`${s}T00:00:00Z`);
  it.each([
    ['2026-05-01', '2026-05-03', 3],
    ['2026-03-30', '2026-04-02', 2], // only 1–2 April fall in the year
    ['2027-03-30', '2027-04-05', 2], // only 30–31 March
    ['2025-01-01', '2025-01-05', 0],
  ])('%s to %s → %i day(s) inside the year', (a, b, n) => {
    expect(daysWithin(day(a), day(b), day('2026-04-01'), day('2027-03-31'))).toBe(n);
  });
});

d('HR records (database)', () => {
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

  beforeAll(async () => {
    await connectRedis();
    t = await createTestSchool('hr');
    for (const r of ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER'] as const) {
      const u = await t.user(r);
      tok[r] = u.token;
      ids[`user${r}`] = u.id;
    }
    // The teacher login needs a staff record to apply for leave.
    const staff = await basePrisma.staff.create({ data: { schoolId: t.school.id, userId: ids.userTEACHER, employeeNo: 'T-1', name: 'Sana Teacher', designation: 'Teacher', department: 'Science' } });
    ids.teacher = staff.id;
  });
  afterAll(async () => { await t.destroy(); });

  it('staff profile keeps the HR details; the detail view carries leave balance and pay by role', async () => {
    const A = as('ADMIN');
    const created = await A.post('/staff', {
      name: 'Bilal Clerk', designation: 'Clerk', department: 'Office', isTeacher: false, joiningDate: '2025-08-01',
      cnic: '35202-1234567-1', dateOfBirth: '1990-02-14', gender: 'MALE', email: 'bilal@example.com', address: 'Model Town',
      emergencyContactName: 'Father', emergencyContactPhone: '03001234567', contractType: 'CONTRACT',
      bankName: 'HBL', bankAccountTitle: 'Bilal', bankAccountNo: 'PK36HABB0000000000000001',
    });
    expect(created.status).toBe(201);
    ids.clerk = created.body.data.staff.id;

    const upd = await A.patch(`/staff/${ids.clerk}`, { contractType: 'PERMANENT', bankName: 'Meezan', dateOfBirth: null });
    expect(upd.status).toBe(200);

    const view = await A.get(`/staff/${ids.clerk}`);
    expect(view.body.data).toMatchObject({ cnic: '35202-1234567-1', contractType: 'PERMANENT', bankName: 'Meezan', dateOfBirth: null, joiningDate: '2025-08-01', salary: null });
    expect(view.body.data.leave.balances.find((b: any) => b.type === 'CASUAL')).toMatchObject({ allowed: 10, used: 0, remaining: 10 });
    // Teachers can't open staff records at all.
    expect((await as('TEACHER').get(`/staff/${ids.clerk}`)).status).toBe(403);
  });

  it('department and designation lists: add, rename (staff follow), no delete while in use', async () => {
    const A = as('ADMIN');
    const dep = await A.post('/hr/departments', { name: 'Office' });
    expect(dep.status).toBe(201);
    expect((await A.post('/hr/departments', { name: 'Office' })).status).toBe(409);
    expect((await as('PRINCIPAL').post('/hr/departments', { name: 'Sports' })).status).toBe(403);

    expect((await A.patch(`/hr/departments/${dep.body.data.id}`, { name: 'Administration' })).status).toBe(200);
    expect((await basePrisma.staff.findUniqueOrThrow({ where: { id: ids.clerk } })).department).toBe('Administration');
    const opts = await A.get('/hr/options');
    expect(opts.body.data.departments).toEqual([expect.objectContaining({ name: 'Administration', staff: 1 })]);
    const inUse = await A.del(`/hr/departments/${dep.body.data.id}`);
    expect(inUse.status).toBe(409);
    expect(inUse.body.message).toMatch(/Move them first/);
    const des = await A.post('/hr/designations', { name: 'Lab Assistant' });
    expect((await A.del(`/hr/designations/${des.body.data.id}`)).status).toBe(200);
  });

  it('salary: first structure, a future raise, totals, and who may see or set it', async () => {
    const A = as('ADMIN');
    const start = toIso(addDays(toDate(today), -60));
    const raiseOn = toIso(addDays(toDate(today), 20));
    const first = await A.post(`/hr/staff/${ids.clerk}/salary`, {
      effectiveFrom: start, basic: 40000,
      components: [{ kind: 'ALLOWANCE', name: 'House rent', amount: 8000 }, { kind: 'ALLOWANCE', name: 'Transport', amount: 2000 }, { kind: 'DEDUCTION', name: 'Income tax', amount: 1500 }],
    });
    expect(first.status).toBe(201);
    expect(first.body.data.current).toMatchObject({ effectiveFrom: start });
    expect(Number(first.body.data.current.gross)).toBe(50000);
    expect(Number(first.body.data.current.net)).toBe(48500);

    const raise = await A.post(`/hr/staff/${ids.clerk}/salary`, { effectiveFrom: raiseOn, basic: 45000, components: [{ kind: 'ALLOWANCE', name: 'House rent', amount: 9000 }], note: 'Annual increment' });
    expect(raise.body.message).toMatch(/takes effect/);
    expect(raise.body.data.history).toHaveLength(2);
    expect(Number(raise.body.data.current.basic)).toBe(40000); // the raise hasn't started yet

    // Bad input
    expect((await A.post(`/hr/staff/${ids.clerk}/salary`, { effectiveFrom: start, basic: 1000, components: [{ kind: 'DEDUCTION', name: 'Loan', amount: 5000 }] })).status).toBe(422);
    expect((await A.post(`/hr/staff/${ids.clerk}/salary`, { effectiveFrom: start, basic: 1000, components: [{ kind: 'ALLOWANCE', name: 'Fuel', amount: 1 }, { kind: 'ALLOWANCE', name: 'fuel', amount: 2 }] })).status).toBe(422);

    // Who sees pay: owner, principal, accountant yes; teacher no. Only the admin sets it.
    for (const r of ['OWNER', 'PRINCIPAL', 'ACCOUNTANT']) expect((await as(r).get(`/hr/staff/${ids.clerk}/salary`)).status).toBe(200);
    expect((await as('TEACHER').get(`/hr/staff/${ids.clerk}/salary`)).status).toBe(403);
    expect((await as('ACCOUNTANT').post(`/hr/staff/${ids.clerk}/salary`, { effectiveFrom: start, basic: 1 })).status).toBe(403);

    const sheet = await as('ACCOUNTANT').get('/hr/salaries');
    expect(sheet.status).toBe(200);
    const row = sheet.body.data.rows.find((r: any) => r.id === ids.clerk);
    expect(Number(row.salary.net)).toBe(48500);
    expect(Number(sheet.body.data.totals.net)).toBe(48500);
    expect(sheet.body.data.totals.withSalary).toBe(1);

    // Removing the raise leaves the first structure in force.
    const raiseId = raise.body.data.history.find((h: any) => h.effectiveFrom === raiseOn).id;
    expect((await A.del(`/hr/salary/${raiseId}`)).status).toBe(200);
    expect((await A.get(`/hr/staff/${ids.clerk}/salary`)).body.data.history).toHaveLength(1);
  });

  it('leave policy and balances: allowance, pending, and days beyond it counted as unpaid', async () => {
    const A = as('ADMIN');
    const saved = await A.put('/hr/leave-policy', { items: [{ type: 'CASUAL', daysPerYear: 3, isPaid: true }, { type: 'ANNUAL', daysPerYear: 14, isPaid: true }, { type: 'UNPAID', daysPerYear: 5, isPaid: false }] });
    expect(saved.status).toBe(200);
    expect(saved.body.data.find((p: any) => p.type === 'UNPAID')).toMatchObject({ daysPerYear: 0, isPaid: false });
    expect((await as('PRINCIPAL').put('/hr/leave-policy', { items: [{ type: 'CASUAL', daysPerYear: 1, isPaid: true }] })).status).toBe(403);

    const T = as('TEACHER');
    const d1 = toIso(addDays(toDate(today), 3));
    const d2 = toIso(addDays(toDate(today), 4));
    const ok = await T.post('/leave', { type: 'CASUAL', fromDate: d1, toDate: d2, reason: 'Family event' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.unpaidDays).toBe(0);
    // Two more days: one is within the allowance of 3, one is beyond it.
    const over = await T.post('/leave', { type: 'CASUAL', fromDate: toIso(addDays(toDate(today), 10)), toDate: toIso(addDays(toDate(today), 11)), reason: 'Travel' });
    expect(over.status).toBe(201);
    expect(over.body.data.unpaidDays).toBe(1);
    expect(over.body.message).toMatch(/would be unpaid/);

    const mine = await T.get('/leave/mine');
    expect(mine.body.data.balances.find((b: any) => b.type === 'CASUAL')).toMatchObject({ allowed: 3, used: 0, pending: 4, remaining: 3 });

    for (const l of mine.body.data.requests) expect((await as('PRINCIPAL').post(`/leave/${l.id}/decision`, { approve: true })).status).toBe(200);
    const all = await as('ACCOUNTANT').get('/hr/leave-balances');
    expect(all.status).toBe(200);
    const casual = all.body.data.staff.find((s: any) => s.id === ids.teacher).balances.find((b: any) => b.type === 'CASUAL');
    expect(casual).toMatchObject({ allowed: 3, used: 4, pending: 0, remaining: 0, unpaid: 1 });

    // Own summary for the teacher: profile, leave, and no salary set yet.
    const me = await T.get('/hr/me');
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject({ staff: { name: 'Sana Teacher' }, salary: null, canSeeAllSalaries: false });
  });

  it('staff documents: upload, download link, delete; only real PDFs/images', async () => {
    const A = request(app);
    const h = { Authorization: `Bearer ${tok.ADMIN}` };
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
    const up = await A.post(`/api/v1/staff/${ids.clerk}/documents`).set(h).field('title', 'CNIC copy').attach('file', pdf, 'cnic.pdf');
    expect(up.status).toBe(201);
    expect(up.body.data.href).toMatch(/^https?:\/\//);
    expect(up.body.data.storageKey).toBeUndefined();
    const bad = await A.post(`/api/v1/staff/${ids.clerk}/documents`).set(h).field('title', 'Script').attach('file', Buffer.from('<script>alert(1)</script>'), 'x.pdf');
    expect(bad.status).toBe(415);

    const view = await as('ADMIN').get(`/staff/${ids.clerk}`);
    expect(view.body.data.documents).toHaveLength(1);
    expect((await as('ADMIN').del(`/staff/${ids.clerk}/documents/${up.body.data.id}`)).status).toBe(200);
    expect((await as('ADMIN').get(`/staff/${ids.clerk}`)).body.data.documents).toHaveLength(0);
  });
});
