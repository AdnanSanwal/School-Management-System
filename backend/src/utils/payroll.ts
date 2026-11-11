import { Prisma } from '@prisma/client';
import prisma, { ScopedTx } from '../config/database';
import { currentSchoolId } from '../config/tenancy';
import { addDays, periodRange, toIso } from './dates';
import { daysWithin, leavePolicy, salariesOn } from './hr';
import { D } from '../modules/fees/fees.calc';

// Payroll calculation. One line per person for a month:
//   gross            = basic + allowances                         (from the salary structure)
//   one day's pay    = gross ÷ days in the month
//   absence deduction = one day's pay × days deducted
//   days deducted    = absent days (staff attendance; half day = ½)
//                    + unpaid leave days (unpaid types, or paid leave beyond the yearly allowance)
//                    + days before joining / after leaving
//   net              = gross + bonus − fixed deductions − absence − advance/loan − other
// The accountant can change the days deducted, the loan recovery, bonus and other deduction
// before the run goes to the owner.

type Part = { name: string; amount: number };
const DAY = 86_400_000;
const half = (n: number) => Math.round(n * 2) / 2;

export const monthLabel = (period: string) =>
  new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${period}-01T00:00:00Z`));

/** Totals of a line from its parts. The loan recovery is capped at what is left to pay. */
export function lineTotals(l: {
  gross: Prisma.Decimal.Value; daysInMonth: number; deductDays: Prisma.Decimal.Value; fixedDeductions: Part[];
  loanDeduction: Prisma.Decimal.Value; bonus: Prisma.Decimal.Value; otherDeduction: Prisma.Decimal.Value;
}, capLoan = false) {
  const gross = D(l.gross);
  const absenceDeduction = gross.times(l.deductDays).div(l.daysInMonth).toDecimalPlaces(2);
  const fixed = l.fixedDeductions.reduce((t, c) => t.plus(c.amount), D(0));
  const before = gross.plus(l.bonus).minus(fixed).minus(absenceDeduction).minus(l.otherDeduction);
  let loanDeduction = D(l.loanDeduction);
  if (capLoan && loanDeduction.gt(before)) loanDeduction = before.lt(0) ? D(0) : before;
  const totalDeductions = fixed.plus(absenceDeduction).plus(loanDeduction).plus(l.otherDeduction);
  return { absenceDeduction, loanDeduction, totalDeductions, net: gross.plus(l.bonus).minus(totalDeductions) };
}

/** What is still owed on each active loan. */
export async function outstandingLoans(tx: Pick<ScopedTx, 'staffLoan'>, staffIds?: string[]) {
  const loans = await tx.staffLoan.findMany({
    where: { status: 'ACTIVE', ...(staffIds ? { staffId: { in: staffIds } } : {}) },
    include: { repayments: { select: { amount: true } } },
    orderBy: [{ issuedOn: 'asc' }, { createdAt: 'asc' }],
  });
  return loans.map(({ repayments, ...l }) => ({ ...l, outstanding: repayments.reduce((t, r) => t.minus(r.amount), D(l.amount)) }));
}

/**
 * Builds (or rebuilds) the lines of a draft run. Figures the accountant typed in are kept:
 * bonus, other deduction, remarks, and the days / loan recovery where they overrode them.
 * Returns the active staff who were left out because they have no salary set.
 */
export async function buildLines(tx: ScopedTx, run: { id: string; period: string }) {
  const schoolId = currentSchoolId();
  const { start, end } = periodRange(run.period);
  const daysInMonth = end.getUTCDate();

  const staff = await tx.staff.findMany({
    where: {
      OR: [{ status: 'ACTIVE' }, { leftOn: { gte: start } }],
      AND: [{ OR: [{ joiningDate: null }, { joiningDate: { lte: end } }] }],
    },
    orderBy: { name: 'asc' },
  });
  const ids = staff.map((s) => s.id);
  const year = await tx.academicYear.findFirst({ where: { startDate: { lte: end }, endDate: { gte: start } }, orderBy: { startDate: 'desc' } });
  const yearStart = year?.startDate ?? start;
  const [salaries, policy, marks, leaves, loans, existing] = await Promise.all([
    salariesOn(ids, end),
    leavePolicy(),
    tx.staffAttendance.findMany({ where: { staffId: { in: ids }, date: { gte: start, lte: end }, status: { in: ['ABSENT', 'HALF_DAY'] } }, select: { staffId: true, date: true, status: true } }),
    tx.leaveRequest.findMany({ where: { staffId: { in: ids }, status: 'APPROVED', fromDate: { lte: end }, toDate: { gte: yearStart } }, select: { staffId: true, type: true, fromDate: true, toDate: true } }),
    outstandingLoans(tx, ids),
    tx.payrollLine.findMany({ where: { runId: run.id } }),
  ]);

  const missing: { id: string; name: string; employeeNo: string }[] = [];
  const keep: string[] = [];
  for (const s of staff) {
    const pay = salaries.get(s.id);
    if (!pay) { missing.push({ id: s.id, name: s.name, employeeNo: s.employeeNo }); continue; }
    const mine = leaves.filter((l) => l.staffId === s.id);

    // Employed for only part of the month?
    const from = s.joiningDate && s.joiningDate > start ? s.joiningDate : start;
    const to = s.leftOn && s.leftOn < end ? s.leftOn : end;
    const notEmployedDays = to < from ? daysInMonth : daysInMonth - (Math.round((to.getTime() - from.getTime()) / DAY) + 1);

    // Unpaid leave that falls in this month.
    let unpaidLeaveDays = 0;
    for (const p of policy) {
      const of = mine.filter((l) => l.type === p.type);
      const within = (a: Date, b: Date) => (b < a ? 0 : of.reduce((n, l) => n + daysWithin(l.fromDate, l.toDate, a, b), 0));
      if (!p.isPaid) unpaidLeaveDays += within(start, end);
      else {
        // Paid leave is unpaid once the year's allowance is used up.
        const usedBefore = within(yearStart, addDays(start, -1));
        const usedNow = within(yearStart, end);
        unpaidLeaveDays += Math.max(0, usedNow - p.daysPerYear) - Math.max(0, usedBefore - p.daysPerYear);
      }
    }

    // Absences from staff attendance; a day on approved leave is leave, not absence.
    const onLeave = (d: Date) => mine.some((l) => l.fromDate <= d && l.toDate >= d);
    const absentDays = marks.filter((m) => m.staffId === s.id && m.date >= from && m.date <= to && !onLeave(m.date))
      .reduce((n, m) => n + (m.status === 'ABSENT' ? 1 : 0.5), 0);

    const old = existing.find((l) => l.staffId === s.id);
    const auto = Math.min(daysInMonth, half(absentDays + unpaidLeaveDays + notEmployedDays));
    const deductDays = old?.deductDaysManual ? Number(old.deductDays) : auto;
    const due = loans.filter((l) => l.staffId === s.id && l.startPeriod <= run.period)
      .reduce((t, l) => t.plus(Prisma.Decimal.min(l.installment, l.outstanding)), D(0));
    const allowances: Part[] = pay.components.filter((c) => c.kind === 'ALLOWANCE').map((c) => ({ name: c.name, amount: Number(c.amount) }));
    const fixedDeductions: Part[] = pay.components.filter((c) => c.kind === 'DEDUCTION').map((c) => ({ name: c.name, amount: Number(c.amount) }));
    const base = {
      gross: pay.gross, daysInMonth, deductDays, fixedDeductions,
      loanDeduction: old?.loanManual ? old.loanDeduction : due, bonus: old?.bonus ?? 0, otherDeduction: old?.otherDeduction ?? 0,
    };
    const t = lineTotals(base, !old?.loanManual);
    const data = {
      name: s.name, employeeNo: s.employeeNo, designation: s.designation, department: s.department,
      bankName: s.bankName, bankAccountTitle: s.bankAccountTitle, bankAccountNo: s.bankAccountNo,
      basic: pay.basic, allowances, fixedDeductions, gross: pay.gross, daysInMonth,
      absentDays, unpaidLeaveDays, notEmployedDays: Math.max(0, notEmployedDays), deductDays,
      absenceDeduction: t.absenceDeduction, loanDeduction: t.loanDeduction, totalDeductions: t.totalDeductions, net: t.net,
    };
    if (old) await tx.payrollLine.update({ where: { id: old.id }, data });
    else await tx.payrollLine.create({ data: { ...data, schoolId, runId: run.id, staffId: s.id } });
    keep.push(s.id);
  }
  await tx.payrollLine.deleteMany({ where: { runId: run.id, staffId: { notIn: keep } } });
  return missing;
}

export function runTotals(lines: { gross: Prisma.Decimal; bonus: Prisma.Decimal; totalDeductions: Prisma.Decimal; absenceDeduction: Prisma.Decimal; loanDeduction: Prisma.Decimal; net: Prisma.Decimal }[]) {
  const sum = (k: 'gross' | 'bonus' | 'totalDeductions' | 'absenceDeduction' | 'loanDeduction' | 'net') => lines.reduce((t, l) => t.plus(l[k]), D(0));
  return { staff: lines.length, gross: sum('gross'), bonus: sum('bonus'), deductions: sum('totalDeductions'), absence: sum('absenceDeduction'), loans: sum('loanDeduction'), net: sum('net') };
}

export { toIso };
