import crypto from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { PaymentMethod, Prisma } from '@prisma/client';
import prisma, { transaction } from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { authenticate } from '../../middleware/auth';
import { can, hasPermission } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { handler, parseBody, parseQuery, paginationSchema, paging, dateOnly, id, money, period, me } from '../../utils/http';
import { addDays, periodRange, schoolTimezone, schoolToday, toDate, toIso, zonedDayStart } from '../../utils/dates';
import { formatNumber, nextNumber } from '../../utils/counter';
import { notify } from '../../utils/notify';
import { assertKind, deleteFile, saveFile, signedUrl } from '../../utils/storage';
import { uploadOne } from '../files/files.routes';
import { accountBalances, assertCanPay, ensureFinanceSetup, movements } from '../../utils/finance';
import { D } from '../fees/fees.calc';

// Finance: money accounts, hand-entered movements and transfers, expenses (with approval
// above a limit), other income, and the day book. The accounting ledger and statements
// build on these in a later step.

const router = Router();
router.use(authenticate);
// Every finance screen needs the standard accounts and categories to exist.
router.use((req, _res, next) => {
  if (!hasPermission(me(req as never).role, 'finance.view')) return next();
  ensureFinanceSetup().then(() => next(), next);
});

const positive = money.refine((v) => v > 0, 'must be more than 0');
const notFuture = async (iso: string, what: string) => {
  if (toDate(iso) > await schoolToday()) throw new AppError(`${what} can’t be in the future`, 422);
};

// ─── Overview ───

router.get('/summary', can('finance.view'), handler(async (req, res) => {
  const today = await schoolToday();
  const q = parseQuery(z.object({ month: period.default(toIso(today).slice(0, 7)) }), req);
  const { start, end } = periodRange(q.month);
  const tz = await schoolTimezone();
  const [accounts, fees, incomes, expenses, pending] = await Promise.all([
    accountBalances(),
    prisma.payment.aggregate({ where: { status: 'SUCCESS', paidAt: { gte: zonedDayStart(toIso(start), tz), lt: zonedDayStart(toIso(addDays(end, 1)), tz) } }, _sum: { amount: true } }),
    prisma.otherIncome.groupBy({ by: ['categoryId'], where: { incomeDate: { gte: start, lte: end } }, _sum: { amount: true } }),
    prisma.expense.groupBy({ by: ['categoryId'], where: { status: 'APPROVED', expenseDate: { gte: start, lte: end } }, _sum: { amount: true } }),
    prisma.expense.aggregate({ where: { status: 'PENDING' }, _count: true, _sum: { amount: true } }),
  ]);
  const cats = await prisma.financeCategory.findMany({ select: { id: true, name: true } });
  const name = (cid: string) => cats.find((c) => c.id === cid)?.name ?? 'Other';
  const byCat = (rows: { categoryId: string; _sum: { amount: Prisma.Decimal | null } }[]) =>
    rows.map((r) => ({ category: name(r.categoryId), amount: D(r._sum.amount ?? 0) })).sort((a, b) => b.amount.comparedTo(a.amount));
  const feeIncome = D(fees._sum.amount ?? 0);
  const otherIncome = incomes.reduce((t, r) => t.plus(r._sum.amount ?? 0), D(0));
  const totalExpense = expenses.reduce((t, r) => t.plus(r._sum.amount ?? 0), D(0));
  return sendSuccess(res, {
    month: q.month,
    accounts: accounts.filter((a) => a.isActive).map((a) => ({ id: a.id, name: a.name, type: a.type, balance: a.balance })),
    totalBalance: accounts.filter((a) => a.isActive).reduce((t, a) => t.plus(a.balance), D(0)),
    income: { fees: feeIncome, other: otherIncome, total: feeIncome.plus(otherIncome), otherByCategory: byCat(incomes) },
    expenses: { total: totalExpense, byCategory: byCat(expenses) },
    net: feeIncome.plus(otherIncome).minus(totalExpense),
    pendingExpenses: { count: pending._count, amount: D(pending._sum.amount ?? 0) },
  });
}));

// ─── Money accounts ───

const accountBody = z.object({
  name: z.string().trim().min(2).max(80),
  type: z.enum(['CASH', 'BANK', 'WALLET']),
  accountNo: z.string().trim().max(40).optional().nullable(),
  methods: z.array(z.nativeEnum(PaymentMethod)).max(7).default([]),
  openingBalance: money.default(0),
  openingDate: dateOnly.optional(),
  notes: z.string().trim().max(300).optional().nullable(),
  isActive: z.boolean().optional(),
});

/** A payment method can feed only one account, so fee payments have one place to go. */
async function claimMethods(accountId: string | null, methods: PaymentMethod[]) {
  if (!methods.length) return;
  const others = await prisma.moneyAccount.findMany({ where: accountId ? { NOT: { id: accountId } } : {} });
  for (const o of others) {
    const kept = (Array.isArray(o.methods) ? (o.methods as string[]) : []).filter((m) => !methods.includes(m as PaymentMethod));
    if (kept.length !== (o.methods as string[]).length) await prisma.moneyAccount.update({ where: { id: o.id }, data: { methods: kept } });
  }
}

router.get('/accounts', can('finance.view'), handler(async (_req, res) => {
  const accounts = await accountBalances();
  return sendSuccess(res, accounts.map((a) => ({ ...a, openingDate: toIso(a.openingDate) })));
}));

router.post('/accounts', can('finance.manage'), handler(async (req, res) => {
  const b = parseBody(accountBody, req);
  if (await prisma.moneyAccount.findFirst({ where: { name: b.name } })) throw new AppError(`An account called “${b.name}” already exists`, 409);
  const openingDate = b.openingDate ? toDate(b.openingDate) : await schoolToday();
  await claimMethods(null, b.methods);
  const account = await prisma.moneyAccount.create({
    data: { schoolId: currentSchoolId(), name: b.name, type: b.type, accountNo: b.accountNo || null, methods: b.methods, openingBalance: b.openingBalance, openingDate, notes: b.notes || null },
  });
  return sendSuccess(res, account, 'Account added', 201);
}));

router.patch('/accounts/:id', can('finance.manage'), handler(async (req, res) => {
  const b = parseBody(accountBody.partial().strict(), req);
  const account = await prisma.moneyAccount.findFirst({ where: { id: req.params.id } });
  if (!account) throw new AppError('Account not found', 404);
  if (b.name && b.name !== account.name && await prisma.moneyAccount.findFirst({ where: { name: b.name } })) throw new AppError(`An account called “${b.name}” already exists`, 409);
  if (b.isActive === false) {
    const balance = (await accountBalances()).find((a) => a.id === account.id)!.balance;
    if (!balance.isZero()) throw new AppError(`${account.name} still holds ${balance.toFixed(0)}. Transfer it out before closing the account.`, 409);
  }
  if (b.methods) await claimMethods(account.id, b.methods);
  const { openingDate, ...rest } = b;
  const updated = await prisma.moneyAccount.update({
    where: { id: account.id },
    data: { ...rest, ...(b.isActive === false ? { methods: [] } : {}), ...(openingDate ? { openingDate: toDate(openingDate) } : {}) },
  });
  return sendSuccess(res, updated, 'Account saved');
}));

// Hand-entered money in/out of one account.
router.post('/accounts/:id/transactions', can('finance.manage'), handler(async (req, res) => {
  const b = parseBody(z.object({
    type: z.enum(['DEPOSIT', 'WITHDRAWAL', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT']),
    amount: positive,
    txDate: dateOnly,
    description: z.string().trim().min(2).max(300),
    reference: z.string().trim().max(100).optional(),
  }), req);
  const account = await prisma.moneyAccount.findFirst({ where: { id: req.params.id, isActive: true } });
  if (!account) throw new AppError('Account not found', 404);
  await notFuture(b.txDate, 'The date');
  if (b.type === 'WITHDRAWAL' || b.type === 'ADJUSTMENT_OUT') await assertCanPay(account.id, b.amount, 'this');
  const tx = await prisma.moneyTransaction.create({
    data: { schoolId: currentSchoolId(), accountId: account.id, type: b.type, amount: b.amount, txDate: toDate(b.txDate), description: b.description, reference: b.reference || null, createdById: me(req).id },
  });
  return sendSuccess(res, tx, 'Recorded', 201);
}));

// Move money between two accounts (e.g. cash deposited in the bank).
router.post('/transfers', can('finance.manage'), handler(async (req, res) => {
  const b = parseBody(z.object({
    fromAccountId: id, toAccountId: id, amount: positive, txDate: dateOnly,
    description: z.string().trim().max(300).optional(), reference: z.string().trim().max(100).optional(),
  }), req);
  if (b.fromAccountId === b.toAccountId) throw new AppError('Choose two different accounts', 422);
  const accounts = await prisma.moneyAccount.findMany({ where: { id: { in: [b.fromAccountId, b.toAccountId] }, isActive: true } });
  const from = accounts.find((a) => a.id === b.fromAccountId);
  const to = accounts.find((a) => a.id === b.toAccountId);
  if (!from || !to) throw new AppError('Account not found', 404);
  await notFuture(b.txDate, 'The date');
  await assertCanPay(from.id, b.amount, 'this transfer');
  const transferId = crypto.randomUUID();
  const base = { schoolId: currentSchoolId(), amount: b.amount, txDate: toDate(b.txDate), reference: b.reference || null, transferId, createdById: me(req).id };
  await transaction(async (tx) => {
    await tx.moneyTransaction.create({ data: { ...base, accountId: from.id, type: 'TRANSFER_OUT', description: `To ${to.name}${b.description ? ` — ${b.description}` : ''}` } });
    await tx.moneyTransaction.create({ data: { ...base, accountId: to.id, type: 'TRANSFER_IN', description: `From ${from.name}${b.description ? ` — ${b.description}` : ''}` } });
  });
  return sendSuccess(res, { transferId }, `Transferred to ${to.name}`, 201);
}));

/** Removes a hand-entered movement; for a transfer, both sides go together. */
router.delete('/transactions/:id', can('finance.manage'), handler(async (req, res) => {
  const tx = await prisma.moneyTransaction.findFirst({ where: { id: req.params.id } });
  if (!tx) throw new AppError('Entry not found', 404);
  await prisma.moneyTransaction.deleteMany({ where: tx.transferId ? { transferId: tx.transferId } : { id: tx.id } });
  return sendSuccess(res, null, tx.transferId ? 'Transfer removed from both accounts' : 'Entry removed');
}));

/** Day book (all accounts) or one account's statement, with opening and closing balance. */
router.get('/transactions', can('finance.view'), handler(async (req, res) => {
  const today = await schoolToday();
  const q = parseQuery(z.object({ accountId: id.optional(), from: dateOnly.optional(), to: dateOnly.optional() }), req);
  const to = q.to ? toDate(q.to) : today;
  const from = q.from ? toDate(q.from) : new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  if (from > to) throw new AppError('The start date is after the end date', 422);
  const [rows, before, accounts] = await Promise.all([
    movements({ accountId: q.accountId, from, to }),
    accountBalances({ before: from }),
    prisma.moneyAccount.findMany({ select: { id: true, name: true } }),
  ]);
  const opening = before.filter((a) => !q.accountId || a.id === q.accountId).reduce((t, a) => t.plus(a.balance), D(0));
  let running = opening;
  const out = rows.map((r) => {
    running = running.plus(r.in).minus(r.out);
    return { ...r, account: accounts.find((a) => a.id === r.accountId)?.name ?? '', balance: running };
  });
  return sendSuccess(res, {
    from: toIso(from), to: toIso(to), opening, closing: running,
    totalIn: rows.reduce((t, r) => t.plus(r.in), D(0)), totalOut: rows.reduce((t, r) => t.plus(r.out), D(0)),
    rows: out,
  });
}));

// ─── Categories ───

router.get('/categories', can('finance.view'), handler(async (req, res) => {
  const q = parseQuery(z.object({ kind: z.enum(['EXPENSE', 'INCOME']).optional() }), req);
  return sendSuccess(res, await prisma.financeCategory.findMany({ where: q.kind ? { kind: q.kind } : {}, orderBy: [{ kind: 'asc' }, { name: 'asc' }] }));
}));

router.post('/categories', can('finance.manage'), handler(async (req, res) => {
  const b = parseBody(z.object({ kind: z.enum(['EXPENSE', 'INCOME']), name: z.string().trim().min(2).max(60) }), req);
  if (await prisma.financeCategory.findFirst({ where: { kind: b.kind, name: b.name } })) throw new AppError(`“${b.name}” already exists`, 409);
  return sendSuccess(res, await prisma.financeCategory.create({ data: { schoolId: currentSchoolId(), ...b } }), 'Category added', 201);
}));

router.patch('/categories/:id', can('finance.manage'), handler(async (req, res) => {
  const b = parseBody(z.object({ name: z.string().trim().min(2).max(60).optional(), isActive: z.boolean().optional() }).strict(), req);
  const cat = await prisma.financeCategory.findFirst({ where: { id: req.params.id } });
  if (!cat) throw new AppError('Category not found', 404);
  if (b.name && b.name !== cat.name && await prisma.financeCategory.findFirst({ where: { kind: cat.kind, name: b.name } })) throw new AppError(`“${b.name}” already exists`, 409);
  return sendSuccess(res, await prisma.financeCategory.update({ where: { id: cat.id }, data: b }), 'Category saved');
}));

// ─── Expenses ───

const expenseInclude = { category: { select: { id: true, name: true } }, account: { select: { id: true, name: true } } } satisfies Prisma.ExpenseInclude;
type ExpenseRow = Prisma.ExpenseGetPayload<{ include: typeof expenseInclude }>;
const presentExpense = ({ receiptKey, ...e }: ExpenseRow) => ({ ...e, expenseDate: toIso(e.expenseDate), receipt: signedUrl(receiptKey) });

router.get('/settings', can('finance.view'), handler(async (req, res) => {
  const school = await prisma.school.findUniqueOrThrow({ where: { id: currentSchoolId() }, select: { expenseApprovalLimit: true } });
  return sendSuccess(res, { expenseApprovalLimit: school.expenseApprovalLimit, canApprove: hasPermission(me(req).role, 'expense.approve') });
}));

/** The owner decides above which amount an expense needs their approval (empty = never). */
router.put('/settings', can('expense.approve'), handler(async (req, res) => {
  const b = parseBody(z.object({ expenseApprovalLimit: money.nullable() }), req);
  await prisma.school.update({ where: { id: currentSchoolId() }, data: { expenseApprovalLimit: b.expenseApprovalLimit } });
  return sendSuccess(res, b, b.expenseApprovalLimit === null ? 'Expenses no longer need approval' : `Expenses above ${b.expenseApprovalLimit} now need your approval`);
}));

router.get('/expenses', can('finance.view'), handler(async (req, res) => {
  const q = parseQuery(paginationSchema.extend({
    from: dateOnly.optional(), to: dateOnly.optional(), categoryId: id.optional(), accountId: id.optional(),
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(), search: z.string().max(100).optional(),
  }), req);
  const where: Prisma.ExpenseWhereInput = {
    ...(q.from || q.to ? { expenseDate: { ...(q.from ? { gte: toDate(q.from) } : {}), ...(q.to ? { lte: toDate(q.to) } : {}) } } : {}),
    ...(q.categoryId ? { categoryId: q.categoryId } : {}),
    ...(q.accountId ? { accountId: q.accountId } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.search ? { OR: [{ description: { contains: q.search } }, { paidTo: { contains: q.search } }, { expenseNo: { contains: q.search } }, { reference: { contains: q.search } }] } : {}),
  };
  const [rows, total, sum] = await Promise.all([
    prisma.expense.findMany({ where, include: expenseInclude, orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }], ...paging(q) }),
    prisma.expense.count({ where }),
    prisma.expense.aggregate({ where: { ...where, status: q.status ?? 'APPROVED' }, _sum: { amount: true } }),
  ]);
  return res.json({
    success: true, data: rows.map(presentExpense),
    pagination: { total, page: q.page, limit: q.limit, pages: Math.ceil(total / q.limit) },
    totals: { amount: D(sum._sum.amount ?? 0) },
  });
}));

// Multipart so a photo of the bill can be attached as "file" (optional).
router.post('/expenses', can('finance.manage'), uploadOne, handler(async (req, res) => {
  const b = parseBody(z.object({
    categoryId: id, accountId: id, amount: z.coerce.number().pipe(positive), expenseDate: dateOnly,
    description: z.string().trim().min(2).max(500),
    paidTo: z.string().trim().max(120).optional(), reference: z.string().trim().max(100).optional(),
  }), req);
  const [category, account, school] = await Promise.all([
    prisma.financeCategory.findFirst({ where: { id: b.categoryId, kind: 'EXPENSE', isActive: true } }),
    prisma.moneyAccount.findFirst({ where: { id: b.accountId, isActive: true } }),
    prisma.school.findUniqueOrThrow({ where: { id: currentSchoolId() }, select: { expenseApprovalLimit: true } }),
  ]);
  if (!category) throw new AppError('Choose an expense category', 422);
  if (!account) throw new AppError('Choose the account it was paid from', 422);
  await notFuture(b.expenseDate, 'The expense date');

  const user = me(req);
  const needsApproval = school.expenseApprovalLimit !== null && D(b.amount).gt(school.expenseApprovalLimit) && !hasPermission(user.role, 'expense.approve');
  if (!needsApproval) await assertCanPay(account.id, b.amount, 'this expense');

  const schoolId = currentSchoolId();
  let receiptKey: string | null = null;
  if (req.file) receiptKey = await saveFile(schoolId, 'documents', req.file.buffer, assertKind(req.file.buffer, ['pdf', 'jpg', 'png', 'webp']));
  try {
    const expense = await transaction(async (tx) => tx.expense.create({
      data: {
        schoolId, expenseNo: formatNumber('EXP', await nextNumber(tx, 'expense')), categoryId: category.id, accountId: account.id,
        amount: b.amount, expenseDate: toDate(b.expenseDate), description: b.description, paidTo: b.paidTo || null, reference: b.reference || null,
        receiptKey, status: needsApproval ? 'PENDING' : 'APPROVED', requestedById: user.id,
        ...(needsApproval ? {} : { decidedById: user.id, decidedAt: new Date() }),
      },
      include: expenseInclude,
    }));
    if (needsApproval) {
      const owners = await prisma.user.findMany({ where: { role: 'OWNER', isActive: true }, select: { id: true } });
      await notify(owners.map((o) => o.id), {
        type: 'EXPENSE_APPROVAL', title: 'Expense needs your approval',
        body: `${category.name}: ${D(b.amount).toFixed(0)} — ${b.description.slice(0, 100)}`, data: { expenseId: expense.id },
      });
    }
    return sendSuccess(res, presentExpense(expense), needsApproval ? 'Saved. It is above the approval limit, so it waits for the owner.' : `Expense ${expense.expenseNo} recorded`, 201);
  } catch (e) {
    await deleteFile(receiptKey);
    throw e;
  }
}));

router.post('/expenses/:id/decision', can('expense.approve'), handler(async (req, res) => {
  const b = parseBody(z.object({ approve: z.boolean(), note: z.string().trim().max(300).optional() }), req);
  const expense = await prisma.expense.findFirst({ where: { id: req.params.id }, include: expenseInclude });
  if (!expense) throw new AppError('Expense not found', 404);
  if (expense.status !== 'PENDING') throw new AppError('This expense was already decided', 409);
  if (b.approve) await assertCanPay(expense.accountId, expense.amount, 'this expense');
  const { count } = await prisma.expense.updateMany({
    where: { id: expense.id, status: 'PENDING' },
    data: { status: b.approve ? 'APPROVED' : 'REJECTED', decidedById: me(req).id, decidedAt: new Date(), decisionNote: b.note || null },
  });
  if (!count) throw new AppError('This expense was already decided', 409);
  if (expense.requestedById) {
    await notify([expense.requestedById], {
      type: 'EXPENSE_DECIDED', title: `Expense ${b.approve ? 'approved' : 'rejected'}`,
      body: `${expense.expenseNo} · ${expense.category.name} ${D(expense.amount).toFixed(0)}${b.note ? ` — ${b.note}` : ''}`, data: { expenseId: expense.id },
    });
  }
  return sendSuccess(res, null, b.approve ? 'Expense approved' : 'Expense rejected');
}));

router.delete('/expenses/:id', can('finance.manage'), handler(async (req, res) => {
  const expense = await prisma.expense.findFirst({ where: { id: req.params.id } });
  if (!expense) throw new AppError('Expense not found', 404);
  await prisma.expense.delete({ where: { id: expense.id } });
  await deleteFile(expense.receiptKey);
  return sendSuccess(res, null, expense.status === 'APPROVED' ? `Expense removed; ${D(expense.amount).toFixed(0)} is back in the account` : 'Expense removed');
}));

// ─── Other income ───

const incomeInclude = { category: { select: { id: true, name: true } }, account: { select: { id: true, name: true } } } satisfies Prisma.OtherIncomeInclude;

router.get('/income', can('finance.view'), handler(async (req, res) => {
  const q = parseQuery(paginationSchema.extend({ from: dateOnly.optional(), to: dateOnly.optional(), categoryId: id.optional(), accountId: id.optional(), search: z.string().max(100).optional() }), req);
  const where: Prisma.OtherIncomeWhereInput = {
    ...(q.from || q.to ? { incomeDate: { ...(q.from ? { gte: toDate(q.from) } : {}), ...(q.to ? { lte: toDate(q.to) } : {}) } } : {}),
    ...(q.categoryId ? { categoryId: q.categoryId } : {}),
    ...(q.accountId ? { accountId: q.accountId } : {}),
    ...(q.search ? { OR: [{ description: { contains: q.search } }, { receivedFrom: { contains: q.search } }, { incomeNo: { contains: q.search } }] } : {}),
  };
  const [rows, total, sum] = await Promise.all([
    prisma.otherIncome.findMany({ where, include: incomeInclude, orderBy: [{ incomeDate: 'desc' }, { createdAt: 'desc' }], ...paging(q) }),
    prisma.otherIncome.count({ where }),
    prisma.otherIncome.aggregate({ where, _sum: { amount: true } }),
  ]);
  return res.json({
    success: true, data: rows.map((r) => ({ ...r, incomeDate: toIso(r.incomeDate) })),
    pagination: { total, page: q.page, limit: q.limit, pages: Math.ceil(total / q.limit) },
    totals: { amount: D(sum._sum.amount ?? 0) },
  });
}));

router.post('/income', can('finance.manage'), handler(async (req, res) => {
  const b = parseBody(z.object({
    categoryId: id, accountId: id, amount: positive, incomeDate: dateOnly,
    description: z.string().trim().min(2).max(500),
    receivedFrom: z.string().trim().max(120).optional(), reference: z.string().trim().max(100).optional(),
  }), req);
  const [category, account] = await Promise.all([
    prisma.financeCategory.findFirst({ where: { id: b.categoryId, kind: 'INCOME', isActive: true } }),
    prisma.moneyAccount.findFirst({ where: { id: b.accountId, isActive: true } }),
  ]);
  if (!category) throw new AppError('Choose an income category', 422);
  if (!account) throw new AppError('Choose the account that received it', 422);
  await notFuture(b.incomeDate, 'The date');
  const schoolId = currentSchoolId();
  const income = await transaction(async (tx) => tx.otherIncome.create({
    data: {
      schoolId, incomeNo: formatNumber('INC', await nextNumber(tx, 'income')), categoryId: category.id, accountId: account.id, amount: b.amount,
      incomeDate: toDate(b.incomeDate), description: b.description, receivedFrom: b.receivedFrom || null, reference: b.reference || null, createdById: me(req).id,
    },
    include: incomeInclude,
  }));
  return sendSuccess(res, { ...income, incomeDate: toIso(income.incomeDate) }, `Income ${income.incomeNo} recorded`, 201);
}));

router.delete('/income/:id', can('finance.manage'), handler(async (req, res) => {
  const income = await prisma.otherIncome.findFirst({ where: { id: req.params.id } });
  if (!income) throw new AppError('Income entry not found', 404);
  await assertCanPay(income.accountId, income.amount, 'removing this income');
  await prisma.otherIncome.delete({ where: { id: income.id } });
  return sendSuccess(res, null, 'Income entry removed');
}));

export default router;
