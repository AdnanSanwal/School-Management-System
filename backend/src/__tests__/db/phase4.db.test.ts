/**
 * Phase 4 end-to-end: leave & approvals, payment proof, gateway checkout, late fines,
 * low-attendance alerts, PDF/Excel reports, daily jobs.
 *   RUN_DB_TESTS=1 npm test -- src/__tests__/db/phase4
 */
import 'dotenv/config';
import os from 'os';
import path from 'path';
import fs from 'fs';
import request from 'supertest';
import ExcelJS from 'exceljs';

process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-p4-'));
process.env.PAYMENT_GATEWAY = 'test';

import app from '../../app';
import { basePrisma } from '../../config/database';
import { connectRedis } from '../../config/redis';
import { dayInTimezone } from '../../utils/dates';
import { runDailyJobsForSchool } from '../../jobs/daily';
import { createTestSchool, tokenFor } from './helpers';

const d = process.env.RUN_DB_TESTS ? describe : describe.skip;
jest.setTimeout(90_000);

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const binary = (res: any, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

d('Phase 4 API (database)', () => {
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
      multipart: (u: string) => request(app).post(`/api/v1${u}`).set(h),
      file: (u: string) => request(app).get(`/api/v1${u}`).set(h).buffer(true).parse(binary),
    };
  };
  const notes = async (role: string) => (await as(role).get('/notifications')).body.data as any[];
  const ledger = async (studentId: string) => (await as('ACCOUNTANT').get(`/fees/students/${studentId}`)).body.data;

  beforeAll(async () => {
    await connectRedis();
    t = await createTestSchool('p4');
    for (const r of ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT'] as const) tok[r] = (await t.user(r)).token;
    const A = as('ADMIN');
    const cls = await A.post('/academics/classes', { name: 'Class 2', level: 2, sections: ['A'] });
    ids.class = cls.body.data.id;
    ids.sec = cls.body.data.sections[0].id;
    const st = await A.post('/staff', { name: 'Leave Teacher', login: { email: `lt.${t.code}@test.local` } });
    ids.staff = st.body.data.staff.id;
    tok.TEACHER = tokenFor(await basePrisma.user.findUniqueOrThrow({ where: { id: st.body.data.login.user.id } }));
    await request(app).patch(`/api/v1/academics/sections/${ids.sec}`).set({ Authorization: `Bearer ${tok.ADMIN}` }).send({ classTeacherId: ids.staff });

    for (const [i, key] of ['P1', 'P2'].entries()) {
      const r = await A.post('/students', {
        name: `Child ${key}`, sectionId: ids.sec,
        guardians: [{ name: `Parent ${key}`, phone: `0300555000${i}`, relation: 'FATHER', loginEmail: `${key.toLowerCase()}.${t.code}@test.local` }],
      });
      ids[`${key}_child`] = r.body.data.student.id;
      tok[key] = tokenFor(await basePrisma.user.findUniqueOrThrow({ where: { id: r.body.data.parentLogins[0].user.id } }));
    }
    const head = await A.post('/fees/heads', { name: 'Tuition', frequency: 'MONTHLY' });
    await A.put(`/fees/structure/${ids.class}`, { items: [{ feeHeadId: head.body.data.id, amount: 2500 }] });
    for (const period of ['2026-09', '2026-10', '2026-11', '2026-12']) await as('ACCOUNTANT').post('/fees/invoices/generate', { period, dueDay: 10 });
    const inv = (await ledger(ids.P1_child)).invoices;
    for (const i of inv) ids[`P1_${i.period}`] = i.id;
  });

  afterAll(async () => {
    await t?.destroy();
    await basePrisma.$disconnect();
  });

  // ─── Leave & approvals ───

  it('teacher applies for leave; principal is notified; overlaps are refused', async () => {
    const r = await as('TEACHER').post('/leave', { type: 'SICK', fromDate: today, toDate: today, reason: 'Fever' });
    expect(r.status).toBe(201);
    ids.leave = r.body.data.id;
    expect((await notes('PRINCIPAL')).some((n) => n.type === 'LEAVE_REQUESTED')).toBe(true);
    expect((await as('TEACHER').post('/leave', { type: 'CASUAL', fromDate: today, toDate: today, reason: 'Again' })).status).toBe(409);
    expect((await as('P1').post('/leave', { fromDate: today, toDate: today, reason: 'Nope' })).status).toBe(403);
  });

  it('approvals inbox shows what each role can decide', async () => {
    const p = await as('PRINCIPAL').get('/approvals');
    expect(p.body.data.leaves.map((l: any) => l.id)).toContain(ids.leave);
    expect(p.body.data.paymentClaims).toBeNull();
    const a = await as('ACCOUNTANT').get('/approvals');
    expect(a.body.data.leaves).toBeNull();
    expect(Array.isArray(a.body.data.paymentClaims)).toBe(true);
    expect((await as('TEACHER').get('/approvals')).status).toBe(403);
  });

  it('principal approves; teacher is notified and it shows on staff attendance', async () => {
    expect((await as('TEACHER').post(`/leave/${ids.leave}/decision`, { approve: true })).status).toBe(403);
    expect((await as('PRINCIPAL').post(`/leave/${ids.leave}/decision`, { approve: true, note: 'Get well' })).status).toBe(200);
    expect((await as('PRINCIPAL').post(`/leave/${ids.leave}/decision`, { approve: false })).status).toBe(409);
    expect((await notes('TEACHER')).find((n) => n.type === 'LEAVE_DECIDED')?.title).toBe('Leave approved');
    const roster = await as('ADMIN').get('/attendance/staff');
    expect(roster.body.data.staff.find((s: any) => s.id === ids.staff).approvedLeave).toBe(true);
    const mine = await as('TEACHER').get('/leave/mine');
    expect(mine.body.data.usedThisYear).toEqual({ SICK: 1 });
  });

  // ─── Payment proof ───

  it('office sets up payment accounts; parents see them with the gateway option', async () => {
    const acc = await as('ADMIN').post('/payments/accounts', { method: 'JAZZCASH', title: 'Test School', accountNo: '03001234567' });
    expect(acc.status).toBe(201);
    expect((await as('ACCOUNTANT').post('/payments/accounts', { method: 'JAZZCASH', title: 'x', accountNo: '1234' })).status).toBe(403);
    const opts = await as('P1').get('/payments/options');
    expect(opts.body.data.accounts).toHaveLength(1);
    expect(opts.body.data.gateway.name).toBe('test');
  });

  it('parent submits payment proof; validation and duplicate refs', async () => {
    const send = (role: string, f: Record<string, string>, withFile = true) => {
      let r = as(role).multipart('/payments/claims');
      for (const [k, v] of Object.entries(f)) r = r.field(k, v);
      return withFile ? r.attach('file', PNG, 'proof.png') : r;
    };
    const base = { studentId: ids.P1_child, invoiceIds: ids['P1_2026-09'], method: 'JAZZCASH', reference: 'JC-1001' };
    expect((await send('P1', { ...base, amount: '2600' })).status).toBe(422); // more than owed
    expect((await send('P2', { ...base, amount: '2500' })).status).toBe(404); // not their child
    const ok = await send('P1', { ...base, amount: '2500' });
    expect(ok.status).toBe(201);
    ids.claim = ok.body.data.id;
    expect((await send('P1', { ...base, amount: '2500' })).status).toBe(409);
    expect((await notes('ACCOUNTANT')).some((n) => n.type === 'PAYMENT_CLAIM')).toBe(true);
    const list = await as('ACCOUNTANT').get('/payments/claims?status=PENDING');
    expect(list.body.data[0]).toMatchObject({ reference: 'JC-1001', periods: ['2026-09'] });
    expect(list.body.data[0].proof).toMatch(/\/api\/v1\/files\//);
    expect((await as('P2').get('/payments/claims')).body.data).toHaveLength(0);
  });

  it('accountant verifies: receipt issued once, parent notified', async () => {
    expect((await as('P1').post(`/payments/claims/${ids.claim}/decision`, { approve: true })).status).toBe(403);
    const r = await as('ACCOUNTANT').post(`/payments/claims/${ids.claim}/decision`, { approve: true });
    expect(r.status).toBe(200);
    expect(r.body.data.receiptNo).toMatch(/^RCP-/);
    expect((await as('ACCOUNTANT').post(`/payments/claims/${ids.claim}/decision`, { approve: true })).status).toBe(409);
    const L = await ledger(ids.P1_child);
    expect(L.invoices.find((i: any) => i.period === '2026-09').status).toBe('PAID');
    expect(L.payments).toHaveLength(1);
    expect((await notes('P1')).some((n) => n.title === 'Payment verified')).toBe(true);
  });

  it('rejected claims notify the parent and record nothing', async () => {
    const c = await as('P2').multipart('/payments/claims')
      .field('studentId', ids.P2_child).field('invoiceIds', (await ledger(ids.P2_child)).invoices[0].id)
      .field('amount', '2500').field('method', 'BANK_TRANSFER').field('reference', 'FAKE-999');
    const r = await as('ACCOUNTANT').post(`/payments/claims/${c.body.data.id}/decision`, { approve: false, note: 'No such transfer' });
    expect(r.status).toBe(200);
    expect((await notes('P2')).some((n) => n.title === 'Payment could not be verified')).toBe(true);
    expect((await ledger(ids.P2_child)).payments).toHaveLength(0);
  });

  // ─── Gateway ───

  it('gateway checkout: pay once, replay is ignored, bad signatures fail', async () => {
    const intent = await as('P1').post('/payments/intents', { studentId: ids.P1_child, invoiceIds: [ids['P1_2026-10']] });
    expect(intent.status).toBe(201);
    expect(intent.body.data.amount).toBe('2500');
    const checkout = new URL(intent.body.data.checkoutUrl);
    const page = await request(app).get(checkout.pathname + checkout.search);
    expect(page.status).toBe(200);
    expect(page.text).toContain('Test gateway');
    const sig = /name="result" value="paid">\s*<input type="hidden" name="sig" value="([^"]+)"/.exec(page.text)![1];

    // Real gateways post back from their own domain; browsers send that as Origin.
    const cb = (fields: Record<string, string>) => request(app).post('/api/v1/payments/gateway/test/callback')
      .set('Origin', 'https://checkout.gateway.example').type('form').send(fields);
    expect((await cb({ intentId: intent.body.data.intentId, result: 'paid', sig: 'forged' })).status).toBe(400);
    const paid = await cb({ intentId: intent.body.data.intentId, result: 'paid', sig });
    expect(paid.status).toBe(200);
    expect(paid.text).toContain('Payment received');
    const replay = await cb({ intentId: intent.body.data.intentId, result: 'paid', sig });
    expect(replay.text).toContain('already processed');

    const status = await as('P1').get(`/payments/intents/${intent.body.data.intentId}`);
    expect(status.body.data).toMatchObject({ status: 'SUCCEEDED' });
    expect(status.body.data.paymentId).toBeTruthy();
    const L = await ledger(ids.P1_child);
    expect(L.invoices.find((i: any) => i.period === '2026-10').status).toBe('PAID');
    expect(L.payments.filter((p: any) => p.method === 'ONLINE')).toHaveLength(1);
    expect((await notes('P1')).some((n) => n.title === 'Online payment received')).toBe(true);
  });

  it('cancelled checkout records nothing', async () => {
    const intent = await as('P1').post('/payments/intents', { studentId: ids.P1_child, invoiceIds: [ids['P1_2026-11']] });
    const checkout = new URL(intent.body.data.checkoutUrl);
    const page = await request(app).get(checkout.pathname + checkout.search);
    const sig = /name="result" value="cancelled">\s*<input type="hidden" name="sig" value="([^"]+)"/.exec(page.text)![1];
    await request(app).post('/api/v1/payments/gateway/test/callback').type('form').send({ intentId: intent.body.data.intentId, result: 'cancelled', sig });
    expect((await as('P1').get(`/payments/intents/${intent.body.data.intentId}`)).body.data.status).toBe('FAILED');
    expect((await ledger(ids.P1_child)).invoices.find((i: any) => i.period === '2026-11').status).toBe('UNPAID');
  });

  // ─── Late fines ───

  it('late fines apply once; principal can waive', async () => {
    expect((await as('ACCOUNTANT').post('/fees/fines/apply')).status).toBe(422); // not configured
    await as('ADMIN').patch('/school', { lateFeeAmount: 300, lateFeeGraceDays: 7 });
    const first = await as('ACCOUNTANT').post('/fees/fines/apply');
    expect(first.body.data.fined).toBeGreaterThanOrEqual(2); // P2's Sep & Oct are long overdue
    expect((await as('ACCOUNTANT').post('/fees/fines/apply')).body.data.fined).toBe(0);
    const sep = (await ledger(ids.P2_child)).invoices.find((i: any) => i.period === '2026-09');
    expect(sep.fineAmount).toBe('300');
    expect(Number((await ledger(ids.P2_child)).pending)).toBeGreaterThanOrEqual(5600);

    expect((await as('ACCOUNTANT').post(`/fees/invoices/${sep.id}/waive-fine`)).status).toBe(403);
    expect((await as('PRINCIPAL').post(`/fees/invoices/${sep.id}/waive-fine`)).status).toBe(200);
    await as('ACCOUNTANT').post('/fees/fines/apply');
    expect((await ledger(ids.P2_child)).invoices.find((i: any) => i.period === '2026-09').fineAmount).toBe('0');
  });

  // ─── Low attendance ───

  it('low-attendance alerts reach parents once a month', async () => {
    await as('TEACHER').put('/attendance/students', { sectionId: ids.sec, records: [{ studentId: ids.P1_child, status: 'ABSENT' }, { studentId: ids.P2_child, status: 'PRESENT' }] });
    const r = await as('PRINCIPAL').post('/attendance/low-attendance-alerts', { minDays: 1 });
    expect(r.body.data).toMatchObject({ threshold: 75, students: 1, parentsNotified: 1, principalsNotified: 1 });
    expect((await notes('P1')).some((n) => n.type === 'LOW_ATTENDANCE')).toBe(true);
    expect((await notes('P2')).some((n) => n.type === 'LOW_ATTENDANCE')).toBe(false);
    const again = await as('PRINCIPAL').post('/attendance/low-attendance-alerts', { minDays: 1 });
    expect(again.body.data).toMatchObject({ parentsNotified: 0, skippedAlreadyAlerted: 1 });
  });

  // ─── Reports ───

  it('lists reports by role', async () => {
    const acc = (await as('ACCOUNTANT').get('/reports')).body.data;
    expect(acc).toEqual(expect.arrayContaining(['fee-collection', 'defaulters']));
    expect(acc).not.toContain('staff-attendance');
    expect((await as('TEACHER').get('/reports')).body.data).toEqual(['student-attendance-register']);
  });

  it('fee collection as Excel and PDF', async () => {
    const x = await as('ACCOUNTANT').file(`/reports/fee-collection?format=xlsx&from=${today}&to=${today}`);
    expect(x.status).toBe(200);
    expect(x.headers['content-disposition']).toMatch(/fee-collection-.*\.xlsx/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.body);
    const ws = wb.worksheets[0];
    const cells = ws.getSheetValues().flat().filter((v) => typeof v === 'string');
    expect(cells).toEqual(expect.arrayContaining(['Fee collection', 'Receipt', 'Child P1']));
    const pdf = await as('OWNER').file(`/reports/fee-collection?format=pdf&from=${today}`);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('attendance register for the class teacher, monthly summary and others', async () => {
    const reg = await as('TEACHER').file(`/reports/student-attendance-register?format=pdf&sectionId=${ids.sec}&month=${today.slice(0, 7)}`);
    expect(reg.status).toBe(200);
    expect(reg.headers['content-type']).toBe('application/pdf');
    for (const [role, type] of [['PRINCIPAL', 'fee-monthly-summary'], ['OWNER', `staff-attendance&month=${today.slice(0, 7)}`], ['ADMIN', 'class-strength'], ['PRINCIPAL', 'leave'], ['ACCOUNTANT', 'defaulters']]) {
      const r = await as(role).file(`/reports/${type.replace('&', '?format=xlsx&')}${type.includes('&') ? '' : '?format=xlsx'}`);
      expect([type, r.status]).toEqual([type, 200]);
    }
    expect((await as('TEACHER').file('/reports/fee-collection')).status).toBe(403);
    expect((await as('P1').file('/reports/defaulters')).status).toBe(403);
  });

  // ─── Daily jobs ───

  it('daily jobs run per school and are idempotent', async () => {
    const r = await runDailyJobsForSchool(t.school.id, { weekly: true });
    expect(r.fines).toMatchObject({ enabled: true, fined: expect.any(Number) });
    expect(r.reminders).toBeDefined();
    const again = await runDailyJobsForSchool(t.school.id, { weekly: true });
    expect((again.fines as any).fined).toBe(0);
    expect((again.reminders as any).parentsReminded).toBe(0);
  });
});
