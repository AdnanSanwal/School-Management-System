import { LedgerAccount, LedgerAccountType, Prisma } from '@prisma/client';
import prisma from '../config/database';
import { currentSchoolId } from '../config/tenancy';
import { addDays, dayInTimezone, schoolTimezone, toIso, zonedDayStart } from './dates';
import { accountBalances, ensureFinanceSetup } from './finance';
import { D } from '../modules/fees/fees.calc';

// Double-entry ledger, worked out from the records instead of being stored beside them:
//
//   Fee payment             Dr money account        Cr Student fees (income)
//   Other income            Dr money account        Cr its income category
//   Approved expense        Dr its expense category Cr money account      (a paid payroll is one of these)
//   Advance / loan given    Dr Staff advances       Cr money account
//   … recovered from salary Dr Salaries             Cr Staff advances
//   … paid back in cash     Dr money account        Cr Staff advances
//   Owner puts in / takes   Dr/Cr money account     Cr/Dr Owner's account
//   Correction in / out     Dr/Cr money account     Cr/Dr Cash differences
//   Transfer                Dr receiving account    Cr paying account
//   Opening balance         Dr money account        Cr Opening balances
//   Journal entry by hand   as entered
//
// Fees are income when they are received (cash basis); unpaid invoices are not in the books.
// Two readers share these rules: `ledgerBalances` (totals up to a date, by SQL sums) and
// `ledgerEntries` (the entries inside a date range). A test checks that they agree.

export const SYSTEM_ACCOUNTS: { key: string; code: string; name: string; type: LedgerAccountType }[] = [
  { key: 'STAFF_ADVANCES', code: '1300', name: 'Staff advances & loans', type: 'ASSET' },
  { key: 'OPENING_EQUITY', code: '3000', name: 'Opening balances', type: 'EQUITY' },
  { key: 'OWNER', code: '3100', name: 'Owner’s account', type: 'EQUITY' },
  { key: 'FEE_INCOME', code: '4000', name: 'Student fees', type: 'INCOME' },
  { key: 'ADJUSTMENT_GAIN', code: '4900', name: 'Cash differences (over)', type: 'INCOME' },
  { key: 'ADJUSTMENT_LOSS', code: '5900', name: 'Cash differences (short)', type: 'EXPENSE' },
];
/** Where automatic and hand-made accounts start numbering, by type. */
const FIRST_CODE = { MONEY: 1010, INCOME_CATEGORY: 4110, EXPENSE_CATEGORY: 5010 };
export const CUSTOM_FIRST_CODE: Record<LedgerAccountType, number> = { ASSET: 1510, LIABILITY: 2010, EQUITY: 3210, INCOME: 4510, EXPENSE: 5510 };

export function nextCode(used: Set<string>, from: number) {
  let n = from;
  while (used.has(String(n))) n += 10;
  used.add(String(n));
  return String(n);
}

/**
 * Makes sure the chart of accounts has the built-in accounts and one account for every
 * money account and expense / income category, named like its source. Returns the chart.
 */
export async function ensureLedgerSetup(): Promise<LedgerAccount[]> {
  await ensureFinanceSetup();
  const schoolId = currentSchoolId();
  const [accounts, money, categories] = await Promise.all([
    prisma.ledgerAccount.findMany(),
    prisma.moneyAccount.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.financeCategory.findMany({ orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }, { name: 'asc' }] }),
  ]);
  const used = new Set(accounts.map((a) => a.code));
  const create: Prisma.LedgerAccountCreateManyInput[] = [];
  for (const s of SYSTEM_ACCOUNTS) {
    if (!accounts.some((a) => a.systemKey === s.key)) create.push({ schoolId, code: used.has(s.code) ? nextCode(used, Number(s.code)) : (used.add(s.code), s.code), name: s.name, type: s.type, systemKey: s.key });
  }
  for (const m of money) {
    if (!accounts.some((a) => a.moneyAccountId === m.id)) create.push({ schoolId, code: nextCode(used, FIRST_CODE.MONEY), name: m.name, type: 'ASSET', moneyAccountId: m.id });
  }
  for (const c of categories) {
    if (!accounts.some((a) => a.categoryId === c.id)) {
      create.push({ schoolId, code: nextCode(used, c.kind === 'INCOME' ? FIRST_CODE.INCOME_CATEGORY : FIRST_CODE.EXPENSE_CATEGORY), name: c.name, type: c.kind === 'INCOME' ? 'INCOME' : 'EXPENSE', categoryId: c.id });
    }
  }
  // Follow renames and closures of the source.
  const stale = accounts.flatMap((a) => {
    const src = a.moneyAccountId ? money.find((m) => m.id === a.moneyAccountId) : a.categoryId ? categories.find((c) => c.id === a.categoryId) : null;
    return src && (src.name !== a.name || src.isActive !== a.isActive) ? [{ id: a.id, name: src.name, isActive: src.isActive }] : [];
  });
  if (!create.length && !stale.length) return accounts;
  try {
    if (create.length) await prisma.ledgerAccount.createMany({ data: create, skipDuplicates: true });
    for (const s of stale) await prisma.ledgerAccount.update({ where: { id: s.id }, data: { name: s.name, isActive: s.isActive } });
  } catch { /* another request did the same a moment ago */ }
  return prisma.ledgerAccount.findMany();
}

export const sortChart = <T extends { code: string }>(rows: T[]) => [...rows].sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));

function finder(chart: LedgerAccount[]) {
  const sys = (key: string) => chart.find((a) => a.systemKey === key)!.id;
  const money = (id: string) => chart.find((a) => a.moneyAccountId === id)!.id;
  const category = (id: string) => chart.find((a) => a.categoryId === id)!.id;
  return { sys, money, category };
}

/** The expense account salaries go to, per payroll run (the category its expense was filed under). */
async function salaryAccounts(chart: LedgerAccount[]) {
  const f = finder(chart);
  const [paid, named] = await Promise.all([
    prisma.expense.findMany({ where: { payrollRunId: { not: null } }, select: { payrollRunId: true, categoryId: true } }),
    prisma.financeCategory.findFirst({ where: { kind: 'EXPENSE', name: 'Salaries' }, select: { id: true } }),
  ]);
  const fallback = named ? f.category(named.id) : paid[0] ? f.category(paid[0].categoryId) : f.sys('ADJUSTMENT_LOSS');
  const byRun = new Map(paid.map((p) => [p.payrollRunId!, f.category(p.categoryId)]));
  return (runId: string) => byRun.get(runId) ?? fallback;
}

/** Balance of every account (debit positive) from the start up to, but not including, `before`. */
export async function ledgerBalances(chart: LedgerAccount[], before?: Date) {
  const f = finder(chart);
  const tz = await schoolTimezone();
  const lt = before ? { lt: before } : undefined;
  const paidLt = before ? { lt: zonedDayStart(toIso(before), tz) } : undefined;
  const sumBy = <K extends string>(rows: ({ _sum: { amount: Prisma.Decimal | null } } & Record<K, string | null>)[], key: K) =>
    rows.map((r) => [r[key] as string, D(r._sum.amount ?? 0)] as const);

  const [money, fees, incomes, expenses, manual, loans, repaid, recovered, journals, salaryOf] = await Promise.all([
    accountBalances({ before }),
    prisma.payment.aggregate({ where: { status: 'SUCCESS', accountId: { not: null }, ...(paidLt ? { paidAt: paidLt } : {}) }, _sum: { amount: true } }),
    prisma.otherIncome.groupBy({ by: ['categoryId'], where: lt ? { incomeDate: lt } : {}, _sum: { amount: true } }),
    prisma.expense.groupBy({ by: ['categoryId'], where: { status: 'APPROVED', ...(lt ? { expenseDate: lt } : {}) }, _sum: { amount: true } }),
    prisma.moneyTransaction.groupBy({ by: ['type'], where: lt ? { txDate: lt } : {}, _sum: { amount: true } }),
    prisma.staffLoan.aggregate({ where: lt ? { issuedOn: lt } : {}, _sum: { amount: true } }),
    prisma.loanRepayment.aggregate({ where: lt ? { paidOn: lt } : {}, _sum: { amount: true } }),
    prisma.loanRepayment.findMany({ where: { payrollLineId: { not: null }, ...(lt ? { paidOn: lt } : {}) }, select: { amount: true, payrollLine: { select: { runId: true } } } }),
    prisma.journalLine.groupBy({ by: ['accountId'], where: { moneyAccountId: null, ...(lt ? { date: lt } : {}) }, _sum: { debit: true, credit: true } }),
    salaryAccounts(chart),
  ]);

  const out = new Map<string, Prisma.Decimal>(chart.map((a) => [a.id, D(0)]));
  const add = (id: string, amount: Prisma.Decimal.Value) => out.set(id, (out.get(id) ?? D(0)).plus(amount));
  const tx = (type: string) => D(manual.find((m) => m.type === type)?._sum.amount ?? 0);

  for (const m of money) {
    add(f.money(m.id), m.balance); // already includes every movement, journal lines too
    const opening = before && before <= m.openingDate ? D(0) : D(m.openingBalance);
    add(f.sys('OPENING_EQUITY'), opening.neg());
  }
  add(f.sys('FEE_INCOME'), D(fees._sum.amount ?? 0).neg());
  for (const [cat, amount] of sumBy(incomes, 'categoryId')) add(f.category(cat), amount.neg());
  for (const [cat, amount] of sumBy(expenses, 'categoryId')) add(f.category(cat), amount);
  add(f.sys('OWNER'), tx('WITHDRAWAL').minus(tx('DEPOSIT')));
  add(f.sys('ADJUSTMENT_GAIN'), tx('ADJUSTMENT_IN').neg());
  add(f.sys('ADJUSTMENT_LOSS'), tx('ADJUSTMENT_OUT'));
  add(f.sys('STAFF_ADVANCES'), D(loans._sum.amount ?? 0).minus(repaid._sum.amount ?? 0));
  for (const r of recovered) add(salaryOf(r.payrollLine!.runId), r.amount);
  for (const j of journals) add(j.accountId, D(j._sum.debit ?? 0).minus(j._sum.credit ?? 0));
  return out;
}

export type LedgerLine = { accountId: string; debit: Prisma.Decimal; credit: Prisma.Decimal };
export type LedgerEntry = {
  id: string; kind: 'OPENING' | 'FEES' | 'INCOME' | 'EXPENSE' | 'OWNER' | 'ADJUSTMENT' | 'TRANSFER' | 'ADVANCE' | 'RECOVERY' | 'REPAYMENT' | 'JOURNAL';
  date: string; reference: string | null; description: string; lines: LedgerLine[];
  /** Hand-made entries can be removed here; the rest are changed at their source. */
  manual?: boolean;
};

/** Every entry dated inside [from, to], oldest first. */
export async function ledgerEntries(chart: LedgerAccount[], from: Date, to: Date): Promise<LedgerEntry[]> {
  const f = finder(chart);
  const tz = await schoolTimezone();
  const range = { gte: from, lte: to };
  const Z = D(0);
  const dr = (accountId: string, amount: Prisma.Decimal.Value): LedgerLine => ({ accountId, debit: D(amount), credit: Z });
  const cr = (accountId: string, amount: Prisma.Decimal.Value): LedgerLine => ({ accountId, debit: Z, credit: D(amount) });

  const [opened, fees, incomes, expenses, manual, loans, repaid, journals, salaryOf] = await Promise.all([
    prisma.moneyAccount.findMany({ where: { openingDate: range, openingBalance: { not: 0 } } }),
    prisma.payment.findMany({
      where: { status: 'SUCCESS', accountId: { not: null }, paidAt: { gte: zonedDayStart(toIso(from), tz), lt: zonedDayStart(toIso(addDays(to, 1)), tz) } },
      select: { accountId: true, amount: true, paidAt: true },
    }),
    prisma.otherIncome.findMany({ where: { incomeDate: range } }),
    prisma.expense.findMany({ where: { status: 'APPROVED', expenseDate: range } }),
    prisma.moneyTransaction.findMany({ where: { txDate: range } }),
    prisma.staffLoan.findMany({ where: { issuedOn: range }, include: { staff: { select: { name: true } } } }),
    prisma.loanRepayment.findMany({ where: { paidOn: range }, include: { loan: { select: { loanNo: true, staff: { select: { name: true } } } }, payrollLine: { select: { runId: true } } } }),
    prisma.journalEntry.findMany({ where: { date: range }, include: { lines: true } }),
    salaryAccounts(chart),
  ]);

  const rows: (LedgerEntry & { at: number })[] = [];
  for (const a of opened) {
    rows.push({ id: `open-${a.id}`, kind: 'OPENING', date: toIso(a.openingDate), at: 0, reference: null, description: `Opening balance — ${a.name}`, lines: [dr(f.money(a.id), a.openingBalance), cr(f.sys('OPENING_EQUITY'), a.openingBalance)] });
  }
  // One entry per day and account for fee collections, so a busy day stays readable.
  const perDay = new Map<string, { date: string; accountId: string; amount: Prisma.Decimal; count: number }>();
  for (const p of fees) {
    const date = dayInTimezone(tz, p.paidAt);
    const key = `${date}|${p.accountId}`;
    const g = perDay.get(key) ?? { date, accountId: p.accountId!, amount: Z, count: 0 };
    perDay.set(key, { ...g, amount: g.amount.plus(p.amount), count: g.count + 1 });
  }
  for (const [key, g] of perDay) {
    rows.push({ id: `fees-${key}`, kind: 'FEES', date: g.date, at: 1, reference: null, description: `Fee collections — ${g.count} receipt${g.count === 1 ? '' : 's'}`, lines: [dr(f.money(g.accountId), g.amount), cr(f.sys('FEE_INCOME'), g.amount)] });
  }
  for (const i of incomes) {
    rows.push({ id: i.id, kind: 'INCOME', date: toIso(i.incomeDate), at: i.createdAt.getTime(), reference: i.incomeNo, description: `${i.description}${i.receivedFrom ? ` (${i.receivedFrom})` : ''}`, lines: [dr(f.money(i.accountId), i.amount), cr(f.category(i.categoryId), i.amount)] });
  }
  for (const e of expenses) {
    rows.push({ id: e.id, kind: 'EXPENSE', date: toIso(e.expenseDate), at: e.createdAt.getTime(), reference: e.expenseNo, description: `${e.description}${e.paidTo ? ` (${e.paidTo})` : ''}`, lines: [dr(f.category(e.categoryId), e.amount), cr(f.money(e.accountId), e.amount)] });
  }
  for (const m of manual) {
    const acc = f.money(m.accountId);
    const base = { id: m.id, date: toIso(m.txDate), at: m.createdAt.getTime(), reference: m.reference };
    if (m.type === 'DEPOSIT') rows.push({ ...base, kind: 'OWNER', description: `Money put in — ${m.description ?? ''}`, lines: [dr(acc, m.amount), cr(f.sys('OWNER'), m.amount)] });
    else if (m.type === 'WITHDRAWAL') rows.push({ ...base, kind: 'OWNER', description: `Money taken out — ${m.description ?? ''}`, lines: [dr(f.sys('OWNER'), m.amount), cr(acc, m.amount)] });
    else if (m.type === 'ADJUSTMENT_IN') rows.push({ ...base, kind: 'ADJUSTMENT', description: `Correction — ${m.description ?? ''}`, lines: [dr(acc, m.amount), cr(f.sys('ADJUSTMENT_GAIN'), m.amount)] });
    else if (m.type === 'ADJUSTMENT_OUT') rows.push({ ...base, kind: 'ADJUSTMENT', description: `Correction — ${m.description ?? ''}`, lines: [dr(f.sys('ADJUSTMENT_LOSS'), m.amount), cr(acc, m.amount)] });
    else if (m.type === 'TRANSFER_IN') {
      const other = manual.find((x) => x.transferId === m.transferId && x.type === 'TRANSFER_OUT');
      if (other) rows.push({ ...base, kind: 'TRANSFER', description: 'Transfer between accounts', lines: [dr(acc, m.amount), cr(f.money(other.accountId), m.amount)] });
    }
  }
  for (const l of loans) {
    rows.push({ id: l.id, kind: 'ADVANCE', date: toIso(l.issuedOn), at: l.createdAt.getTime(), reference: l.loanNo, description: `${l.kind === 'ADVANCE' ? 'Salary advance' : 'Staff loan'} — ${l.staff.name}`, lines: [dr(f.sys('STAFF_ADVANCES'), l.amount), cr(f.money(l.accountId), l.amount)] });
  }
  for (const r of repaid) {
    const base = { id: r.id, date: toIso(r.paidOn), at: r.createdAt.getTime(), reference: r.loan.loanNo };
    if (r.payrollLine) rows.push({ ...base, kind: 'RECOVERY', description: `Recovered from salary — ${r.loan.staff.name}`, lines: [dr(salaryOf(r.payrollLine.runId), r.amount), cr(f.sys('STAFF_ADVANCES'), r.amount)] });
    else if (r.accountId) rows.push({ ...base, kind: 'REPAYMENT', description: `Advance / loan paid back — ${r.loan.staff.name}`, lines: [dr(f.money(r.accountId), r.amount), cr(f.sys('STAFF_ADVANCES'), r.amount)] });
  }
  for (const j of journals) {
    rows.push({
      id: j.id, kind: 'JOURNAL', date: toIso(j.date), at: j.createdAt.getTime(), reference: j.reference ? `${j.entryNo} · ${j.reference}` : j.entryNo, description: j.description, manual: true,
      lines: j.lines.map((l) => ({ accountId: l.accountId, debit: D(l.debit), credit: D(l.credit) })).sort((a, b) => Number(b.debit.gt(0)) - Number(a.debit.gt(0))),
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.at - b.at);
  return rows.map(({ at: _at, ...r }) => r);
}

/** Debit-positive balance shown the natural way round for its type. */
export const natural = (type: LedgerAccountType, balance: Prisma.Decimal) => (balance.isZero() ? D(0) : type === 'ASSET' || type === 'EXPENSE' ? balance : balance.neg());
