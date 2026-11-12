/**
 * HR step 3: payroll runs (draft → submitted → approved → paid), automatic absence and
 * unpaid-leave deductions, the accountant's review, payslips, the bank sheet, and
 * advances / loans recovered from salary.
 *   RUN_DB_TESTS=1 npm test -- src/__tests__/db/payroll
 */
import 'dotenv/config';
import request from 'supertest';
import app from '../../app';
import { basePrisma } from '../../config/database';
import { connectRedis } from '../../config/redis';
import { dayInTimezone } from '../../utils/dates';
import { lineTotals, monthLabel } from '../../utils/payroll';
import { createTestSchool } from './helpers';

const d = process.env.RUN_DB_TESTS ? describe : describe.skip;
jest.setTimeout(120_000);

describe('lineTotals', () => {
  const base = { gross: 30000, daysInMonth: 30, deductDays: 0, fixedDeductions: [{ name: 'Tax', amount: 500 }], loanDeduction: 0, bonus: 0, otherDeduction: 0 };
  const n = (t: ReturnType<typeof lineTotals>) => ({ absence: Number(t.absenceDeduction), loan: Number(t.loanDeduction), deductions: Number(t.totalDeductions), net: Number(t.net) });
  it('one day’s pay is the gross divided by the days in the month', () => {
    expect(n(lineTotals({ ...base, deductDays: 3.5 }))).toEqual({ absence: 3500, loan: 0, deductions: 4000, net: 26000 });
    expect(n(lineTotals({ ...base, gross: 31000, daysInMonth: 31, deductDays: 0.5 }))).toMatchObject({ absence: 500 });
  });
  it('adds the bonus and takes off loan and other deductions', () => {
    expect(n(lineTotals({ ...base, bonus: 2000, loanDeduction: 5000, otherDeduction: 250 }))).toEqual({ absence: 0, loan: 5000, deductions: 5750, net: 26250 });
  });
  it('an automatic loan recovery never takes more than the pay that is left', () => {
    expect(n(lineTotals({ ...base, deductDays: 29, loanDeduction: 5000 }, true))).toEqual({ absence: 29000, loan: 500, deductions: 30000, net: 0 });
  });
  it('names the month', () => expect(monthLabel('2026-11')).toBe('November 2026'));
});

d('Payroll (database)', () => {
  let t: Awaited<ReturnType<typeof createTestSchool>>;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const today = dayInTimezone('Asia/Karachi');
  const month = today.slice(0, 7);
  const dim = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const day = (n: number) => new Date(`${month}-${String(n).padStart(2, '0')}T00:00:00Z`);
  const as = (role: string) => {
    const h = { Authorization: `Bearer ${tok[role]}` };
    return {
      get: (u: string) => request(app).get(`/api/v1${u}`).set(h),
      post: (u: string, b?: object) => request(app).post(`/api/v1${u}`).set(h).send(b ?? {}),
      patch: (u: string, b: object) => request(app).patch(`/api/v1${u}`).set(h).send(b),
      del: (u: string) => request(app).delete(`/api/v1${u}`).set(h),
    };
  };
  const run = async () => (await as('ACCOUNTANT').get(`/payroll/runs/${ids.run}`)).body.data;
  const line = async (staffId: string) => (await run()).lines.find((l: { staffId: string }) => l.staffId === staffId);
  const cash = async () => (await as('ACCOUNTANT').get('/finance/accounts')).body.data.find((a: { name: string }) => a.name === 'Cash in hand');
  const num = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, Number(o[k])]));

  beforeAll(async () => {
    await connectRedis();
    t = await createTestSchool('pay');
    for (const r of ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER'] as const) {
      const u = await t.user(r);
      tok[r] = u.token;
      ids[`user${r}`] = u.id;
    }
    const s = (data: object) => basePrisma.staff.create({ data: { schoolId: t.school.id, ...data } as never });
    ids.sana = (await s({ userId: ids.userTEACHER, employeeNo: 'T-1', name: 'Sana Teacher', designation: 'Teacher', bankName: 'Meezan', bankAccountTitle: 'Sana', bankAccountNo: 'PK00MEZN0001' })).id;
    ids.bilal = (await s({ employeeNo: 'T-2', name: 'Bilal Clerk', designation: 'Clerk', isTeacher: false, joiningDate: day(17) })).id;
    ids.nosalary = (await s({ employeeNo: 'T-3', name: 'Chand Driver', designation: 'Driver', isTeacher: false })).id;

    const A = as('ADMIN');
    // One day's pay is a round 1,000 for Sana and 2,000 for Bilal.
    expect((await A.post(`/hr/staff/${ids.sana}/salary`, { effectiveFrom: `${month}-01`, basic: dim * 900, components: [{ kind: 'ALLOWANCE', name: 'Conveyance', amount: dim * 100 }, { kind: 'DEDUCTION', name: 'Income tax', amount: 500 }] })).status).toBe(201);
    expect((await A.post(`/hr/staff/${ids.bilal}/salary`, { effectiveFrom: `${month}-01`, basic: dim * 2000, components: [] })).status).toBe(201);

    // Sana: absent on the 5th, half day on the 6th, and marked absent on the 12th although on approved leave.
    const mark = (n: number, status: string) => basePrisma.staffAttendance.create({ data: { schoolId: t.school.id, staffId: ids.sana, date: day(n), status } as never });
    await mark(5, 'ABSENT'); await mark(6, 'HALF_DAY'); await mark(12, 'ABSENT'); await mark(7, 'LATE');
    const leave = (type: string, a: number, b: number, status = 'APPROVED') => basePrisma.leaveRequest.create({ data: { schoolId: t.school.id, staffId: ids.sana, type, fromDate: day(a), toDate: day(b), reason: 'x', status } as never });
    await leave('CASUAL', 12, 13);         // within the allowance: paid
    await leave('UNPAID', 20, 21);         // 2 unpaid days
    await leave('UNPAID', 24, 25, 'PENDING'); // not approved: ignored

    // Money to pay from, and what the staff owe.
    const C = as('ACCOUNTANT');
    const account = await cash();
    ids.cash = account.id;
    await C.post(`/finance/accounts/${ids.cash}/transactions`, { type: 'DEPOSIT', amount: 20000, txDate: today, description: 'Float' });
  });
  afterAll(async () => { await t.destroy(); });

  it('advances and loans leave the account and are listed with what is still owed', async () => {
    const C = as('ACCOUNTANT');
    const loan = await C.post('/payroll/loans', { staffId: ids.sana, kind: 'LOAN', amount: 6000, issuedOn: today, accountId: ids.cash, installment: 2000 });
    expect(loan.status).toBe(201);
    expect(loan.body.data).toMatchObject({ loanNo: 'LN-00001', startPeriod: month });
    ids.loan = loan.body.data.id;
    const adv = await C.post('/payroll/loans', { staffId: ids.bilal, kind: 'ADVANCE', amount: 1000, issuedOn: today, accountId: ids.cash });
    expect(adv.body.data).toMatchObject({ loanNo: 'ADV-00002', installment: '1000' });
    ids.advance = adv.body.data.id;
    expect(Number((await cash()).balance)).toBe(13000);

    expect((await C.post('/payroll/loans', { staffId: ids.sana, kind: 'LOAN', amount: 500, issuedOn: today, accountId: ids.cash })).status).toBe(422); // no instalment
    expect((await C.post('/payroll/loans', { staffId: ids.sana, kind: 'ADVANCE', amount: 999999, issuedOn: today, accountId: ids.cash })).status).toBe(409); // not enough cash
    expect((await as('PRINCIPAL').post('/payroll/loans', { staffId: ids.sana, kind: 'ADVANCE', amount: 5, issuedOn: today, accountId: ids.cash })).status).toBe(403);

    const list = await as('OWNER').get('/payroll/loans?status=ACTIVE');
    expect(Number(list.body.data.totals.outstanding)).toBe(7000);
    expect(list.body.data.loans).toHaveLength(2);
  });

  it('prepares the month: absences, unpaid leave, part-month and loan instalments are worked out', async () => {
    const C = as('ACCOUNTANT');
    expect((await as('ADMIN').get('/payroll/runs')).status).toBe(403);
    expect((await as('TEACHER').get('/payroll/runs')).status).toBe(403);
    expect((await as('PRINCIPAL').post('/payroll/runs', { period: month })).status).toBe(403);
    expect((await C.post('/payroll/runs', { period: '2099-01' })).status).toBe(422);

    const made = await C.post('/payroll/runs', { period: month });
    expect(made.status).toBe(201);
    ids.run = made.body.data.id;
    expect(made.body.data.missing.map((m: { name: string }) => m.name)).toEqual(['Chand Driver']);
    expect((await C.post('/payroll/runs', { period: month })).status).toBe(409);

    const r = await run();
    expect(r).toMatchObject({ status: 'DRAFT', label: monthLabel(month) });
    expect(r.lines).toHaveLength(2);
    expect(r.missing).toEqual([expect.objectContaining({ name: 'Chand Driver' })]);

    const sana = await line(ids.sana);
    expect(sana).toMatchObject({ name: 'Sana Teacher', bankAccountNo: 'PK00MEZN0001', daysInMonth: dim, fixedDeductions: [{ name: 'Income tax', amount: 500 }] });
    expect(num(sana, ['gross', 'absentDays', 'unpaidLeaveDays', 'notEmployedDays', 'deductDays', 'absenceDeduction', 'loanDeduction', 'totalDeductions', 'net']))
      .toEqual({ gross: dim * 1000, absentDays: 1.5, unpaidLeaveDays: 2, notEmployedDays: 0, deductDays: 3.5, absenceDeduction: 3500, loanDeduction: 2000, totalDeductions: 6000, net: dim * 1000 - 6000 });

    const bilal = await line(ids.bilal);
    expect(num(bilal, ['notEmployedDays', 'deductDays', 'absenceDeduction', 'loanDeduction', 'net']))
      .toEqual({ notEmployedDays: 16, deductDays: 16, absenceDeduction: 32000, loanDeduction: 1000, net: dim * 2000 - 33000 });
    ids.lineSana = sana.id; ids.lineBilal = bilal.id;
    expect(Number(r.totals.net)).toBe(dim * 3000 - 39000);
  });

  it('review: the accountant’s changes are kept on recalculation, and can’t push pay below zero', async () => {
    const C = as('ACCOUNTANT');
    const edit = await C.patch(`/payroll/lines/${ids.lineSana}`, { deductDays: 3, bonus: 1500, remarks: 'Half day excused' });
    expect(edit.status).toBe(200);
    expect(num(edit.body.data, ['absenceDeduction', 'net'])).toEqual({ absenceDeduction: 3000, net: dim * 1000 - 4000 });
    expect((await C.patch(`/payroll/lines/${ids.lineSana}`, { loanDeduction: 6001 })).status).toBe(422); // owes 6,000
    expect((await C.patch(`/payroll/lines/${ids.lineSana}`, { otherDeduction: dim * 1000 })).status).toBe(422);
    expect((await C.patch(`/payroll/lines/${ids.lineSana}`, { deductDays: 40 })).status).toBe(422);
    expect((await as('PRINCIPAL').patch(`/payroll/lines/${ids.lineSana}`, { bonus: 1 })).status).toBe(403); // sees payroll, doesn't prepare it

    // A new absence appears: Bilal's line picks it up, Sana's hand-set days stay.
    await basePrisma.staffAttendance.create({ data: { schoolId: t.school.id, staffId: ids.bilal, date: day(18), status: 'ABSENT' } });
    expect((await C.post(`/payroll/runs/${ids.run}/recalculate`)).status).toBe(200);
    expect(num(await line(ids.sana), ['deductDays', 'bonus'])).toEqual({ deductDays: 3, bonus: 1500 });
    expect(num(await line(ids.bilal), ['absentDays', 'deductDays'])).toEqual({ absentDays: 1, deductDays: 17 });

    expect((await C.post(`/payroll/runs/${ids.run}/recalculate`, { reset: true })).status).toBe(200);
    expect(num(await line(ids.sana), ['deductDays', 'bonus'])).toEqual({ deductDays: 3.5, bonus: 0 });
    await C.patch(`/payroll/lines/${ids.lineSana}`, { bonus: 1500 });
  });

  it('approval: the owner approves or sends back; nothing can be changed or paid in between', async () => {
    const C = as('ACCOUNTANT');
    const O = as('OWNER');
    expect((await C.post(`/payroll/runs/${ids.run}/pay`, { accountId: ids.cash, paymentDate: today })).status).toBe(409);
    expect((await C.post(`/payroll/runs/${ids.run}/submit`)).status).toBe(200);
    expect(await basePrisma.notification.count({ where: { userId: ids.userOWNER, type: 'PAYROLL_APPROVAL' } })).toBe(1);
    expect((await C.patch(`/payroll/lines/${ids.lineSana}`, { bonus: 9 })).status).toBe(409);
    expect((await C.post(`/payroll/runs/${ids.run}/recalculate`)).status).toBe(409);
    expect((await C.post(`/payroll/runs/${ids.run}/decision`, { approve: true })).status).toBe(403);

    expect((await O.post(`/payroll/runs/${ids.run}/decision`, { approve: false, note: 'Check Bilal' })).status).toBe(200);
    expect(await run()).toMatchObject({ status: 'DRAFT', decisionNote: 'Check Bilal' });
    expect(await basePrisma.notification.count({ where: { userId: ids.userACCOUNTANT, type: 'PAYROLL_DECIDED' } })).toBe(1);

    await C.post(`/payroll/runs/${ids.run}/submit`);
    expect((await O.post(`/payroll/runs/${ids.run}/decision`, { approve: true })).status).toBe(200);
    expect((await O.post(`/payroll/runs/${ids.run}/decision`, { approve: true })).status).toBe(409);
    expect((await run()).status).toBe('APPROVED');
    expect((await C.del(`/payroll/runs/${ids.run}`)).status).toBe(409);

    // The accountant can pull an approved payroll back; it then needs approval again.
    expect((await C.post(`/payroll/runs/${ids.run}/reopen`)).status).toBe(200);
    await C.post(`/payroll/runs/${ids.run}/submit`);
    await O.post(`/payroll/runs/${ids.run}/decision`, { approve: true });

    // Staff see nothing until it is paid.
    expect((await as('TEACHER').get('/payroll/my')).body.data.payslips).toEqual([]);
    expect((await as('TEACHER').get(`/payroll/lines/${ids.lineSana}/payslip`)).status).toBe(404);
  });

  it('paying takes the net from the account as a Salaries expense and recovers the loans', async () => {
    const C = as('ACCOUNTANT');
    const net = Number((await run()).totals.net);
    expect(net).toBe(dim * 3000 - 39500); // Sana −4,500 (3.5 days, tax, loan, +1,500 bonus), Bilal −35,000
    const short = await C.post(`/payroll/runs/${ids.run}/pay`, { accountId: ids.cash, paymentDate: today });
    expect(short.status).toBe(409);
    expect(short.body.message).toMatch(/Cash in hand has only 13000/);
    await C.post(`/finance/accounts/${ids.cash}/transactions`, { type: 'DEPOSIT', amount: net, txDate: today, description: 'For salaries' });

    expect((await as('PRINCIPAL').post(`/payroll/runs/${ids.run}/pay`, { accountId: ids.cash, paymentDate: today })).status).toBe(403);
    const paid = await C.post(`/payroll/runs/${ids.run}/pay`, { accountId: ids.cash, paymentDate: today });
    expect(paid.status).toBe(200);
    expect(await run()).toMatchObject({ status: 'PAID', account: 'Cash in hand', paymentDate: today });
    expect(Number((await cash()).balance)).toBe(13000);
    expect((await C.post(`/payroll/runs/${ids.run}/pay`, { accountId: ids.cash, paymentDate: today })).status).toBe(409);
    expect((await C.post(`/payroll/runs/${ids.run}/reopen`)).status).toBe(409);

    const expense = await basePrisma.expense.findFirstOrThrow({ where: { payrollRunId: ids.run }, include: { category: true } });
    expect(expense).toMatchObject({ status: 'APPROVED', category: { name: 'Salaries' }, description: `Salaries for ${monthLabel(month)} (2 staff)` });
    expect(Number(expense.amount)).toBe(net);
    expect((await C.del(`/finance/expenses/${expense.id}`)).status).toBe(409);

    const loans = (await C.get('/payroll/loans')).body.data.loans;
    const loan = loans.find((l: { id: string }) => l.id === ids.loan);
    expect(loan).toMatchObject({ status: 'ACTIVE', repayments: [expect.objectContaining({ fromSalary: true })] });
    expect(Number(loan.outstanding)).toBe(4000);
    expect(loans.find((l: { id: string }) => l.id === ids.advance)).toMatchObject({ status: 'SETTLED' });
  });

  it('payslips: staff see their own once paid; the bank sheet lists who is paid where', async () => {
    const T = as('TEACHER');
    expect(await basePrisma.notification.count({ where: { userId: ids.userTEACHER, type: 'PAYSLIP_READY' } })).toBe(1);
    const mine = (await T.get('/payroll/my')).body.data;
    expect(mine.payslips).toHaveLength(1);
    expect(mine.payslips[0]).toMatchObject({ id: ids.lineSana, period: month });
    expect(Number(mine.loans[0].outstanding)).toBe(4000);

    const slip = await T.get(`/payroll/lines/${ids.lineSana}/payslip`);
    expect(slip.status).toBe(200);
    expect(slip.body.data).toMatchObject({ name: 'Sana Teacher', label: monthLabel(month), status: 'PAID', allowances: [{ name: 'Conveyance', amount: dim * 100 }] });
    expect(Number(slip.body.data.net)).toBe(dim * 1000 - 4500);
    expect(Number(slip.body.data.paidDays)).toBe(dim - 3.5);
    expect((await T.get(`/payroll/lines/${ids.lineBilal}/payslip`)).status).toBe(404);
    expect((await as('PRINCIPAL').get(`/payroll/lines/${ids.lineBilal}/payslip`)).status).toBe(200);

    // A later salary change doesn't alter the payslip.
    await as('ADMIN').post(`/hr/staff/${ids.sana}/salary`, { effectiveFrom: today, basic: 99999, components: [] });
    expect(Number((await T.get(`/payroll/lines/${ids.lineSana}/payslip`)).body.data.gross)).toBe(dim * 1000);

    const sheet = await as('ACCOUNTANT').get(`/payroll/runs/${ids.run}/bank-sheet`);
    expect(sheet.status).toBe(200);
    expect(sheet.headers['content-type']).toMatch(/spreadsheetml/);
    expect(sheet.headers['content-disposition']).toContain(`salary-transfer-${month}.xlsx`);
    expect((await as('ACCOUNTANT').get(`/payroll/runs/${ids.run}/bank-sheet?format=pdf`)).headers['content-type']).toMatch(/pdf/);
  });

  it('a loan can be paid back in cash; mistakes can be deleted only while untouched', async () => {
    const C = as('ACCOUNTANT');
    expect((await C.post(`/payroll/loans/${ids.loan}/repayments`, { amount: 4001, paidOn: today, accountId: ids.cash })).status).toBe(422);
    expect((await C.post(`/payroll/loans/${ids.loan}/repayments`, { amount: 4000, paidOn: today, accountId: ids.cash })).status).toBe(201);
    expect(Number((await cash()).balance)).toBe(17000);
    expect((await C.get('/payroll/loans?status=ACTIVE')).body.data.loans).toHaveLength(0);
    expect((await C.del(`/payroll/loans/${ids.loan}`)).status).toBe(409);

    const wrong = await C.post('/payroll/loans', { staffId: ids.bilal, kind: 'ADVANCE', amount: 700, issuedOn: today, accountId: ids.cash });
    expect(Number((await cash()).balance)).toBe(16300);
    expect((await C.del(`/payroll/loans/${wrong.body.data.id}`)).status).toBe(200);
    expect(Number((await cash()).balance)).toBe(17000);

    // The account statement shows the advances, the salaries and the repayment.
    const st = (await C.get(`/finance/transactions?accountId=${ids.cash}&from=${today}&to=${today}`)).body.data;
    const kinds = st.rows.map((r: { kind: string }) => r.kind);
    expect(kinds.filter((k: string) => k === 'ADVANCE')).toHaveLength(2);
    expect(kinds).toEqual(expect.arrayContaining(['EXPENSE', 'LOAN_REPAYMENT', 'DEPOSIT']));
    expect(Number(st.closing)).toBe(17000);
    const sum = (await C.get(`/finance/summary?month=${month}`)).body.data;
    expect(sum.expenses.byCategory.map((c: { category: string }) => c.category).sort()).toEqual(['Salaries', 'Staff advances & loans']);
  });

  it('the list shows each month with its totals', async () => {
    const list = await as('OWNER').get('/payroll/runs');
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ period: month, status: 'PAID', staff: 2 });
  });
});
