import { Router } from 'express';
import { Prisma, type Role } from '@prisma/client';
import prisma from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { schoolDataVersion, withCache } from '../../utils/cache';
import { authenticate } from '../../middleware/auth';
import { can, hasPermission } from '../../middleware/rbac';
import { sendSuccess } from '../../utils/apiResponse';
import { handler, me } from '../../utils/http';
import { addDays, dayInTimezone, schoolTimezone, schoolToday, toIso, zonedDayStart } from '../../utils/dates';
import { attendanceSummary } from '../../utils/attendanceStats';
import { currentAcademicYear } from '../../utils/scope';
import { D } from '../fees/fees.calc';

// Owner / Principal / Admin / Accountant home screen (spec §5 Owner Dashboard).
// Each block is included only if the viewer's role may see that data.

const router = Router();
router.use(authenticate);

const sum = (rows: { amount: Prisma.Decimal }[]) => rows.reduce((s, r) => s.plus(r.amount), D(0));

async function finance(today: Date, tz: string) {
  const todayIso = toIso(today);
  const yesterdayIso = toIso(addDays(today, -1));
  const monthStartIso = `${todayIso.slice(0, 7)}-01`;
  const year = await currentAcademicYear();

  // Six months of collections, bucketed by the school's local month.
  const sixStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 5, 1));
  const [payments, open, overdue] = await Promise.all([
    prisma.payment.findMany({
      where: { status: 'SUCCESS', paidAt: { gte: zonedDayStart(toIso(sixStart), tz) } },
      select: { amount: true, paidAt: true },
    }),
    prisma.feeInvoice.findMany({
      where: { status: { in: ['UNPAID', 'PARTIAL'] }, student: { status: 'ACTIVE' } },
      select: { netAmount: true, fineAmount: true, paidAmount: true, dueDate: true, student: { select: { section: { select: { class: { select: { id: true, name: true, level: true } } } } } } },
    }),
    prisma.feeInvoice.groupBy({
      by: ['studentId'],
      where: { status: { in: ['UNPAID', 'PARTIAL'] }, dueDate: { lt: addDays(today, -30) }, student: { status: 'ACTIVE' } },
    }),
  ]);
  const local = payments.map((p) => ({ amount: p.amount, day: dayInTimezone(tz, p.paidAt) }));
  const yearPayments = await prisma.payment.aggregate({
    where: { status: 'SUCCESS', paidAt: { gte: zonedDayStart(toIso(year.startDate), tz) } },
    _sum: { amount: true },
  });

  const months: { month: string; amount: Prisma.Decimal }[] = [];
  for (let i = 0; i < 6; i++) {
    const m = toIso(new Date(Date.UTC(sixStart.getUTCFullYear(), sixStart.getUTCMonth() + i, 1))).slice(0, 7);
    months.push({ month: m, amount: sum(local.filter((p) => p.day.startsWith(m))) });
  }

  const pendingByClass = new Map<string, { classId: string; name: string; level: number; pending: Prisma.Decimal }>();
  let remaining = D(0);
  for (const inv of open) {
    const due = D(inv.netAmount).plus(inv.fineAmount).minus(inv.paidAmount);
    remaining = remaining.plus(due);
    const cls = inv.student.section?.class;
    if (!cls) continue;
    const row = pendingByClass.get(cls.id) ?? { classId: cls.id, name: cls.name, level: cls.level, pending: D(0) };
    row.pending = row.pending.plus(due);
    pendingByClass.set(cls.id, row);
  }

  return {
    collectedToday: sum(local.filter((p) => p.day === todayIso)),
    collectedYesterday: sum(local.filter((p) => p.day === yesterdayIso)),
    collectedThisMonth: sum(local.filter((p) => p.day >= monthStartIso)),
    collectedThisYear: yearPayments._sum.amount ?? D(0),
    totalRemaining: remaining,
    studentsOverdue30Days: overdue.length,
    monthlyCollection: months,
    pendingByClass: [...pendingByClass.values()].sort((a, b) => a.level - b.level).map(({ level: _l, ...r }) => r),
  };
}

async function studentAttendance(today: Date) {
  const [active, counts, sections] = await Promise.all([
    prisma.student.count({ where: { status: 'ACTIVE' } }),
    prisma.studentAttendance.groupBy({ by: ['sectionId', 'status'], where: { date: today }, _count: true }),
    prisma.section.findMany({ where: { class: { archivedAt: null } }, select: { id: true, name: true, class: { select: { name: true } } } }),
  ]);
  const markedSections = new Set(counts.map((c) => c.sectionId));
  const lowSections = sections
    .map((s) => ({ name: `${s.class.name}-${s.name}`, ...attendanceSummary(counts.filter((c) => c.sectionId === s.id)) }))
    .filter((s) => s.percent !== null && s.percent < 75)
    .map((s) => ({ name: s.name, percent: s.percent }));
  const all = attendanceSummary(Object.values(counts.reduce<Record<string, { status: string; _count: number }>>((m, c) => {
    m[c.status] = { status: c.status, _count: (m[c.status]?._count ?? 0) + c._count };
    return m;
  }, {})));
  const present = (all as Record<string, number>).PRESENT ?? 0;
  const late = (all as Record<string, number>).LATE ?? 0;
  return {
    totalActive: active,
    marked: all.total,
    present: present + late,
    absent: (all as Record<string, number>).ABSENT ?? 0,
    percent: all.percent,
    sectionsMarked: markedSections.size,
    sectionsTotal: sections.length,
    sectionsNotMarked: sections.filter((s) => !markedSections.has(s.id)).map((s) => `${s.class.name}-${s.name}`),
    lowAttendanceSections: lowSections,
  };
}

async function staffAttendance(today: Date) {
  const [teachers, marks, leaves] = await Promise.all([
    prisma.staff.count({ where: { status: 'ACTIVE', isTeacher: true } }),
    prisma.staffAttendance.findMany({ where: { date: today, staff: { status: 'ACTIVE', isTeacher: true } }, select: { status: true, staff: { select: { name: true } } } }),
    prisma.leaveRequest.findMany({
      where: { status: 'APPROVED', fromDate: { lte: today }, toDate: { gte: today }, staff: { isTeacher: true } },
      select: { staff: { select: { name: true } } },
    }),
  ]);
  const present = marks.filter((m) => m.status === 'PRESENT' || m.status === 'LATE' || m.status === 'HALF_DAY').length;
  const onLeave = new Set([...leaves.map((l) => l.staff.name), ...marks.filter((m) => m.status === 'LEAVE').map((m) => m.staff.name)]);
  return {
    teachersTotal: teachers,
    teachersPresent: present,
    teachersAbsent: marks.filter((m) => m.status === 'ABSENT').map((m) => m.staff.name),
    teachersOnLeave: [...onLeave],
    marked: marks.length > 0,
    percent: teachers ? Math.round((present / teachers) * 1000) / 10 : null,
  };
}

router.get('/overview', can('dashboard.owner', 'dashboard.principal', 'dashboard.admin', 'dashboard.accountant'), handler(async (req, res) => {
  const role = me(req).role;
  // Expensive (all open invoices, six months of payments) and polled every minute by every
  // office screen: cache per school + role for up to 30 s. Any change in the school bumps
  // its data version, so a fee just collected still shows straight away.
  const schoolId = currentSchoolId();
  const key = `dashboard:${schoolId}:${await schoolDataVersion(schoolId)}:${role}`;
  return sendSuccess(res, await withCache(key, 30, () => overview(role as Role)));
}));

async function overview(role: Role) {
  const tz = await schoolTimezone();
  const today = await schoolToday();

  const [fees, students, staff, classes, pending] = await Promise.all([
    hasPermission(role, 'fee.view') ? finance(today, tz) : null,
    hasPermission(role, 'attendance.student.view') ? studentAttendance(today) : null,
    hasPermission(role, 'attendance.staff.view') ? staffAttendance(today) : null,
    hasPermission(role, 'class.view')
      ? prisma.class.findMany({
          where: { archivedAt: null },
          orderBy: { level: 'asc' },
          select: { id: true, name: true, sections: { select: { _count: { select: { students: { where: { status: 'ACTIVE' } } } } } } },
        })
      : null,
    Promise.all([
      hasPermission(role, 'fee.concession.approve') ? prisma.concession.count({ where: { status: 'PENDING' } }) : null,
      hasPermission(role, 'leave.approve') || hasPermission(role, 'leave.view') ? prisma.leaveRequest.count({ where: { status: 'PENDING' } }) : null,
    ]),
  ]);

  // Spec "Quick Alerts" row.
  const alerts: { level: 'warning' | 'info'; message: string }[] = [];
  if (fees?.studentsOverdue30Days) alerts.push({ level: 'warning', message: `${fees.studentsOverdue30Days} students have fee overdue more than 30 days` });
  if (staff?.teachersOnLeave.length) alerts.push({ level: 'info', message: `${staff.teachersOnLeave.length} teacher(s) on leave today` });
  if (students?.lowAttendanceSections.length) alerts.push({ level: 'warning', message: `Low attendance today in ${students.lowAttendanceSections.map((s) => s.name).join(', ')}` });
  if (students && students.sectionsNotMarked.length && students.sectionsMarked > 0) {
    alerts.push({ level: 'info', message: `Attendance not yet marked for ${students.sectionsNotMarked.length} section(s)` });
  }
  if (pending[0]) alerts.push({ level: 'info', message: `${pending[0]} fee concession request(s) waiting for approval` });
  if (pending[1]) alerts.push({ level: 'info', message: `${pending[1]} leave request(s) pending` });

  return {
    date: toIso(today),
    fees,
    studentAttendance: students,
    staffAttendance: staff,
    classStrength: classes?.map((c) => ({ id: c.id, name: c.name, strength: c.sections.reduce((n, s) => n + s._count.students, 0) })) ?? null,
    pendingApprovals: { concessions: pending[0], leaves: pending[1] },
    alerts,
  };
}

export default router;
