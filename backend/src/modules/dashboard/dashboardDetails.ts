import { Router } from 'express';
import { z } from 'zod';
import prisma from '../../config/database';
import { authenticate } from '../../middleware/auth';
import { can, hasPermission, type Permission } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { handler, me } from '../../utils/http';
import { addDays, dayInTimezone, schoolTimezone, schoolToday, toIso, zonedDayStart } from '../../utils/dates';
import { defaulters } from '../fees/fees.service';
import { D, outstanding } from '../fees/fees.calc';
import { onRoll } from '../../utils/staffStatus';

/**
 * CR-01: what's behind each dashboard card, from live data.
 *   GET /dashboard/details/fees-today | outstanding | staff-present | students-present | alerts
 */
const router = Router();
router.use(authenticate, can('dashboard.owner', 'dashboard.principal', 'dashboard.admin', 'dashboard.accountant'));

const KINDS: Record<string, Permission> = {
  'fees-today': 'fee.view',
  outstanding: 'fee.view',
  'staff-present': 'attendance.staff.view',
  'students-present': 'attendance.student.view',
  alerts: 'school.view',
};

const sectionName = (s?: { name: string; class: { name: string } } | null) => (s ? `${s.class.name}-${s.name}` : '—');

router.get('/:kind', handler(async (req, res) => {
  const kind = z.enum(Object.keys(KINDS) as [string, ...string[]]).parse(req.params.kind);
  if (!hasPermission(me(req).role, KINDS[kind])) throw new AppError('Forbidden: insufficient permissions', 403);
  const today = await schoolToday();
  const tz = await schoolTimezone();
  switch (kind) {
    case 'fees-today': return sendSuccess(res, await feesToday(today, tz));
    case 'outstanding': return sendSuccess(res, await outstandingFees());
    case 'staff-present': return sendSuccess(res, await staffToday(today));
    case 'students-present': return sendSuccess(res, await studentsToday(today));
    default: return sendSuccess(res, await alerts(today, me(req).role));
  }
}));

async function feesToday(today: Date, tz: string) {
  const payments = await prisma.payment.findMany({
    where: { status: 'SUCCESS', paidAt: { gte: zonedDayStart(toIso(today), tz), lt: zonedDayStart(toIso(addDays(today, 1)), tz) } },
    orderBy: { paidAt: 'desc' },
    select: {
      id: true, receiptNo: true, amount: true, method: true, reference: true, paidAt: true,
      student: { select: { id: true, name: true, admissionNo: true, section: { select: { name: true, class: { select: { name: true } } } } } },
      allocations: { select: { invoice: { select: { period: true } } } },
    },
  });
  return {
    date: toIso(today),
    total: payments.reduce((s, p) => s.plus(p.amount), D(0)),
    rows: payments.map((p) => ({
      paymentId: p.id, receiptNo: p.receiptNo, time: p.paidAt, date: dayInTimezone(tz, p.paidAt),
      studentId: p.student.id, student: p.student.name, admissionNo: p.student.admissionNo, class: sectionName(p.student.section),
      amount: p.amount, method: p.method, reference: p.reference, months: [...new Set(p.allocations.map((a) => a.invoice.period))],
    })),
  };
}

/** Every student with fee still to pay (due or not yet due), with their balance. */
async function outstandingFees() {
  const invoices = await prisma.feeInvoice.findMany({
    where: { status: { in: ['UNPAID', 'PARTIAL'] }, student: { status: 'ACTIVE' } },
    select: {
      netAmount: true, fineAmount: true, paidAmount: true, dueDate: true, period: true,
      student: {
        select: {
          id: true, name: true, admissionNo: true, section: { select: { name: true, class: { select: { name: true, level: true } } } },
          guardians: { where: { isPrimary: true }, select: { guardian: { select: { name: true, phone: true } } } },
        },
      },
    },
  });
  const by = new Map<string, { s: (typeof invoices)[number]['student']; pending: ReturnType<typeof D>; months: string[]; oldestDue: Date }>();
  for (const inv of invoices) {
    const row = by.get(inv.student.id) ?? { s: inv.student, pending: D(0), months: [], oldestDue: inv.dueDate };
    row.pending = row.pending.plus(outstanding(inv));
    row.months.push(inv.period);
    if (inv.dueDate < row.oldestDue) row.oldestDue = inv.dueDate;
    by.set(inv.student.id, row);
  }
  const rows = [...by.values()]
    .filter((r) => r.pending.gt(0))
    .sort((a, b) => b.pending.comparedTo(a.pending))
    .map((r) => ({
      studentId: r.s.id, student: r.s.name, admissionNo: r.s.admissionNo, class: sectionName(r.s.section),
      guardian: r.s.guardians[0]?.guardian.name ?? null, phone: r.s.guardians[0]?.guardian.phone ?? null,
      months: r.months.sort(), oldestDue: toIso(r.oldestDue), pending: r.pending,
    }));
  return { students: rows.length, total: rows.reduce((s, r) => s.plus(r.pending), D(0)), rows };
}

async function staffToday(today: Date) {
  const [staff, marks, leaves] = await Promise.all([
    prisma.staff.findMany({ where: { status: onRoll, isTeacher: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, employeeNo: true, designation: true, phone: true } }),
    prisma.staffAttendance.findMany({ where: { date: today }, select: { staffId: true, status: true, checkIn: true, checkOut: true, remarks: true } }),
    prisma.leaveRequest.findMany({ where: { status: 'APPROVED', fromDate: { lte: today }, toDate: { gte: today } }, select: { staffId: true, type: true } }),
  ]);
  const mark = new Map(marks.map((m) => [m.staffId, m]));
  const leave = new Map(leaves.map((l) => [l.staffId, l.type]));
  const rows = staff.map((s) => {
    const m = mark.get(s.id);
    return {
      staffId: s.id, name: s.name, employeeNo: s.employeeNo, designation: s.designation, phone: s.phone,
      status: m?.status ?? (leave.has(s.id) ? 'LEAVE' : 'NOT_MARKED'),
      checkIn: m?.checkIn ?? null, checkOut: m?.checkOut ?? null, remarks: m?.remarks ?? (leave.has(s.id) ? `Approved ${leave.get(s.id)!.toLowerCase()} leave` : null),
    };
  });
  const isPresent = (st: string) => st === 'PRESENT' || st === 'LATE' || st === 'HALF_DAY';
  return {
    date: toIso(today),
    counts: { total: rows.length, present: rows.filter((r) => isPresent(r.status)).length, absent: rows.filter((r) => r.status === 'ABSENT').length, leave: rows.filter((r) => r.status === 'LEAVE').length, notMarked: rows.filter((r) => r.status === 'NOT_MARKED').length },
    // Present teachers first, then everyone else, so the card's number is the top of the list.
    rows: [...rows.filter((r) => isPresent(r.status)), ...rows.filter((r) => !isPresent(r.status))],
  };
}

async function studentsToday(today: Date) {
  const marks = await prisma.studentAttendance.findMany({
    where: { date: today, student: { status: 'ACTIVE' }, status: { in: ['PRESENT', 'LATE', 'HALF_DAY'] } },
    select: {
      status: true, remarks: true, updatedAt: true,
      student: { select: { id: true, name: true, admissionNo: true, rollNo: true } },
      section: { select: { name: true, class: { select: { name: true, level: true } } } },
    },
  });
  marks.sort((a, b) => a.section.class.level - b.section.class.level || a.section.name.localeCompare(b.section.name)
    || (Number(a.student.rollNo) || 0) - (Number(b.student.rollNo) || 0) || a.student.name.localeCompare(b.student.name));
  const byClass: Record<string, number> = {};
  for (const m of marks) byClass[sectionName(m.section)] = (byClass[sectionName(m.section)] ?? 0) + 1;
  return {
    date: toIso(today),
    present: marks.length,
    byClass: Object.entries(byClass).map(([section, count]) => ({ section, count })),
    rows: marks.map((m) => ({
      studentId: m.student.id, student: m.student.name, admissionNo: m.student.admissionNo, rollNo: m.student.rollNo,
      class: sectionName(m.section), status: m.status, remarks: m.remarks, markedAt: m.updatedAt,
    })),
  };
}

type AlertGroup = { key: string; level: 'warning' | 'info'; title: string; count: number; items: string[]; link?: string };

/** Every current alert, grouped, with the names behind each (only what this role can act on). */
async function alerts(today: Date, role: string): Promise<{ groups: AlertGroup[] }> {
  const can_ = (p: Permission) => hasPermission(role, p);
  const groups: AlertGroup[] = [];

  if (can_('fee.view')) {
    const overdue = await defaulters({ minDaysOverdue: 30 });
    if (overdue.length) groups.push({
      key: 'overdue', level: 'warning', title: 'Fee overdue more than 30 days', count: overdue.length, link: '/fees/defaulters',
      items: overdue.map((r) => `${r.name} (${r.section ?? '—'}) — ${Number(r.pending).toLocaleString('en-PK')} pending, ${r.daysOverdue} days`),
    });
  }
  if (can_('attendance.student.view')) {
    const [counts, sections] = await Promise.all([
      prisma.studentAttendance.groupBy({ by: ['sectionId', 'status'], where: { date: today }, _count: true }),
      prisma.section.findMany({ where: { class: { archivedAt: null } }, select: { id: true, name: true, class: { select: { name: true, level: true } }, classTeacher: { select: { name: true } }, _count: { select: { students: { where: { status: 'ACTIVE' } } } } } }),
    ]);
    sections.sort((a, b) => a.class.level - b.class.level || a.name.localeCompare(b.name));
    const marked = new Set(counts.map((c) => c.sectionId));
    const notMarked = sections.filter((s) => s._count.students > 0 && !marked.has(s.id));
    if (notMarked.length && marked.size) groups.push({
      key: 'attendance-not-marked', level: 'info', title: 'Attendance not marked today', count: notMarked.length, link: '/attendance/summary',
      items: notMarked.map((s) => `${sectionName(s)}${s.classTeacher ? ` — class teacher ${s.classTeacher.name}` : ' — no class teacher'}`),
    });
    const low = sections.map((s) => {
      const rows = counts.filter((c) => c.sectionId === s.id);
      const total = rows.reduce((n, c) => n + c._count, 0);
      const present = rows.filter((c) => c.status === 'PRESENT' || c.status === 'LATE').reduce((n, c) => n + c._count, 0);
      return { s, total, pct: total ? Math.round((present / total) * 1000) / 10 : null };
    }).filter((x) => x.pct !== null && x.pct < 75);
    if (low.length) groups.push({
      key: 'low-attendance', level: 'warning', title: 'Low attendance today (below 75%)', count: low.length, link: '/attendance/summary',
      items: low.map((x) => `${sectionName(x.s)} — ${x.pct}% present`),
    });
  }
  if (can_('attendance.staff.view')) {
    const staff = await staffToday(today);
    const absent = staff.rows.filter((r) => r.status === 'ABSENT');
    const leave = staff.rows.filter((r) => r.status === 'LEAVE');
    if (absent.length) groups.push({ key: 'teachers-absent', level: 'warning', title: 'Teachers absent today', count: absent.length, link: '/attendance/staff', items: absent.map((r) => r.name) });
    if (leave.length) groups.push({ key: 'teachers-leave', level: 'info', title: 'Teachers on leave today', count: leave.length, link: '/attendance/staff', items: leave.map((r) => `${r.name}${r.remarks ? ` — ${r.remarks}` : ''}`) });
  }
  if (can_('fee.concession.approve')) {
    const rows = await prisma.concession.findMany({ where: { status: 'PENDING' }, select: { type: true, value: true, reason: true, student: { select: { name: true } } } });
    if (rows.length) groups.push({ key: 'concessions', level: 'info', title: 'Concession requests waiting for approval', count: rows.length, link: '/approvals', items: rows.map((c) => `${c.student.name} — ${c.type === 'PERCENT' ? `${Number(c.value)}%` : Number(c.value).toLocaleString('en-PK')} (${c.reason})`) });
  }
  if (can_('leave.approve') || can_('leave.view')) {
    const rows = await prisma.leaveRequest.findMany({ where: { status: 'PENDING' }, select: { fromDate: true, toDate: true, type: true, staff: { select: { name: true } } } });
    if (rows.length) groups.push({ key: 'leave', level: 'info', title: 'Leave requests pending', count: rows.length, link: '/approvals', items: rows.map((l) => `${l.staff.name} — ${l.type.toLowerCase()}, ${toIso(l.fromDate)}${l.toDate.getTime() !== l.fromDate.getTime() ? ` to ${toIso(l.toDate)}` : ''}`) });
  }
  if (can_('fee.collect')) {
    const rows = await prisma.paymentClaim.findMany({ where: { status: 'PENDING' }, select: { amount: true, method: true, reference: true, student: { select: { name: true } } } });
    if (rows.length) groups.push({ key: 'claims', level: 'info', title: 'Online payments waiting for verification', count: rows.length, link: '/approvals', items: rows.map((c) => `${c.student.name} — ${Number(c.amount).toLocaleString('en-PK')} via ${c.method.toLowerCase()} (${c.reference})`) });
  }
  return { groups };
}

export default router;
