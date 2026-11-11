import { LeaveType, Prisma } from '@prisma/client';
import prisma from '../config/database';
import { D } from '../modules/fees/fees.calc';

// Shared HR calculations: leave allowances/balances and a person's current pay.
// Payroll (next step) uses the same functions, so screens and payslips always agree.

export const LEAVE_TYPES: LeaveType[] = ['CASUAL', 'SICK', 'ANNUAL', 'UNPAID', 'OTHER'];

/** Used until the school saves its own leave policy. */
const DEFAULT_POLICY: Record<LeaveType, { daysPerYear: number; isPaid: boolean }> = {
  CASUAL: { daysPerYear: 10, isPaid: true },
  SICK: { daysPerYear: 8, isPaid: true },
  ANNUAL: { daysPerYear: 0, isPaid: true },
  UNPAID: { daysPerYear: 0, isPaid: false },
  OTHER: { daysPerYear: 0, isPaid: true },
};

export async function leavePolicy() {
  const rows = await prisma.leavePolicy.findMany();
  return LEAVE_TYPES.map((type) => {
    const saved = rows.find((r) => r.type === type);
    return { type, daysPerYear: saved?.daysPerYear ?? DEFAULT_POLICY[type].daysPerYear, isPaid: saved?.isPaid ?? DEFAULT_POLICY[type].isPaid };
  });
}

const DAY = 86_400_000;
/** Days of [from, to] that fall inside [start, end], inclusive. */
export function daysWithin(from: Date, to: Date, start: Date, end: Date) {
  const a = Math.max(from.getTime(), start.getTime());
  const b = Math.min(to.getTime(), end.getTime());
  return b < a ? 0 : Math.round((b - a) / DAY) + 1;
}

export type LeaveBalance = {
  type: LeaveType; allowed: number; isPaid: boolean;
  used: number; pending: number; remaining: number;
  /** Approved days that are not paid: everything for unpaid types, the excess over the allowance otherwise. */
  unpaid: number;
};

/** Leave balance per staff member for a year (approved and pending days are clipped to the year). */
export async function leaveBalances(staffIds: string[], year: { startDate: Date; endDate: Date }) {
  const [policy, leaves] = await Promise.all([
    leavePolicy(),
    prisma.leaveRequest.findMany({
      where: { staffId: { in: staffIds }, status: { in: ['APPROVED', 'PENDING'] }, fromDate: { lte: year.endDate }, toDate: { gte: year.startDate } },
      select: { staffId: true, type: true, status: true, fromDate: true, toDate: true },
    }),
  ]);
  const out = new Map<string, LeaveBalance[]>();
  for (const staffId of staffIds) {
    const mine = leaves.filter((l) => l.staffId === staffId);
    out.set(staffId, policy.map((p) => {
      const sum = (status: string) => mine.filter((l) => l.type === p.type && l.status === status)
        .reduce((n, l) => n + daysWithin(l.fromDate, l.toDate, year.startDate, year.endDate), 0);
      const used = sum('APPROVED');
      return {
        type: p.type, allowed: p.daysPerYear, isPaid: p.isPaid, used, pending: sum('PENDING'),
        remaining: p.isPaid ? Math.max(0, p.daysPerYear - used) : 0,
        unpaid: p.isPaid ? Math.max(0, used - p.daysPerYear) : used,
      };
    }));
  }
  return out;
}

const structureInclude = { components: { orderBy: [{ kind: 'asc' }, { name: 'asc' }] } } satisfies Prisma.SalaryStructureInclude;
type Structure = Prisma.SalaryStructureGetPayload<{ include: typeof structureInclude }>;

/** A salary structure with its totals: gross = basic + allowances, net = gross − deductions. */
export function presentStructure(s: Structure) {
  const sum = (kind: string) => s.components.filter((c) => c.kind === kind).reduce((t, c) => t.plus(c.amount), D(0));
  const allowances = sum('ALLOWANCE');
  const deductions = sum('DEDUCTION');
  const gross = D(s.basic).plus(allowances);
  return {
    id: s.id, effectiveFrom: s.effectiveFrom.toISOString().slice(0, 10), basic: s.basic, note: s.note, createdAt: s.createdAt,
    components: s.components.map((c) => ({ id: c.id, kind: c.kind, name: c.name, amount: c.amount })),
    allowances, deductions, gross, net: gross.minus(deductions),
  };
}

/** Each person's structure in force on `on` (the latest one that has started), keyed by staff id. */
export async function salariesOn(staffIds: string[], on: Date) {
  const rows = await prisma.salaryStructure.findMany({
    where: { staffId: { in: staffIds }, effectiveFrom: { lte: on } },
    orderBy: { effectiveFrom: 'desc' },
    include: structureInclude,
  });
  const out = new Map<string, ReturnType<typeof presentStructure>>();
  for (const r of rows) if (!out.has(r.staffId)) out.set(r.staffId, presentStructure(r));
  return out;
}

export async function salaryHistory(staffId: string) {
  const rows = await prisma.salaryStructure.findMany({ where: { staffId }, orderBy: { effectiveFrom: 'desc' }, include: structureInclude });
  return rows.map(presentStructure);
}
