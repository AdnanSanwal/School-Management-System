/**
 * Finance step 4: the double-entry ledger worked out from the records, statements
 * (trial balance, income & expenditure, balance sheet), hand-made journals, month closing.
 *   RUN_DB_TESTS=1 npm test -- src/__tests__/db/ledger
 */
import 'dotenv/config';
import request from 'supertest';
import app from '../../app';
import { basePrisma } from '../../config/database';
import { connectRedis } from '../../config/redis';
import { addDays, dayInTimezone, periodOf, periodRange } from '../../utils/dates';
import { nextCode } from '../../utils/ledger';
import { createTestSchool } from './helpers';

const d = process.env.RUN_DB_TESTS ? describe : describe.skip;
jest.setTimeout(120_000);

describe('nextCode', () => {
  it('takes the first free code, ten apart', () => {
    const used = new Set(['1010', '1020']);
    expect(nextCode(used, 1010)).toBe('1030');
    expect(nextCode(used, 1010)).toBe('1040');
    expect(nextCode(new Set(), 5010)).toBe('5010');
  });
});

d('Accounting ledger (database)', () => {
  let t: Awaited<ReturnType<typeof createTestSchool>>;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const today = dayInTimezone('Asia/Karachi');
  const month = today.slice(0, 7);
  const lastMonth = periodOf(addDays(periodRange(month).start, -1));
  const lastMonthDay = `${lastMonth}-15`;
  const dim = periodRange(month).end.getUTCDate();
  const as = (role: string) => {
    const h = { Authorization: `Bearer ${tok[role]}` };
    return {
      get: (u: string) => request(app).get(`/api/v1${u}`).set(h),
      post: (u: string, b?: object) => request(app).post(`/api/v1${u}`).set(h).send(b ?? {}),
      patch: (u: string, b: object) => request(app).patch(`/api/v1${u}`).set(h).send(b),
      del: (u: string) => request(app).delete(`/api/v1${u}`).set(h),
    };
  };
  type Row = { id: string; code: string; name: string; type: string; balance: string; link: string | null };
  const chart = async (): Promise<Row[]> => (await as('ACCOUNTANT').get('/ledger/accounts')).body.data;
  const acc = async (name: string) => (await chart()).find((a) => a.name === name)!;
  const money = async (name: string) => (await as('ACCOUNTANT').get('/finance/accounts')).body.data.find((a: { name: string }) => a.name === name);
  const category = async (kind: string, name: string) => (await as('ACCOUNTANT').get(`/finance/categories?kind=${kind}`)).body.data.find((c: { name: string }) => c.name === name).id;

  beforeAll(async () => {
    await connectRedis();
    t = await createTestSchool('led');
    for (const r of ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT'] as const) tok[r] = (await t.user(r)).token;
    const A = as('ADMIN');
    const C = as('ACCOUNTANT');

    // A fee payment of 3,000 in cash.
    const cls = await A.post('/academics/classes', { name: 'Class 5', level: 5, sections: ['A'] });
    const admit = await A.post('/students', { admissionNo: `T-${Math.random().toString(36).slice(2, 10)}`, name: 'Payer', sectionId: cls.body.data.sections[0].id, monthlyFee: 3000, guardians: [{ name: 'Parent', phone: '03004445566', relation: 'FATHER', isPrimary: true }] });
    await C.post('/fees/invoices/generate', { period: month, classIds: [cls.body.data.id] });
    expect((await C.post('/fees/payments', { studentId: admit.body.data.student.id, amount: 3000, method: 'CASH' })).status).toBe(201);

    ids.cash = (await money('Cash in hand')).id;
    ids.bank = (await money('Bank account')).id;
    ids.wallet = (await money('Mobile wallets')).id;
    // A bank account that already held 10,000 last month.
    ids.hbl = (await C.post('/finance/accounts', { name: 'HBL', type: 'BANK', openingBalance: 10000, openingDate: lastMonthDay })).body.data.id;

    const post = async (u: string, b: object) => { const r = await C.post(u, b); expect([200, 201]).toContain(r.status); return r; };
    await post(`/finance/accounts/${ids.cash}/transactions`, { type: 'DEPOSIT', amount: 50000, txDate: today, description: 'Owner capital' });
    await post(`/finance/accounts/${ids.cash}/transactions`, { type: 'ADJUSTMENT_OUT', amount: 50, txDate: today, description: 'Count was short' });
    await post('/finance/transfers', { fromAccountId: ids.cash, toAccountId: ids.bank, amount: 1000, txDate: today });
    await post('/finance/expenses', { categoryId: await category('EXPENSE', 'Utilities'), accountId: ids.cash, amount: 800, expenseDate: today, description: 'Electricity' });
    await post('/finance/income', { categoryId: await category('INCOME', 'Canteen rent'), accountId: ids.wallet, amount: 700, incomeDate: today, description: 'Rent' });

    // One member of staff: a 2,000 loan, 500 of it recovered through this month's payroll.
    await basePrisma.staff.create({ data: { schoolId: t.school.id, employeeNo: 'L-1', name: 'Hina', isTeacher: false } });
  });
  afterAll(async () => { await t.destroy(); });

  it('pays a small payroll so the loan recovery is in the books', async () => {
    const C = as('ACCOUNTANT');
    const staff = await basePrisma.staff.findFirstOrThrow({ where: { schoolId: t.school.id, employeeNo: 'L-1' } });
    expect((await as('ADMIN').post(`/hr/staff/${staff.id}/salary`, { effectiveFrom: `${month}-01`, basic: dim * 1000, components: [] })).status).toBe(201);
    expect((await as('OWNER').post('/payroll/loans', { staffId: staff.id, kind: 'LOAN', amount: 2000, issuedOn: today, accountId: ids.cash, installment: 500 })).status).toBe(201);
    const run = await C.post('/payroll/runs', { period: month });
    ids.run = run.body.data.id;
    await C.post(`/payroll/runs/${ids.run}/submit`);
    await as('OWNER').post(`/payroll/runs/${ids.run}/decision`, { approve: true });
    expect((await C.post(`/payroll/runs/${ids.run}/pay`, { accountId: ids.cash, paymentDate: today })).status).toBe(200);
    // Cash: 3,000 + 50,000 − 50 − 1,000 − 800 − 2,000 − (salary − 500)
    expect(Number((await money('Cash in hand')).balance)).toBe(49650 - dim * 1000);
  });

  it('the chart has the built-in accounts and one for every money account and category', async () => {
    expect((await as('ADMIN').get('/ledger/accounts')).status).toBe(403);
    expect((await as('PRINCIPAL').get('/ledger/accounts')).status).toBe(200);
    const rows = await chart();
    const pick = (name: string) => { const a = rows.find((r) => r.name === name)!; return [a.code, a.type, a.link, Number(a.balance)]; };
    expect(pick('Cash in hand')).toEqual(['1010', 'ASSET', 'MONEY', 49650 - dim * 1000]);
    expect(pick('Bank account')).toEqual(['1020', 'ASSET', 'MONEY', 1000]);
    expect(pick('HBL')).toEqual(['1040', 'ASSET', 'MONEY', 10000]);
    expect(pick('Staff advances & loans')).toEqual(['1300', 'ASSET', 'SYSTEM', 1500]);
    expect(pick('Opening balances')).toEqual(['3000', 'EQUITY', 'SYSTEM', 10000]);
    expect(pick('Owner’s account')).toEqual(['3100', 'EQUITY', 'SYSTEM', 50000]);
    expect(pick('Student fees')).toEqual(['4000', 'INCOME', 'SYSTEM', 3000]);
    expect(pick('Canteen rent').slice(1)).toEqual(['INCOME', 'CATEGORY', 700]);
    expect(pick('Utilities').slice(1)).toEqual(['EXPENSE', 'CATEGORY', 800]);
    // Salary cost is the full pay: what was paid out plus the loan instalment kept back.
    expect(pick('Salaries').slice(1)).toEqual(['EXPENSE', 'CATEGORY', dim * 1000]);
    expect(pick('Cash differences (short)')).toEqual(['5900', 'EXPENSE', 'SYSTEM', 50]);
    expect(new Set(rows.map((r) => r.code)).size).toBe(rows.length);
  });

  it('journal entries by hand: balanced, on real accounts, never overdrawing cash', async () => {
    const C = as('ACCOUNTANT');
    const furniture = await C.post('/ledger/accounts', { name: 'Furniture & equipment', type: 'ASSET' });
    expect(furniture.status).toBe(201);
    expect(furniture.body.data.code).toBe('1510');
    ids.furniture = furniture.body.data.id;
    expect((await C.post('/ledger/accounts', { name: 'furniture & equipment', type: 'ASSET' })).status).toBe(409);
    expect((await C.post('/ledger/accounts', { name: 'Vehicles', type: 'ASSET', code: '1010' })).status).toBe(409);
    expect((await as('PRINCIPAL').post('/ledger/accounts', { name: 'Nope', type: 'ASSET' })).status).toBe(403);

    const cash = (await acc('Cash in hand')).id;
    const entry = (lines: object[], date = today) => C.post('/ledger/journals', { date, description: 'Desks for class 5', reference: 'INV-77', lines });
    expect((await entry([{ accountId: ids.furniture, debit: 1200 }, { accountId: cash, credit: 1000 }])).status).toBe(422); // not balanced
    expect((await entry([{ accountId: ids.furniture, debit: 1200, credit: 1200 }, { accountId: cash, credit: 1200 }])).status).toBe(422);
    expect((await entry([{ accountId: (await acc('Staff advances & loans')).id, debit: 5 }, { accountId: cash, credit: 5 }])).status).toBe(422);
    expect((await entry([{ accountId: ids.furniture, debit: 9999999 }, { accountId: cash, credit: 9999999 }])).status).toBe(409); // cash doesn't hold it
    expect((await entry([{ accountId: ids.furniture, debit: 5 }, { accountId: cash, credit: 5 }], '2099-01-01')).status).toBe(422);

    const ok = await entry([{ accountId: ids.furniture, debit: 1200 }, { accountId: cash, credit: 1200 }]);
    expect(ok.status).toBe(201);
    expect(ok.body.data.entryNo).toBe('JV-00001');
    ids.journal = ok.body.data.id;
    // The cash account itself moved, and its statement shows the entry.
    expect(Number((await money('Cash in hand')).balance)).toBe(48450 - dim * 1000);
    const st = (await C.get(`/finance/transactions?accountId=${ids.cash}&from=${today}&to=${today}`)).body.data;
    expect(st.rows.find((r: { kind: string }) => r.kind === 'JOURNAL')).toMatchObject({ reference: 'JV-00001' });
    expect(Number(st.closing)).toBe(48450 - dim * 1000);
  });

  it('trial balance, income & expenditure and balance sheet agree with each other', async () => {
    const O = as('OWNER');
    const tb = (await O.get('/ledger/trial-balance')).body.data;
    expect(tb.balanced).toBe(true);
    expect(Number(tb.debit)).toBe(Number(tb.credit));
    expect(Number(tb.debit)).toBeGreaterThan(0);

    const is = (await O.get(`/ledger/income-statement?from=${month}-01&to=${today}`)).body.data;
    expect(Number(is.income.total)).toBe(3700);
    expect(is.income.rows.map((r: { name: string }) => r.name)).toEqual(['Student fees', 'Canteen rent']);
    expect(Number(is.expenses.total)).toBe(dim * 1000 + 850);
    expect(Number(is.surplus)).toBe(2850 - dim * 1000);
    // Nothing was earned or spent last month.
    const before = (await O.get(`/ledger/income-statement?from=${lastMonth}-01&to=${lastMonthDay}`)).body.data;
    expect(Number(before.income.total) + Number(before.expenses.total)).toBe(0);

    const bs = (await O.get('/ledger/balance-sheet')).body.data;
    expect(bs.balanced).toBe(true);
    expect(Number(bs.assets.total)).toBe(62850 - dim * 1000); // cash, bank 1,000, wallet 700, HBL 10,000, advances 1,500, furniture 1,200
    expect(Number(bs.liabilities.total)).toBe(0);
    expect(Number(bs.equity.surplus)).toBe(2850 - dim * 1000);
    expect(Number(bs.equity.total)).toBe(62850 - dim * 1000);
    // Last month's balance sheet has only the opening balance.
    const old = (await O.get(`/ledger/balance-sheet?asOf=${lastMonthDay}`)).body.data;
    expect([Number(old.assets.total), Number(old.equity.total), old.balanced]).toEqual([10000, 10000, true]);
  });

  it('the journal and every account ledger add up to the same balances', async () => {
    const O = as('OWNER');
    const from = `${lastMonth}-01`;
    const journal = (await O.get(`/ledger/journal?from=${from}&to=${today}`)).body.data;
    for (const e of journal.entries) {
      const dr = e.lines.reduce((s: number, l: { debit: string }) => s + Number(l.debit), 0);
      const cr = e.lines.reduce((s: number, l: { credit: string }) => s + Number(l.credit), 0);
      expect(dr).toBe(cr);
    }
    const kinds = journal.entries.map((e: { kind: string }) => e.kind);
    expect([...new Set(kinds)].sort()).toEqual(['ADJUSTMENT', 'ADVANCE', 'EXPENSE', 'FEES', 'INCOME', 'JOURNAL', 'OPENING', 'OWNER', 'RECOVERY', 'TRANSFER']);
    expect(journal.entries.find((e: { kind: string }) => e.kind === 'FEES')).toMatchObject({ description: 'Fee collections — 1 receipt' });
    expect(journal.entries.find((e: { kind: string }) => e.kind === 'RECOVERY').lines.map((l: { name: string }) => l.name)).toEqual(['Salaries', 'Staff advances & loans']);

    // Entries (detail) and balances (SQL sums) are two readers of the same rules: they must agree on every account.
    for (const a of await chart()) {
      const led = (await O.get(`/ledger/accounts/${a.id}/ledger?from=${from}&to=${today}`)).body.data;
      expect([a.name, Number(led.opening)]).toEqual([a.name, 0]);
      expect([a.name, Number(led.closing)]).toEqual([a.name, Number(a.balance)]);
    }
    const cash = (await O.get(`/ledger/accounts/${(await acc('Cash in hand')).id}/ledger?from=${today}&to=${today}`)).body.data;
    expect(cash.rows.find((r: { kind: string }) => r.kind === 'JOURNAL')).toMatchObject({ against: 'Furniture & equipment', description: 'Desks for class 5' });
    // From the middle of the range the opening balance carries what came before.
    const hbl = (await O.get(`/ledger/accounts/${(await acc('HBL')).id}/ledger?from=${today}&to=${today}`)).body.data;
    expect([Number(hbl.opening), hbl.rows.length, Number(hbl.closing)]).toEqual([10000, 0, 10000]);
  });

  it('accounts that mirror a category or money account follow it; own accounts can be changed', async () => {
    const C = as('ACCOUNTANT');
    const utilities = await acc('Utilities');
    expect((await C.patch(`/ledger/accounts/${utilities.id}`, { name: 'Power' })).status).toBe(409);
    expect((await C.del(`/ledger/accounts/${(await acc('Student fees')).id}`)).status).toBe(409);
    await C.patch(`/finance/categories/${await category('EXPENSE', 'Utilities')}`, { name: 'Electricity & gas' });
    expect((await acc('Electricity & gas')).id).toBe(utilities.id);
    const added = await C.post('/finance/categories', { kind: 'EXPENSE', name: 'Security' });
    expect(added.status).toBe(201);
    expect(await acc('Security')).toMatchObject({ type: 'EXPENSE', link: 'CATEGORY' });

    expect((await C.patch(`/ledger/accounts/${ids.furniture}`, { name: 'Furniture', code: '1600' })).status).toBe(200);
    expect((await C.del(`/ledger/accounts/${ids.furniture}`)).status).toBe(409); // has a journal entry
    const spare = await C.post('/ledger/accounts', { name: 'Bank loan', type: 'LIABILITY' });
    expect(spare.body.data.code).toBe('2010');
    expect((await C.del(`/ledger/accounts/${spare.body.data.id}`)).status).toBe(200);
  });

  it('closing a month locks everything dated in it until the owner reopens', async () => {
    const C = as('ACCOUNTANT');
    const O = as('OWNER');
    expect((await C.get('/ledger/closing')).body.data).toMatchObject({ closedThrough: null, canCloseThrough: lastMonth, canClose: true, canReopen: false });
    expect((await C.post('/ledger/close', { period: month })).status).toBe(422); // month not over
    expect((await as('PRINCIPAL').post('/ledger/close', { period: lastMonth })).status).toBe(403);

    // A draft payroll for last month blocks the closing.
    const hina = await basePrisma.staff.findFirstOrThrow({ where: { schoolId: t.school.id, employeeNo: 'L-1' } });
    await basePrisma.salaryStructure.create({ data: { schoolId: t.school.id, staffId: hina.id, effectiveFrom: new Date(`${lastMonth}-01T00:00:00Z`), basic: 1000 } });
    const draft = await C.post('/payroll/runs', { period: lastMonth });
    expect(draft.status).toBe(201);
    const blocked = await C.post('/ledger/close', { period: lastMonth });
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/payroll/);
    await C.del(`/payroll/runs/${draft.body.data.id}`);

    expect((await C.post('/ledger/close', { period: lastMonth })).status).toBe(200);
    expect((await C.post('/ledger/close', { period: lastMonth })).status).toBe(409);
    expect((await O.get('/ledger/closing')).body.data).toMatchObject({ closedThrough: lastMonth, canCloseThrough: null, canReopen: true });

    const util = await category('EXPENSE', 'Electricity & gas');
    const closed = [
      await C.post('/finance/expenses', { categoryId: util, accountId: ids.cash, amount: 10, expenseDate: lastMonthDay, description: 'Late bill' }),
      await C.post('/finance/income', { categoryId: await category('INCOME', 'Donations'), accountId: ids.cash, amount: 10, incomeDate: lastMonthDay, description: 'Gift' }),
      await C.post(`/finance/accounts/${ids.cash}/transactions`, { type: 'DEPOSIT', amount: 10, txDate: lastMonthDay, description: 'Back-dated' }),
      await C.post('/finance/transfers', { fromAccountId: ids.cash, toAccountId: ids.bank, amount: 10, txDate: lastMonthDay }),
      await C.patch(`/finance/accounts/${ids.hbl}`, { openingBalance: 99 }),
      await C.post('/ledger/journals', { date: lastMonthDay, description: 'Back-dated', lines: [{ accountId: ids.furniture, debit: 5 }, { accountId: (await acc('Cash in hand')).id, credit: 5 }] }),
    ];
    expect(closed.map((r) => r.status)).toEqual([409, 409, 409, 409, 409, 409]);
    expect(closed[0].body.message).toMatch(/books are closed up to/);
    // This month is still open, and renaming a closed account is fine.
    expect((await C.post('/finance/expenses', { categoryId: util, accountId: ids.cash, amount: 10, expenseDate: today, description: 'Open month' })).status).toBe(201);
    expect((await C.patch(`/finance/accounts/${ids.hbl}`, { name: 'HBL current' })).status).toBe(200);

    expect((await C.post('/ledger/reopen', { period: lastMonth })).status).toBe(403);
    expect((await O.post('/ledger/reopen', { period: month })).status).toBe(409);
    expect((await O.post('/ledger/reopen', { period: lastMonth })).status).toBe(200);
    expect((await C.post('/finance/expenses', { categoryId: util, accountId: ids.cash, amount: 10, expenseDate: lastMonthDay, description: 'Late bill' })).status).toBe(201);
  });

  it('removing a journal entry puts everything back, and the books still balance', async () => {
    const C = as('ACCOUNTANT');
    const before = Number((await money('Cash in hand')).balance);
    expect((await as('PRINCIPAL').del(`/ledger/journals/${ids.journal}`)).status).toBe(403);
    expect((await C.del(`/ledger/journals/${ids.journal}`)).status).toBe(200);
    expect(Number((await money('Cash in hand')).balance)).toBe(before + 1200);
    expect(Number((await acc('Furniture')).balance)).toBe(0);
    expect((await C.del(`/ledger/accounts/${ids.furniture}`)).status).toBe(200);
    expect((await C.get('/ledger/trial-balance')).body.data.balanced).toBe(true);
    expect((await C.get('/ledger/balance-sheet')).body.data.balanced).toBe(true);
  });

  it('another school sees none of it', async () => {
    const other = await createTestSchool('led2');
    try {
      const u = await other.user('ACCOUNTANT');
      const h = { Authorization: `Bearer ${u.token}` };
      const rows = (await request(app).get('/api/v1/ledger/accounts').set(h)).body.data;
      expect(rows.every((r: Row) => Number(r.balance) === 0)).toBe(true);
      expect((await request(app).get(`/api/v1/ledger/accounts/${(await acc('Cash in hand')).id}/ledger`).set(h)).status).toBe(404);
    } finally { await other.destroy(); }
  });
});
