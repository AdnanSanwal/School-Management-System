import { Prisma, PaymentMethod } from '@prisma/client';
import prisma, { ScopedTx } from '../config/database';
import { currentSchoolId } from '../config/tenancy';
import { addDays, dayInTimezone, schoolTimezone, schoolToday, toIso, zonedDayStart } from './dates';
import { currentAcademicYear } from './scope';
import { D } from '../modules/fees/fees.calc';

// Money accounts: set-up, which account a payment method lands in, balances and statements.
// An account's balance is always derived from its movements, never stored, so it can't drift:
//   opening + fee payments + other income + deposits/transfers in
//           − approved expenses − withdrawals/transfers out
//           − staff advances/loans given + their repayments in cash

const DEFAULT_ACCOUNTS: { name: string; type: 'CASH' | 'BANK' | 'WALLET'; methods: PaymentMethod[] }[] = [
  { name: 'Cash in hand', type: 'CASH', methods: ['CASH'] },
  { name: 'Bank account', type: 'BANK', methods: ['BANK_TRANSFER', 'CHEQUE', 'CARD', 'ONLINE'] },
  { name: 'Mobile wallets', type: 'WALLET', methods: ['JAZZCASH', 'EASYPAISA'] },
];
const DEFAULT_CATEGORIES: Record<'EXPENSE' | 'INCOME', string[]> = {
  EXPENSE: ['Salaries', 'Rent', 'Utilities', 'Repairs & maintenance', 'Stationery & printing', 'Transport & fuel', 'Events & functions', 'Miscellaneous'],
  INCOME: ['Canteen rent', 'Uniform & books', 'Admission forms', 'Donations', 'Miscellaneous'],
};

const methodsOf = (a: { methods: Prisma.JsonValue }) => (Array.isArray(a.methods) ? (a.methods as string[]) : []);

/**
 * First use in a school: creates the three standard accounts and the usual categories, and
 * files every earlier fee payment under the account for its method. Safe to call often.
 */
export async function ensureFinanceSetup() {
  const schoolId = currentSchoolId();
  if (!(await prisma.moneyAccount.count())) {
    const year = await currentAcademicYear().catch(() => null);
    const first = await prisma.payment.findFirst({ orderBy: { paidAt: 'asc' }, select: { paidAt: true } });
    const tz = await schoolTimezone();
    const today = await schoolToday();
    // Open the books no later than the first recorded payment.
    const candidates = [year?.startDate, first ? new Date(`${dayInTimezone(tz, first.paidAt)}T00:00:00Z`) : null, today].filter(Boolean) as Date[];
    const openingDate = candidates.reduce((a, b) => (b < a ? b : a));
    try {
      await prisma.moneyAccount.createMany({
        // Spaced a second apart so they always list in this order.
        data: DEFAULT_ACCOUNTS.map((a, i) => ({ schoolId, name: a.name, type: a.type, methods: a.methods, openingDate, createdAt: new Date(Date.now() - (DEFAULT_ACCOUNTS.length - i) * 1000) })),
        skipDuplicates: true,
      });
    } catch { /* another request set it up at the same moment */ }
    const accounts = await prisma.moneyAccount.findMany();
    for (const a of accounts) {
      await prisma.payment.updateMany({ where: { accountId: null, method: { in: methodsOf(a) as PaymentMethod[] } }, data: { accountId: a.id } });
    }
  }
  if (!(await prisma.financeCategory.count())) {
    await prisma.financeCategory.createMany({
      data: (['EXPENSE', 'INCOME'] as const).flatMap((kind) => DEFAULT_CATEGORIES[kind].map((name) => ({ schoolId, kind, name }))),
      skipDuplicates: true,
    }).catch(() => {});
  }
}

/** The account a fee payment by this method goes into (null before finance is set up). */
export async function accountForMethod(tx: Pick<ScopedTx, 'moneyAccount'>, method: PaymentMethod): Promise<string | null> {
  const accounts = await tx.moneyAccount.findMany({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });
  return (accounts.find((a) => methodsOf(a).includes(method)) ?? accounts.find((a) => a.type === 'CASH') ?? accounts[0])?.id ?? null;
}

const IN_TYPES = ['DEPOSIT', 'ADJUSTMENT_IN', 'TRANSFER_IN'] as const;

/**
 * Balance of each account. With `before`, the balance at the start of that day (used as a
 * statement's opening balance).
 */
export async function accountBalances(opts: { before?: Date } = {}) {
  const tz = await schoolTimezone();
  const dateLt = opts.before ? { lt: opts.before } : undefined;
  const paidLt = opts.before ? { lt: zonedDayStart(toIso(opts.before), tz) } : undefined;
  const [accounts, fees, incomes, expenses, manual, loans, repaid] = await Promise.all([
    prisma.moneyAccount.findMany({ orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }] }),
    prisma.payment.groupBy({ by: ['accountId'], where: { status: 'SUCCESS', accountId: { not: null }, ...(paidLt ? { paidAt: paidLt } : {}) }, _sum: { amount: true } }),
    prisma.otherIncome.groupBy({ by: ['accountId'], where: dateLt ? { incomeDate: dateLt } : {}, _sum: { amount: true } }),
    prisma.expense.groupBy({ by: ['accountId'], where: { status: 'APPROVED', ...(dateLt ? { expenseDate: dateLt } : {}) }, _sum: { amount: true } }),
    prisma.moneyTransaction.groupBy({ by: ['accountId', 'type'], where: dateLt ? { txDate: dateLt } : {}, _sum: { amount: true } }),
    prisma.staffLoan.groupBy({ by: ['accountId'], where: dateLt ? { issuedOn: dateLt } : {}, _sum: { amount: true } }),
    prisma.loanRepayment.groupBy({ by: ['accountId'], where: { accountId: { not: null }, ...(dateLt ? { paidOn: dateLt } : {}) }, _sum: { amount: true } }),
  ]);
  const of = (rows: { accountId: string | null; _sum: { amount: Prisma.Decimal | null } }[], id: string) => D(rows.find((r) => r.accountId === id)?._sum.amount ?? 0);
  return accounts.map((a) => {
    const moved = manual.filter((m) => m.accountId === a.id)
      .reduce((t, m) => ((IN_TYPES as readonly string[]).includes(m.type) ? t.plus(m._sum.amount ?? 0) : t.minus(m._sum.amount ?? 0)), D(0));
    // Before the opening date the account didn't exist yet.
    const opening = opts.before && opts.before <= a.openingDate ? D(0) : D(a.openingBalance);
    return { ...a, methods: methodsOf(a), balance: opening.plus(of(fees, a.id)).plus(of(incomes, a.id)).minus(of(expenses, a.id)).plus(moved).minus(of(loans, a.id)).plus(of(repaid, a.id)) };
  });
}

export async function accountBalance(accountId: string) {
  return (await accountBalances()).find((a) => a.id === accountId)?.balance ?? D(0);
}

export type Movement = {
  id: string; kind: 'FEE' | 'INCOME' | 'EXPENSE' | 'OPENING' | 'ADVANCE' | 'LOAN_REPAYMENT' | (typeof IN_TYPES)[number] | 'WITHDRAWAL' | 'ADJUSTMENT_OUT' | 'TRANSFER_OUT';
  date: string; accountId: string; description: string; reference: string | null;
  in: Prisma.Decimal; out: Prisma.Decimal;
  /** Where to open the source record in the app. */
  link?: string;
  /** Hand-entered rows can be removed. */
  removable?: boolean;
};

/** Every movement in a date range (one account or all), oldest first: the day book / statement. */
export async function movements(opts: { accountId?: string; from: Date; to: Date }): Promise<Movement[]> {
  const tz = await schoolTimezone();
  const acc = opts.accountId ? { accountId: opts.accountId } : {};
  const range = { gte: opts.from, lte: opts.to };
  const [fees, incomes, expenses, manual, opened, loans, repaid] = await Promise.all([
    prisma.payment.findMany({
      where: { status: 'SUCCESS', ...(opts.accountId ? acc : { accountId: { not: null } }), paidAt: { gte: zonedDayStart(toIso(opts.from), tz), lt: zonedDayStart(toIso(addDays(opts.to, 1)), tz) } },
      select: { id: true, accountId: true, amount: true, paidAt: true, receiptNo: true, reference: true, method: true, student: { select: { name: true } } },
    }),
    prisma.otherIncome.findMany({ where: { ...acc, incomeDate: range }, include: { category: { select: { name: true } } } }),
    prisma.expense.findMany({ where: { ...acc, status: 'APPROVED', expenseDate: range }, include: { category: { select: { name: true } } } }),
    prisma.moneyTransaction.findMany({ where: { ...acc, txDate: range } }),
    prisma.moneyAccount.findMany({ where: { ...(opts.accountId ? { id: opts.accountId } : {}), openingDate: range, openingBalance: { not: 0 } } }),
    prisma.staffLoan.findMany({ where: { ...acc, issuedOn: range }, include: { staff: { select: { name: true } } } }),
    prisma.loanRepayment.findMany({ where: { ...(opts.accountId ? acc : { accountId: { not: null } }), paidOn: range }, include: { loan: { select: { loanNo: true, staff: { select: { name: true } } } } } }),
  ]);
  const Z = D(0);
  const label: Record<string, string> = { DEPOSIT: 'Deposit', WITHDRAWAL: 'Withdrawal', ADJUSTMENT_IN: 'Adjustment (in)', ADJUSTMENT_OUT: 'Adjustment (out)', TRANSFER_IN: 'Transfer in', TRANSFER_OUT: 'Transfer out' };
  const rows: (Movement & { at: number })[] = [
    ...opened.map((a) => ({ id: `open-${a.id}`, kind: 'OPENING' as const, date: toIso(a.openingDate), accountId: a.id, description: 'Opening balance', reference: null, in: D(a.openingBalance), out: Z, at: 0 })),
    ...fees.map((p) => ({
      id: p.id, kind: 'FEE' as const, date: dayInTimezone(tz, p.paidAt), accountId: p.accountId!, description: `Fee — ${p.student.name}`,
      reference: p.reference ? `${p.receiptNo} · ${p.reference}` : p.receiptNo, in: D(p.amount), out: Z, link: `/fees/receipt/${p.id}`, at: p.paidAt.getTime(),
    })),
    ...incomes.map((i) => ({
      id: i.id, kind: 'INCOME' as const, date: toIso(i.incomeDate), accountId: i.accountId,
      description: `${i.category.name} — ${i.description}${i.receivedFrom ? ` (${i.receivedFrom})` : ''}`, reference: i.reference ? `${i.incomeNo} · ${i.reference}` : i.incomeNo, in: D(i.amount), out: Z, at: i.createdAt.getTime(),
    })),
    ...expenses.map((e) => ({
      id: e.id, kind: 'EXPENSE' as const, date: toIso(e.expenseDate), accountId: e.accountId,
      description: `${e.category.name} — ${e.description}${e.paidTo ? ` (${e.paidTo})` : ''}`, reference: e.reference ? `${e.expenseNo} · ${e.reference}` : e.expenseNo, in: Z, out: D(e.amount), at: e.createdAt.getTime(),
    })),
    ...loans.map((l) => ({
      id: l.id, kind: 'ADVANCE' as const, date: toIso(l.issuedOn), accountId: l.accountId,
      description: `${l.kind === 'ADVANCE' ? 'Salary advance' : 'Staff loan'} — ${l.staff.name}`, reference: l.loanNo, in: Z, out: D(l.amount), link: '/payroll/loans', at: l.createdAt.getTime(),
    })),
    ...repaid.map((r) => ({
      id: r.id, kind: 'LOAN_REPAYMENT' as const, date: toIso(r.paidOn), accountId: r.accountId!,
      description: `Advance / loan paid back — ${r.loan.staff.name}`, reference: r.loan.loanNo, in: D(r.amount), out: Z, link: '/payroll/loans', at: r.createdAt.getTime(),
    })),
    ...manual.map((m) => {
      const isIn = (IN_TYPES as readonly string[]).includes(m.type);
      return {
        id: m.id, kind: m.type, date: toIso(m.txDate), accountId: m.accountId, description: m.description ? `${label[m.type]} — ${m.description}` : label[m.type],
        reference: m.reference, in: isIn ? D(m.amount) : Z, out: isIn ? Z : D(m.amount), removable: true, at: m.createdAt.getTime(),
      };
    }),
  ];
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.at - b.at);
  return rows.map(({ at: _at, ...r }) => r);
}

/** Refuses a payment out that the account can't cover. */
export async function assertCanPay(accountId: string, amount: Prisma.Decimal.Value, what: string) {
  const account = (await accountBalances()).find((a) => a.id === accountId);
  if (!account) return;
  if (account.balance.lt(amount)) {
    const { AppError } = await import('../middleware/errorHandler');
    throw new AppError(`${account.name} has only ${account.balance.toFixed(0)}; ${what} needs ${D(amount).toFixed(0)}. Record the deposit or correct the opening balance first.`, 409);
  }
}
