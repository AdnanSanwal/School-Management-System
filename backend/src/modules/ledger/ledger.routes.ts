import { Router } from 'express';
import { z } from 'zod';
import { LedgerAccount, Prisma } from '@prisma/client';
import prisma, { transaction } from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { authenticate } from '../../middleware/auth';
import { can, hasPermission } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { handler, parseBody, parseQuery, dateOnly, id, money, period, me } from '../../utils/http';
import { addDays, periodOf, periodRange, schoolToday, toDate, toIso } from '../../utils/dates';
import { formatNumber, nextNumber } from '../../utils/counter';
import { assertBooksOpen, assertCanPay } from '../../utils/finance';
import { CUSTOM_FIRST_CODE, ensureLedgerSetup, ledgerBalances, ledgerEntries, natural, nextCode, sortChart } from '../../utils/ledger';
import { monthLabel } from '../../utils/payroll';
import { D } from '../fees/fees.calc';

// Accounting: chart of accounts, the journal, account ledgers, trial balance,
// income & expenditure, balance sheet, hand-made journal entries and month closing.

const router = Router();
router.use(authenticate);

const TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const;
const linkOf = (a: LedgerAccount) => (a.moneyAccountId ? 'MONEY' : a.categoryId ? 'CATEGORY' : a.systemKey ? 'SYSTEM' : null);
const brief = (a: LedgerAccount) => ({ id: a.id, code: a.code, name: a.name, type: a.type });

/** from/to with "this month so far" as the default. */
async function rangeOf(q: { from?: string; to?: string }) {
  const today = await schoolToday();
  const to = q.to ? toDate(q.to) : today;
  const from = q.from ? toDate(q.from) : new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  if (from > to) throw new AppError('The start date is after the end date', 422);
  return { from, to };
}
const rangeQuery = z.object({ from: dateOnly.optional(), to: dateOnly.optional() });
const asOfQuery = z.object({ asOf: dateOnly.optional() });

// ─── Chart of accounts ───

router.get('/accounts', can('finance.view'), handler(async (_req, res) => {
  const chart = await ensureLedgerSetup();
  const [balances, used] = await Promise.all([
    ledgerBalances(chart),
    prisma.journalLine.groupBy({ by: ['accountId'], _count: true }),
  ]);
  return sendSuccess(res, sortChart(chart).map((a) => ({
    ...brief(a), isActive: a.isActive, link: linkOf(a), systemKey: a.systemKey,
    balance: natural(a.type, balances.get(a.id) ?? D(0)),
    journalLines: used.find((u) => u.accountId === a.id)?._count ?? 0,
  })));
}));

const accountBody = z.object({
  name: z.string().trim().min(2).max(100),
  type: z.enum(TYPES),
  code: z.string().trim().regex(/^\d{3,6}$/, 'use 3 to 6 digits').optional(),
});

router.post('/accounts', can('finance.manage'), handler(async (req, res) => {
  const b = parseBody(accountBody, req);
  const chart = await ensureLedgerSetup();
  if (chart.some((a) => a.name.toLowerCase() === b.name.toLowerCase())) throw new AppError(`An account called “${b.name}” already exists`, 409);
  if (b.code && chart.some((a) => a.code === b.code)) throw new AppError(`Code ${b.code} is already used`, 409);
  const code = b.code ?? nextCode(new Set(chart.map((a) => a.code)), CUSTOM_FIRST_CODE[b.type]);
  const account = await prisma.ledgerAccount.create({ data: { schoolId: currentSchoolId(), code, name: b.name, type: b.type } });
  return sendSuccess(res, account, `Account ${code} added`, 201);
}));

async function ownAccount(accountId: string) {
  const account = await prisma.ledgerAccount.findFirst({ where: { id: accountId } });
  if (!account) throw new AppError('Account not found', 404);
  const link = linkOf(account);
  if (link) {
    throw new AppError(link === 'MONEY' ? 'This follows a cash or bank account. Change it under Finance → Accounts.'
      : link === 'CATEGORY' ? 'This follows an expense or income category. Change it from the Categories button.' : 'This is a built-in account and can’t be changed.', 409);
  }
  return account;
}

router.patch('/accounts/:id', can('finance.manage'), handler(async (req, res) => {
  const b = parseBody(z.object({ name: accountBody.shape.name.optional(), code: accountBody.shape.code, isActive: z.boolean().optional() }).strict(), req);
  const account = await ownAccount(req.params.id);
  const chart = await prisma.ledgerAccount.findMany({ where: { NOT: { id: account.id } } });
  if (b.name && chart.some((a) => a.name.toLowerCase() === b.name!.toLowerCase())) throw new AppError(`An account called “${b.name}” already exists`, 409);
  if (b.code && chart.some((a) => a.code === b.code)) throw new AppError(`Code ${b.code} is already used`, 409);
  return sendSuccess(res, await prisma.ledgerAccount.update({ where: { id: account.id }, data: b }), 'Account saved');
}));

router.delete('/accounts/:id', can('finance.manage'), handler(async (req, res) => {
  const account = await ownAccount(req.params.id);
  if (await prisma.journalLine.count({ where: { accountId: account.id } })) throw new AppError('This account has journal entries. Retire it instead of deleting it.', 409);
  await prisma.ledgerAccount.delete({ where: { id: account.id } });
  return sendSuccess(res, null, 'Account deleted');
}));

// ─── Journal and account ledger ───

router.get('/journal', can('finance.view'), handler(async (req, res) => {
  const { from, to } = await rangeOf(parseQuery(rangeQuery, req));
  const chart = await ensureLedgerSetup();
  const entries = await ledgerEntries(chart, from, to);
  const byId = new Map(chart.map((a) => [a.id, a]));
  return sendSuccess(res, {
    from: toIso(from), to: toIso(to),
    total: entries.reduce((t, e) => e.lines.reduce((s, l) => s.plus(l.debit), t), D(0)),
    entries: entries.map((e) => ({ ...e, lines: e.lines.map((l) => ({ ...l, code: byId.get(l.accountId)!.code, name: byId.get(l.accountId)!.name })) })),
  });
}));

/** One account's ledger: opening balance, every posting in the dates, running balance. */
router.get('/accounts/:id/ledger', can('finance.view'), handler(async (req, res) => {
  const { from, to } = await rangeOf(parseQuery(rangeQuery, req));
  const chart = await ensureLedgerSetup();
  const account = chart.find((a) => a.id === req.params.id);
  if (!account) throw new AppError('Account not found', 404);
  const [before, entries] = await Promise.all([ledgerBalances(chart, from), ledgerEntries(chart, from, to)]);
  const byId = new Map(chart.map((a) => [a.id, a]));
  const opening = natural(account.type, before.get(account.id) ?? D(0));
  let running = opening;
  let debit = D(0); let credit = D(0);
  const rows = entries.flatMap((e) => e.lines.filter((l) => l.accountId === account.id).map((l) => {
    running = running.plus(natural(account.type, l.debit.minus(l.credit)));
    debit = debit.plus(l.debit); credit = credit.plus(l.credit);
    // The other side of the entry, so the reader sees where it went.
    const others = [...new Set(e.lines.filter((o) => o.accountId !== account.id).map((o) => byId.get(o.accountId)!.name))];
    return { id: `${e.id}-${l.debit.gt(0) ? 'd' : 'c'}`, date: e.date, kind: e.kind, reference: e.reference, description: e.description, against: others.join(', '), debit: l.debit, credit: l.credit, balance: running };
  }));
  return sendSuccess(res, { account: { ...brief(account), link: linkOf(account) }, from: toIso(from), to: toIso(to), opening, debit, credit, closing: running, rows });
}));

// ─── Statements ───

router.get('/trial-balance', can('finance.view'), handler(async (req, res) => {
  const q = parseQuery(asOfQuery, req);
  const asOf = q.asOf ? toDate(q.asOf) : await schoolToday();
  const chart = await ensureLedgerSetup();
  const balances = await ledgerBalances(chart, addDays(asOf, 1));
  const rows = sortChart(chart).map((a) => {
    const b = balances.get(a.id) ?? D(0);
    return { ...brief(a), debit: b.gt(0) ? b : D(0), credit: b.lt(0) ? b.neg() : D(0) };
  }).filter((r) => !r.debit.isZero() || !r.credit.isZero());
  const debit = rows.reduce((t, r) => t.plus(r.debit), D(0));
  const credit = rows.reduce((t, r) => t.plus(r.credit), D(0));
  return sendSuccess(res, { asOf: toIso(asOf), rows, debit, credit, balanced: debit.eq(credit) });
}));

/** Income and expenditure for a date range: what was earned, what was spent, what is left. */
router.get('/income-statement', can('finance.view'), handler(async (req, res) => {
  const { from, to } = await rangeOf(parseQuery(rangeQuery, req));
  const chart = await ensureLedgerSetup();
  const [start, end] = await Promise.all([ledgerBalances(chart, from), ledgerBalances(chart, addDays(to, 1))]);
  const section = (type: 'INCOME' | 'EXPENSE') => {
    const rows = sortChart(chart).filter((a) => a.type === type)
      .map((a) => ({ ...brief(a), amount: natural(type, (end.get(a.id) ?? D(0)).minus(start.get(a.id) ?? D(0))) }))
      .filter((r) => !r.amount.isZero());
    return { rows, total: rows.reduce((t, r) => t.plus(r.amount), D(0)) };
  };
  const income = section('INCOME');
  const expenses = section('EXPENSE');
  return sendSuccess(res, { from: toIso(from), to: toIso(to), income, expenses, surplus: income.total.minus(expenses.total) });
}));

/** What the school owns and owes on a date. Assets = liabilities + equity (with the surplus so far). */
router.get('/balance-sheet', can('finance.view'), handler(async (req, res) => {
  const q = parseQuery(asOfQuery, req);
  const asOf = q.asOf ? toDate(q.asOf) : await schoolToday();
  const chart = await ensureLedgerSetup();
  const balances = await ledgerBalances(chart, addDays(asOf, 1));
  const section = (type: 'ASSET' | 'LIABILITY' | 'EQUITY') => {
    const rows = sortChart(chart).filter((a) => a.type === type)
      .map((a) => ({ ...brief(a), amount: natural(type, balances.get(a.id) ?? D(0)) })).filter((r) => !r.amount.isZero());
    return { rows, total: rows.reduce((t, r) => t.plus(r.amount), D(0)) };
  };
  // Income less expenses since the books began; it belongs to the owner.
  const surplus = chart.filter((a) => a.type === 'INCOME' || a.type === 'EXPENSE').reduce((t, a) => t.minus(balances.get(a.id) ?? D(0)), D(0));
  const assets = section('ASSET');
  const liabilities = section('LIABILITY');
  const equity = section('EQUITY');
  const equityTotal = equity.total.plus(surplus);
  return sendSuccess(res, {
    asOf: toIso(asOf), assets, liabilities, equity: { rows: equity.rows, surplus, total: equityTotal },
    liabilitiesAndEquity: liabilities.total.plus(equityTotal), balanced: assets.total.eq(liabilities.total.plus(equityTotal)),
  });
}));

// ─── Journal entries made by hand ───

router.post('/journals', can('finance.manage'), handler(async (req, res) => {
  const b = parseBody(z.object({
    date: dateOnly,
    description: z.string().trim().min(2).max(300),
    reference: z.string().trim().max(100).optional(),
    lines: z.array(z.object({ accountId: id, debit: money.default(0), credit: money.default(0) })).min(2).max(20),
  }), req);
  if (toDate(b.date) > await schoolToday()) throw new AppError('The date can’t be in the future', 422);
  await assertBooksOpen(b.date);
  const chart = await ensureLedgerSetup();
  const lines = b.lines.map((l) => {
    const account = chart.find((a) => a.id === l.accountId);
    if (!account || !account.isActive) throw new AppError('Choose an account that is in use', 422);
    if (account.systemKey === 'STAFF_ADVANCES') throw new AppError('Staff advances are recorded under HR → Advances & loans, not by journal', 422);
    if ((l.debit > 0) === (l.credit > 0)) throw new AppError(`${account.name}: enter either a debit or a credit`, 422);
    return { account, debit: D(l.debit), credit: D(l.credit) };
  });
  const debit = lines.reduce((t, l) => t.plus(l.debit), D(0));
  const credit = lines.reduce((t, l) => t.plus(l.credit), D(0));
  if (!debit.eq(credit)) throw new AppError(`Debits (${debit.toFixed(2)}) and credits (${credit.toFixed(2)}) must be equal`, 422);
  // Money can't leave a cash or bank account that doesn't hold it.
  const out = new Map<string, Prisma.Decimal>();
  for (const l of lines) if (l.account.moneyAccountId) out.set(l.account.moneyAccountId, (out.get(l.account.moneyAccountId) ?? D(0)).plus(l.credit).minus(l.debit));
  for (const [moneyId, amount] of out) if (amount.gt(0)) await assertCanPay(moneyId, amount, 'this entry');

  const schoolId = currentSchoolId();
  const entry = await transaction(async (tx) => {
    const e = await tx.journalEntry.create({
      data: { schoolId, entryNo: formatNumber('JV', await nextNumber(tx, 'journal')), date: toDate(b.date), description: b.description, reference: b.reference || null, createdById: me(req).id },
    });
    await tx.journalLine.createMany({
      data: lines.map((l) => ({ schoolId, entryId: e.id, accountId: l.account.id, debit: l.debit, credit: l.credit, date: toDate(b.date), moneyAccountId: l.account.moneyAccountId })),
    });
    return e;
  });
  return sendSuccess(res, entry, `Journal entry ${entry.entryNo} posted`, 201);
}));

router.delete('/journals/:id', can('finance.manage'), handler(async (req, res) => {
  const entry = await prisma.journalEntry.findFirst({ where: { id: req.params.id }, include: { lines: true } });
  if (!entry) throw new AppError('Journal entry not found', 404);
  await assertBooksOpen(entry.date);
  // Removing money that came into an account must not leave it overdrawn.
  const back = new Map<string, Prisma.Decimal>();
  for (const l of entry.lines) if (l.moneyAccountId) back.set(l.moneyAccountId, (back.get(l.moneyAccountId) ?? D(0)).plus(l.debit).minus(l.credit));
  for (const [moneyId, amount] of back) if (amount.gt(0)) await assertCanPay(moneyId, amount, 'removing this entry');
  await prisma.journalEntry.delete({ where: { id: entry.id } });
  return sendSuccess(res, null, `${entry.entryNo} removed`);
}));

// ─── Month closing ───

const prev = (p: string) => periodOf(addDays(periodRange(p).start, -1));


router.get('/closing', can('finance.view'), handler(async (req, res) => {
  const school = await prisma.school.findUniqueOrThrow({ where: { id: currentSchoolId() }, select: { booksClosedThrough: true } });
  const current = periodOf(await schoolToday());
  const closed = school.booksClosedThrough;
  const role = me(req).role;
  return sendSuccess(res, {
    closedThrough: closed, closedLabel: closed ? monthLabel(closed) : null,
    // The latest month that can be closed is last month.
    canCloseThrough: prev(current) > (closed ?? '') ? prev(current) : null,
    canClose: hasPermission(role, 'finance.manage'), canReopen: hasPermission(role, 'books.reopen'),
  });
}));

/** Locks every month up to and including `period`: nothing dated there can be added, changed or removed. */
router.post('/close', can('finance.manage'), handler(async (req, res) => {
  const b = parseBody(z.object({ period }), req);
  const school = await prisma.school.findUniqueOrThrow({ where: { id: currentSchoolId() }, select: { booksClosedThrough: true } });
  if (b.period >= periodOf(await schoolToday())) throw new AppError('Only months that have ended can be closed', 422);
  if (school.booksClosedThrough && b.period <= school.booksClosedThrough) throw new AppError(`${monthLabel(b.period)} is already closed`, 409);
  const { end } = periodRange(b.period);
  const pending = await prisma.expense.count({ where: { status: 'PENDING', expenseDate: { lte: end } } });
  if (pending) throw new AppError(`${pending} expense${pending > 1 ? 's' : ''} dated up to ${monthLabel(b.period)} still wait for the owner’s approval. Decide them first.`, 409);
  const unpaid = await prisma.payrollRun.findFirst({ where: { period: { lte: b.period }, status: { not: 'PAID' } }, orderBy: { period: 'asc' } });
  if (unpaid) throw new AppError(`The payroll for ${monthLabel(unpaid.period)} is not paid yet. Pay it (or delete the draft) before closing.`, 409);
  await prisma.school.update({ where: { id: currentSchoolId() }, data: { booksClosedThrough: b.period } });
  return sendSuccess(res, { closedThrough: b.period }, `Books closed up to ${monthLabel(b.period)}`);
}));

/** The owner reopens from `period` onwards (earlier months stay closed). */
router.post('/reopen', can('books.reopen'), handler(async (req, res) => {
  const b = parseBody(z.object({ period }), req);
  const school = await prisma.school.findUniqueOrThrow({ where: { id: currentSchoolId() }, select: { booksClosedThrough: true } });
  if (!school.booksClosedThrough || b.period > school.booksClosedThrough) throw new AppError(`${monthLabel(b.period)} is not closed`, 409);
  await prisma.school.update({ where: { id: currentSchoolId() }, data: { booksClosedThrough: prev(b.period) } });
  return sendSuccess(res, { closedThrough: prev(b.period) }, `${monthLabel(b.period)} onwards is open again`);
}));

export default router;
