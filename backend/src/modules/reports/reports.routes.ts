import { Router } from 'express';
import { sendSuccess } from '../../utils/apiResponse';
import { z } from 'zod';
import prisma from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { authenticate } from '../../middleware/auth';
import { can, hasPermission, Permission } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';
import { handler, dateOnly, period, id, me } from '../../utils/http';
import { addDays, dayInTimezone, periodRange, schoolTimezone, schoolToday, toDate, toIso, zonedDayStart } from '../../utils/dates';
import { assertSectionAccess, currentAcademicYear, isSchoolWide } from '../../utils/scope';
import { attendanceSummary, countStatuses } from '../../utils/attendanceStats';
import { TableReport, toPdf, toXlsx } from '../../utils/tableReport';
import { D, outstanding } from '../fees/fees.calc';
import { defaulters } from '../fees/fees.service';
import { leaveDays } from '../leave/leave.routes';
import type { JwtPayload } from '../../utils/jwt';

// Spec §13 Reports & Analytics — every report downloads as PDF or Excel:
//   GET /reports/:type?format=pdf|xlsx&…params

const router = Router();
router.use(authenticate);

type Ctx = { user: JwtPayload; q: Record<string, unknown>; school: { name: string; currency: string } };
type Builder = { perms: Permission[]; schoolWideOnly?: boolean; params: z.ZodTypeAny; build: (ctx: Ctx) => Promise<Omit<TableReport, 'school' | 'currency'>> };

const fmtDate = (iso: string) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(toDate(iso));

const REPORTS: Record<string, Builder> = {
  // Daily / date-range fee collection (Owner, Principal, Accountant)
  'fee-collection': {
    perms: ['reports.finance'], schoolWideOnly: true,
    params: z.object({ from: dateOnly.optional(), to: dateOnly.optional(), classId: id.optional(), studentId: id.optional() }),
    async build({ q }) {
      const today = toIso(await schoolToday());
      const from = (q.from as string) ?? today;
      const to = (q.to as string) ?? from;
      const tz = await schoolTimezone();
      const payments = await prisma.payment.findMany({
        where: {
          status: 'SUCCESS', paidAt: { gte: zonedDayStart(from, tz), lt: zonedDayStart(toIso(addDays(toDate(to), 1)), tz) },
          ...(q.studentId ? { studentId: q.studentId as string } : {}),
          ...(q.classId ? { student: { section: { classId: q.classId as string } } } : {}),
        },
        orderBy: { paidAt: 'asc' },
        include: { student: { select: { name: true, admissionNo: true, section: { select: { name: true, class: { select: { name: true } } } } } } },
      });
      const total = payments.reduce((s, p) => s.plus(p.amount), D(0));
      const byMethod = payments.reduce<Record<string, number>>((m, p) => ({ ...m, [p.method]: (m[p.method] ?? 0) + Number(p.amount) }), {});
      return {
        title: 'Fee collection',
        subtitle: from === to ? fmtDate(from) : `${fmtDate(from)} – ${fmtDate(to)}`,
        columns: [
          { key: 'date', label: 'Date', width: 1.3 }, { key: 'receipt', label: 'Receipt', width: 1.1 },
          { key: 'student', label: 'Student', width: 2.2 }, { key: 'adm', label: 'Adm. no.', width: 1 }, { key: 'class', label: 'Class', width: 1 },
          { key: 'method', label: 'Method', width: 1.1 }, { key: 'reference', label: 'Reference', width: 1.3 }, { key: 'amount', label: 'Amount', type: 'money', width: 1.2 },
        ],
        rows: payments.map((p) => ({
          date: dayInTimezone(tz, p.paidAt), receipt: p.receiptNo, student: p.student.name, adm: p.student.admissionNo,
          class: p.student.section ? `${p.student.section.class.name}-${p.student.section.name}` : '', method: p.method.replace('_', ' ').toLowerCase(),
          reference: p.reference ?? '', amount: Number(p.amount),
        })),
        totals: { date: 'Total', receipt: `${payments.length} receipts`, amount: Number(total) },
        notes: [Object.entries(byMethod).map(([m, a]) => `${m.replace('_', ' ').toLowerCase()}: ${a.toLocaleString('en-PK')}`).join(' · ')],
      };
    },
  },

  // Month-by-month billed vs received for the academic year
  'fee-monthly-summary': {
    perms: ['reports.finance'], schoolWideOnly: true,
    params: z.object({ classId: id.optional(), studentId: id.optional() }),
    async build({ q }) {
      const year = await currentAcademicYear();
      const tz = await schoolTimezone();
      const who = {
        ...(q.studentId ? { studentId: q.studentId as string } : {}),
        ...(q.classId ? { student: { section: { classId: q.classId as string } } } : {}),
      };
      const [invoices, payments] = await Promise.all([
        prisma.feeInvoice.findMany({ where: { academicYearId: year.id, status: { not: 'CANCELLED' }, ...who }, select: { period: true, netAmount: true, fineAmount: true, paidAmount: true, status: true } }),
        prisma.payment.findMany({ where: { status: 'SUCCESS', paidAt: { gte: zonedDayStart(toIso(year.startDate), tz) }, ...who }, select: { amount: true, paidAt: true } }),
      ]);
      const months: string[] = [];
      for (let d = new Date(year.startDate); d <= year.endDate; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) months.push(toIso(d).slice(0, 7));
      const rows = months.map((m) => {
        const inv = invoices.filter((i) => i.period === m);
        const billed = inv.reduce((s, i) => s + Number(i.netAmount) + Number(i.fineAmount), 0);
        const pending = inv.reduce((s, i) => s + (i.status === 'PAID' ? 0 : Number(outstanding(i))), 0);
        const received = payments.filter((p) => dayInTimezone(tz, p.paidAt).startsWith(m)).reduce((s, p) => s + Number(p.amount), 0);
        return { month: new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(toDate(`${m}-01`)), invoices: inv.length, billed, received, pending, rate: billed ? ((billed - pending) / billed) * 100 : null };
      }).filter((r) => r.invoices || r.received);
      const sum = (k: 'billed' | 'received' | 'pending' | 'invoices') => rows.reduce((s, r) => s + r[k], 0);
      return {
        title: 'Monthly fee summary', subtitle: `Academic year ${year.name}`,
        columns: [
          { key: 'month', label: 'Month', width: 2 }, { key: 'invoices', label: 'Invoices', type: 'number' },
          { key: 'billed', label: 'Billed', type: 'money', width: 1.4 }, { key: 'received', label: 'Received in month', type: 'money', width: 1.4 },
          { key: 'pending', label: 'Still pending', type: 'money', width: 1.4 }, { key: 'rate', label: 'Collected %', type: 'percent' },
        ],
        rows,
        totals: { month: 'Total', invoices: sum('invoices'), billed: sum('billed'), received: sum('received'), pending: sum('pending'), rate: sum('billed') ? ((sum('billed') - sum('pending')) / sum('billed')) * 100 : null },
        notes: ['"Billed" includes late fees. "Received in month" counts payments made that month for any period.'],
      };
    },
  },

  defaulters: {
    perms: ['reports.finance', 'fee.view'], schoolWideOnly: true,
    params: z.object({ classId: id.optional(), studentId: id.optional(), minDaysOverdue: z.coerce.number().int().min(0).max(365).default(0) }),
    async build({ q }) {
      const rows = (await defaulters({ classId: q.classId as string | undefined, minDaysOverdue: q.minDaysOverdue as number }))
        .filter((r) => !q.studentId || r.studentId === q.studentId);
      return {
        title: 'Fee defaulters', subtitle: (q.minDaysOverdue as number) ? `Overdue by more than ${q.minDaysOverdue} days` : 'All overdue fee',
        columns: [
          { key: 'name', label: 'Student', width: 2 }, { key: 'adm', label: 'Adm. no.' }, { key: 'section', label: 'Class' },
          { key: 'guardian', label: 'Parent', width: 1.6 }, { key: 'phone', label: 'Phone', width: 1.3 }, { key: 'months', label: 'Months', width: 1.8 },
          { key: 'days', label: 'Days overdue', type: 'number' }, { key: 'pending', label: 'Pending', type: 'money', width: 1.3 },
        ],
        rows: rows.map((r) => ({ name: r.name, adm: r.admissionNo, section: r.section, guardian: r.guardian?.name ?? '', phone: r.guardian?.phone ?? '', months: r.months.join(', '), days: r.daysOverdue, pending: Number(r.pending) })),
        totals: { name: `${rows.length} students`, pending: rows.reduce((s, r) => s + Number(r.pending), 0) },
      };
    },
  },

  // Attendance register: one row per student, one column per school day (Principal, Admin, own class teacher)
  'student-attendance-register': {
    perms: ['reports.attendance', 'attendance.student.mark'],
    params: z.object({ sectionId: id, month: period }),
    async build({ user, q }) {
      await assertSectionAccess(user, q.sectionId as string);
      const { start, end } = periodRange(q.month as string);
      const [section, students, marks] = await Promise.all([
        prisma.section.findFirstOrThrow({ where: { id: q.sectionId as string }, select: { name: true, class: { select: { name: true } }, classTeacher: { select: { name: true } } } }),
        prisma.student.findMany({ where: { sectionId: q.sectionId as string, status: 'ACTIVE' }, select: { id: true, name: true, rollNo: true }, orderBy: [{ rollNo: 'asc' }, { name: 'asc' }] }),
        prisma.studentAttendance.findMany({ where: { sectionId: q.sectionId as string, date: { gte: start, lte: end } }, select: { studentId: true, date: true, status: true } }),
      ]);
      const days = [...new Set(marks.map((m) => toIso(m.date)))].sort();
      const code: Record<string, string> = { PRESENT: 'P', ABSENT: 'A', LATE: 'L', LEAVE: 'Lv', HALF_DAY: 'H' };
      return {
        title: 'Student attendance register',
        subtitle: `${section.class.name}-${section.name} · ${new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(start)}${section.classTeacher ? ` · Class teacher ${section.classTeacher.name}` : ''}`,
        columns: [
          { key: 'roll', label: '#', width: 0.6 }, { key: 'name', label: 'Student', width: 3.2 },
          ...days.map((d) => ({ key: d, label: d.slice(8), width: 0.62, align: 'center' as const })),
          { key: 'present', label: 'P', type: 'number' as const, width: 0.7 }, { key: 'absent', label: 'A', type: 'number' as const, width: 0.7 },
          { key: 'pct', label: '%', type: 'percent' as const, width: 1 },
        ],
        rows: students.map((s, i) => {
          const mine = marks.filter((m) => m.studentId === s.id);
          const sum = attendanceSummary(countStatuses(mine));
          const row: Record<string, string | number | null> = { roll: s.rollNo ?? String(i + 1), name: s.name, present: (sum.PRESENT ?? 0) + (sum.LATE ?? 0), absent: sum.ABSENT ?? 0, pct: sum.percent };
          for (const d of days) row[d] = code[mine.find((m) => toIso(m.date) === d)?.status ?? ''] ?? '';
          return row;
        }),
        notes: ['P present · A absent · L late · Lv leave · H half day. Late counts as present; half day as half.'],
      };
    },
  },

  // Teacher / staff attendance for a month (Owner, Principal)
  'staff-attendance': {
    perms: ['attendance.staff.view'], schoolWideOnly: true,
    params: z.object({ month: period }),
    async build({ q }) {
      const { start, end } = periodRange(q.month as string);
      const [staff, marks] = await Promise.all([
        prisma.staff.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true, employeeNo: true, designation: true }, orderBy: { name: 'asc' } }),
        prisma.staffAttendance.findMany({ where: { date: { gte: start, lte: end } }, select: { staffId: true, status: true } }),
      ]);
      return {
        title: 'Staff attendance',
        subtitle: new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(start),
        columns: [
          { key: 'name', label: 'Name', width: 2.2 }, { key: 'emp', label: 'Emp. no.' }, { key: 'designation', label: 'Designation', width: 1.4 },
          { key: 'present', label: 'Present', type: 'number' }, { key: 'late', label: 'Late', type: 'number' }, { key: 'absent', label: 'Absent', type: 'number' },
          { key: 'leave', label: 'Leave', type: 'number' }, { key: 'pct', label: 'Attendance', type: 'percent' },
        ],
        rows: staff.map((s) => {
          const sum = attendanceSummary(countStatuses(marks.filter((m) => m.staffId === s.id)));
          return { name: s.name, emp: s.employeeNo, designation: s.designation ?? '', present: sum.PRESENT ?? 0, late: sum.LATE ?? 0, absent: sum.ABSENT ?? 0, leave: sum.LEAVE ?? 0, pct: sum.percent };
        }),
      };
    },
  },

  // Class-wise strength (Principal, Admin)
  'class-strength': {
    perms: ['class.view'], schoolWideOnly: true,
    params: z.object({ classId: id.optional() }),
    async build({ q }) {
      const sections = await prisma.section.findMany({
        where: { class: { archivedAt: null, ...(q.classId ? { id: q.classId as string } : {}) } },
        include: { class: { select: { name: true, level: true } }, classTeacher: { select: { name: true } }, students: { where: { status: 'ACTIVE' }, select: { gender: true } } },
      });
      sections.sort((a, b) => a.class.level - b.class.level || a.name.localeCompare(b.name));
      const rows = sections.map((s) => ({
        section: `${s.class.name}-${s.name}`, teacher: s.classTeacher?.name ?? '', capacity: s.capacity ?? null,
        boys: s.students.filter((x) => x.gender === 'MALE').length, girls: s.students.filter((x) => x.gender === 'FEMALE').length, total: s.students.length,
      }));
      const sum = (k: 'boys' | 'girls' | 'total') => rows.reduce((n, r) => n + r[k], 0);
      return {
        title: 'Class-wise strength', subtitle: fmtDate(toIso(await schoolToday())),
        columns: [
          { key: 'section', label: 'Class', width: 1.5 }, { key: 'teacher', label: 'Class teacher', width: 2 }, { key: 'capacity', label: 'Capacity', type: 'number' },
          { key: 'boys', label: 'Boys', type: 'number' }, { key: 'girls', label: 'Girls', type: 'number' }, { key: 'total', label: 'Total', type: 'number' },
        ],
        rows, totals: { section: 'Total', boys: sum('boys'), girls: sum('girls'), total: sum('total') },
      };
    },
  },

  leave: {
    perms: ['leave.view', 'leave.approve'], schoolWideOnly: true,
    params: z.object({ from: dateOnly.optional(), to: dateOnly.optional() }),
    async build({ q }) {
      const year = await currentAcademicYear();
      const from = q.from ? toDate(q.from as string) : year.startDate;
      const to = q.to ? toDate(q.to as string) : year.endDate;
      const rows = await prisma.leaveRequest.findMany({
        where: { fromDate: { lte: to }, toDate: { gte: from } }, orderBy: { fromDate: 'asc' },
        include: { staff: { select: { name: true, designation: true } } },
      });
      return {
        title: 'Leave report', subtitle: `${fmtDate(toIso(from))} – ${fmtDate(toIso(to))}`,
        columns: [
          { key: 'name', label: 'Staff', width: 2 }, { key: 'type', label: 'Type' }, { key: 'from', label: 'From', width: 1.2 }, { key: 'to', label: 'To', width: 1.2 },
          { key: 'days', label: 'Days', type: 'number' }, { key: 'status', label: 'Status' }, { key: 'reason', label: 'Reason', width: 3 },
        ],
        rows: rows.map((l) => ({ name: l.staff.name, type: l.type.toLowerCase(), from: toIso(l.fromDate), to: toIso(l.toDate), days: leaveDays(l.fromDate, l.toDate), status: l.status.toLowerCase(), reason: l.reason })),
        totals: { name: `${rows.length} requests`, days: rows.filter((l) => l.status === 'APPROVED').reduce((n, l) => n + leaveDays(l.fromDate, l.toDate), 0), status: 'approved days' },
      };
    },
  },
};

router.get('/', handler(async (req, res) => {
  const role = me(req).role;
  return res.json({
    success: true,
    data: Object.entries(REPORTS)
      .filter(([, r]) => r.perms.some((p) => hasPermission(role, p)) && (!r.schoolWideOnly || isSchoolWide(me(req))))
      .map(([key]) => key),
  });
}));

router.get('/:type', can('school.view'), handler(async (req, res) => {
  const def = REPORTS[req.params.type];
  if (!def) throw new AppError('Unknown report', 404);
  const user = me(req);
  if (!def.perms.some((p) => hasPermission(user.role, p)) || (def.schoolWideOnly && !isSchoolWide(user))) {
    throw new AppError('Forbidden: insufficient permissions', 403);
  }
  const { format, ...rest } = req.query;
  const fmtParam = z.enum(['pdf', 'xlsx', 'view']).default('pdf').parse(format);
  const q = def.params.parse(rest) as Record<string, unknown>;
  const school = await prisma.school.findUniqueOrThrow({ where: { id: currentSchoolId() }, select: { name: true, currency: true } });
  const report = { ...(await def.build({ user, q, school })), school: school.name, currency: school.currency };
  // CR-02: the same table as JSON, shown on screen. Never a file download.
  if (fmtParam === 'view') return sendSuccess(res, report);
  const file = fmtParam === 'pdf' ? await toPdf(report) : await toXlsx(report);
  const name = `${req.params.type}-${toIso(await schoolToday())}.${fmtParam}`;
  res.setHeader('Content-Type', fmtParam === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.end(file);
}));

export default router;

