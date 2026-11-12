/**
 * Finance step 2: money accounts, fee payments landing in accounts, hand-entered
 * movements and transfers, expenses with owner approval, other income, statements.
 *   RUN_DB_TESTS=1 npm test -- src/__tests__/db/finance
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

d('Finance: accounts, expenses, income (database)', () => {
  let t: Awaited<ReturnType<typeof createTestSchool>>;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const today = dayInTimezone('Asia/Karachi');
  const month = today.slice(0, 7);
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
  const balances = async () => {
    const r = await as('ACCOUNTANT').get('/finance/accounts');
    return Object.fromEntries(r.body.data.map((a: { name: string; balance: string }) => [a.name, Number(a.balance)]));
  };
  const account = async (name: string) => (await as('ACCOUNTANT').get('/finance/accounts')).body.data.find((a: { name: string }) => a.name === name);
  const category = async (kind: string, name: string) =>
    (await as('ACCOUNTANT').get(`/finance/categories?kind=${kind}`)).body.data.find((c: { name: string }) => c.name === name).id;

  beforeAll(async () => {
    await connectRedis();
    t = await createTestSchool('fin');
    for (const r of ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER'] as const) {
      const u = await t.user(r);
      tok[r] = u.token;
      ids[`user${r}`] = u.id;
    }
    const cls = await as('ADMIN').post('/academics/classes', { name: 'Class 6', level: 6, sections: ['A'] });
    const admit = await as('ADMIN').post('/students', { admissionNo: `T-${Math.random().toString(36).slice(2, 10)}`,
      name: 'Fee Payer', sectionId: cls.body.data.sections[0].id, monthlyFee: 3000,
      guardians: [{ name: 'Parent', phone: '03005556677', relation: 'FATHER', isPrimary: true }],
    });
    ids.student = admit.body.data.student.id;
    const gen = await as('ACCOUNTANT').post('/fees/invoices/generate', { period: month, classIds: [cls.body.data.id] });
    expect(gen.status).toBe(201);
  });
  afterAll(async () => { await t.destroy(); });

  it('sets itself up on first use and files earlier fee payments under the right account', async () => {
    // Collected before anyone opened Finance: no accounts exist yet.
    const early = await as('ACCOUNTANT').post('/fees/payments', { studentId: ids.student, amount: 1000, method: 'CASH' });
    expect(early.status).toBe(201);
    expect(await basePrisma.moneyAccount.count({ where: { schoolId: t.school.id } })).toBe(0);

    const list = await as('ACCOUNTANT').get('/finance/accounts');
    expect(list.status).toBe(200);
    expect(list.body.data.map((a: { name: string }) => a.name)).toEqual(['Cash in hand', 'Bank account', 'Mobile wallets']);
    expect(await balances()).toEqual({ 'Cash in hand': 1000, 'Bank account': 0, 'Mobile wallets': 0 });

    // From now on a payment goes straight to the account for its method.
    const bank = await as('ACCOUNTANT').post('/fees/payments', { studentId: ids.student, amount: 1500, method: 'BANK_TRANSFER', reference: 'TXN-1' });
    expect(bank.status).toBe(201);
    expect(await balances()).toEqual({ 'Cash in hand': 1000, 'Bank account': 1500, 'Mobile wallets': 0 });

    const cats = await as('ACCOUNTANT').get('/finance/categories');
    expect(cats.body.data.filter((c: { kind: string }) => c.kind === 'EXPENSE').length).toBe(8);
    expect(cats.body.data.filter((c: { kind: string }) => c.kind === 'INCOME').length).toBe(5);
  });

  it('is open by role: owner and principal read, accountant works, office admin and teachers have no access', async () => {
    expect((await as('OWNER').get('/finance/summary')).status).toBe(200);
    expect((await as('PRINCIPAL').get('/finance/accounts')).status).toBe(200);
    expect((await as('ADMIN').get('/finance/accounts')).status).toBe(403);
    expect((await as('TEACHER').get('/finance/summary')).status).toBe(403);
    const cash = await account('Cash in hand');
    const body = { type: 'DEPOSIT', amount: 10, txDate: today, description: 'x x' };
    expect((await as('PRINCIPAL').post(`/finance/accounts/${cash.id}/transactions`, body)).status).toBe(403);
    expect((await as('TEACHER').post(`/finance/accounts/${cash.id}/transactions`, body)).status).toBe(403);
  });

  it('accounts: add with an opening balance, one account per payment method, no duplicates', async () => {
    const A = as('ACCOUNTANT');
    const add = await A.post('/finance/accounts', { name: 'HBL current', type: 'BANK', accountNo: '0123-456', methods: ['CHEQUE'], openingBalance: 20000, openingDate: today });
    expect(add.status).toBe(201);
    ids.hbl = add.body.data.id;
    expect((await A.post('/finance/accounts', { name: 'HBL current', type: 'BANK' })).status).toBe(409);
    // Cheques now go to HBL, so the default bank account gave that method up.
    expect((await account('Bank account')).methods).toEqual(['BANK_TRANSFER', 'CARD', 'ONLINE']);
    expect((await balances())['HBL current']).toBe(20000);
    // An account that still holds money can't be closed.
    const close = await A.patch(`/finance/accounts/${ids.hbl}`, { isActive: false });
    expect(close.status).toBe(409);
    expect(close.body.message).toMatch(/still holds 20000/);
  });

  it('deposits, withdrawals and transfers move the balance; an account can’t be overdrawn', async () => {
    const A = as('ACCOUNTANT');
    const cash = await account('Cash in hand');
    const bank = await account('Bank account');
    expect((await A.post(`/finance/accounts/${cash.id}/transactions`, { type: 'DEPOSIT', amount: 5000, txDate: today, description: 'Owner put cash in' })).status).toBe(201);
    const over = await A.post(`/finance/accounts/${cash.id}/transactions`, { type: 'WITHDRAWAL', amount: 99999, txDate: today, description: 'Too much' });
    expect(over.status).toBe(409);
    expect(over.body.message).toMatch(/Cash in hand has only 6000/);
    const future = await A.post(`/finance/accounts/${cash.id}/transactions`, { type: 'DEPOSIT', amount: 5, txDate: '2099-01-01', description: 'Later' });
    expect(future.status).toBe(422);

    const move = await A.post('/finance/transfers', { fromAccountId: cash.id, toAccountId: bank.id, amount: 4000, txDate: today, description: 'Deposited at branch' });
    expect(move.status).toBe(201);
    expect(await balances()).toMatchObject({ 'Cash in hand': 2000, 'Bank account': 5500 });
    expect((await A.post('/finance/transfers', { fromAccountId: cash.id, toAccountId: cash.id, amount: 1, txDate: today })).status).toBe(422);
    expect((await A.post('/finance/transfers', { fromAccountId: cash.id, toAccountId: bank.id, amount: 2001, txDate: today })).status).toBe(409);

    // Removing one side of a transfer removes both.
    const half = await basePrisma.moneyTransaction.findFirstOrThrow({ where: { transferId: move.body.data.transferId, type: 'TRANSFER_IN' } });
    expect((await A.del(`/finance/transactions/${half.id}`)).status).toBe(200);
    expect(await balances()).toMatchObject({ 'Cash in hand': 6000, 'Bank account': 1500 });
  });

  it('expenses reduce the account; above the owner’s limit they wait for approval', async () => {
    const A = as('ACCOUNTANT');
    const cash = await account('Cash in hand');
    const utilities = await category('EXPENSE', 'Utilities');
    const base = { categoryId: utilities, accountId: cash.id, expenseDate: today };

    const small = await A.post('/finance/expenses', { ...base, amount: 800, description: 'Electricity bill', paidTo: 'LESCO' });
    expect(small.status).toBe(201);
    expect(small.body.data).toMatchObject({ expenseNo: 'EXP-00001', status: 'APPROVED' });
    expect((await balances())['Cash in hand']).toBe(5200);
    expect((await A.post('/finance/expenses', { ...base, amount: 5201, description: 'Too big' })).status).toBe(409);
    const income = await category('INCOME', 'Donations');
    expect((await A.post('/finance/expenses', { ...base, categoryId: income, amount: 5, description: 'Wrong kind' })).status).toBe(422);

    // Only the owner sets the limit.
    expect((await A.put('/finance/settings', { expenseApprovalLimit: 1000 })).status).toBe(403);
    expect((await as('OWNER').put('/finance/settings', { expenseApprovalLimit: 1000 })).status).toBe(200);

    const big = await A.post('/finance/expenses', { ...base, amount: 3000, description: 'Generator repair' });
    expect(big.status).toBe(201);
    expect(big.body.data.status).toBe('PENDING');
    expect((await balances())['Cash in hand']).toBe(5200); // not paid yet
    const note = await basePrisma.notification.findFirst({ where: { userId: ids.userOWNER, type: 'EXPENSE_APPROVAL' } });
    expect(note?.body).toMatch(/Generator repair/);
    const summary = await as('OWNER').get('/finance/summary');
    expect(summary.body.data.pendingExpenses).toMatchObject({ count: 1 });

    expect((await A.post(`/finance/expenses/${big.body.data.id}/decision`, { approve: true })).status).toBe(403);
    expect((await as('OWNER').post(`/finance/expenses/${big.body.data.id}/decision`, { approve: true })).status).toBe(200);
    expect((await as('OWNER').post(`/finance/expenses/${big.body.data.id}/decision`, { approve: false })).status).toBe(409);
    expect((await balances())['Cash in hand']).toBe(2200);
    expect(await basePrisma.notification.count({ where: { userId: ids.userACCOUNTANT, type: 'EXPENSE_DECIDED' } })).toBe(1);

    const refused = await A.post('/finance/expenses', { ...base, amount: 1500, description: 'New sofa' });
    expect((await as('OWNER').post(`/finance/expenses/${refused.body.data.id}/decision`, { approve: false, note: 'Not this year' })).status).toBe(200);
    expect((await balances())['Cash in hand']).toBe(2200);

    const list = await A.get(`/finance/expenses?from=${today}&to=${today}`);
    expect(list.body.pagination.total).toBe(3);
    expect(Number(list.body.totals.amount)).toBe(3800); // approved only
    expect((await A.get('/finance/expenses?status=REJECTED')).body.data[0]).toMatchObject({ description: 'New sofa', decisionNote: 'Not this year' });

    // Removing an approved expense puts the money back.
    expect((await A.del(`/finance/expenses/${small.body.data.id}`)).status).toBe(200);
    expect((await balances())['Cash in hand']).toBe(3000);
  });

  it('other income adds to the account', async () => {
    const A = as('ACCOUNTANT');
    const wallet = await account('Mobile wallets');
    const canteen = await category('INCOME', 'Canteen rent');
    const inc = await A.post('/finance/income', { categoryId: canteen, accountId: wallet.id, amount: 7000, incomeDate: today, description: 'November rent', receivedFrom: 'Canteen contractor' });
    expect(inc.status).toBe(201);
    expect(inc.body.data.incomeNo).toBe('INC-00001');
    expect((await balances())['Mobile wallets']).toBe(7000);
    const list = await A.get('/finance/income');
    expect(Number(list.body.totals.amount)).toBe(7000);
    expect((await as('PRINCIPAL').post('/finance/income', { categoryId: canteen, accountId: wallet.id, amount: 1, incomeDate: today, description: 'No' })).status).toBe(403);
  });

  it('categories can be added, renamed and retired', async () => {
    const A = as('ACCOUNTANT');
    const add = await A.post('/finance/categories', { kind: 'EXPENSE', name: 'Security' });
    expect(add.status).toBe(201);
    expect((await A.post('/finance/categories', { kind: 'EXPENSE', name: 'Security' })).status).toBe(409);
    expect((await A.patch(`/finance/categories/${add.body.data.id}`, { name: 'Security guards', isActive: false })).status).toBe(200);
    const cash = await account('Cash in hand');
    expect((await A.post('/finance/expenses', { categoryId: add.body.data.id, accountId: cash.id, amount: 5, expenseDate: today, description: 'Retired heading' })).status).toBe(422);
  });

  it('statements: opening + in − out = closing, with a running balance; the month summary adds up', async () => {
    const O = as('OWNER');
    const cash = await account('Cash in hand');
    const st = await O.get(`/finance/transactions?accountId=${cash.id}&from=${today}&to=${today}`);
    expect(st.status).toBe(200);
    const s = st.body.data;
    expect(Number(s.opening) + Number(s.totalIn) - Number(s.totalOut)).toBe(Number(s.closing));
    expect(Number(s.closing)).toBe(3000);
    expect(Number(s.rows[s.rows.length - 1].balance)).toBe(3000);
    expect(s.rows.map((r: { kind: string }) => r.kind).sort()).toEqual(['DEPOSIT', 'EXPENSE', 'FEE']);
    expect(s.rows.find((r: { kind: string }) => r.kind === 'FEE').description).toBe('Fee — Fee Payer');

    // Day book across all accounts closes at the sum of every balance.
    const book = await O.get(`/finance/transactions?from=${today}&to=${today}`);
    const total = Object.values(await balances()).reduce((a, b) => a + b, 0);
    expect(Number(book.body.data.closing)).toBe(total);
    expect(book.body.data.rows.some((r: { kind: string; account: string }) => r.kind === 'OPENING' && r.account === 'HBL current')).toBe(true);

    const sum = (await O.get(`/finance/summary?month=${month}`)).body.data;
    expect(Number(sum.income.fees)).toBe(2500);
    expect(Number(sum.income.other)).toBe(7000);
    expect(Number(sum.expenses.total)).toBe(3000);
    expect(Number(sum.net)).toBe(6500);
    expect(Number(sum.totalBalance)).toBe(total);
    expect(sum.expenses.byCategory[0]).toMatchObject({ category: 'Utilities' });
  });

  it('keeps another school’s money out of sight', async () => {
    const other = await createTestSchool('fin2');
    try {
      const u = await other.user('ACCOUNTANT');
      const h = { Authorization: `Bearer ${u.token}` };
      const list = await request(app).get('/api/v1/finance/accounts').set(h);
      expect(list.body.data.every((a: { balance: string }) => Number(a.balance) === 0)).toBe(true);
      const patch = await request(app).patch(`/api/v1/finance/accounts/${ids.hbl}`).set(h).send({ name: 'Mine now' });
      expect(patch.status).toBe(404);
    } finally { await other.destroy(); }
  });
});
