import { Router } from 'express';
import { z } from 'zod';
import { AttendanceStatus } from '@prisma/client';
import prisma, { transaction } from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { authenticate } from '../../middleware/auth';
import { can, hasPermission } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { handler, parseBody, parseQuery, dateOnly, period, id, me } from '../../utils/http';
import { toDate, toIso, schoolToday, periodRange } from '../../utils/dates';
import { assertSectionAccess, assertStudentAccess } from '../../utils/scope';
import { attendanceSummary, countStatuses } from '../../utils/attendanceStats';
import { guardiansOf, notifyEach } from '../../utils/notify';
import { messageFamilies } from '../../utils/messaging';
import { sendLowAttendanceAlerts } from './lowAttendance';
import { onRoll } from '../../utils/staffStatus';

// Student and staff attendance (spec: Attendance; Teacher → Mark Attendance).

const router = Router();
router.use(authenticate);

const status = z.nativeEnum(AttendanceStatus);

/** Teachers mark today only; holders of attendance.*.correct may fix past days. Nobody marks the future. */
async function resolveMarkDate(role: string, iso: string | undefined, correctPerm: 'attendance.student.correct' | 'attendance.staff.mark') {
  const today = await schoolToday();
  const date = iso ? toDate(iso) : today;
  if (date > today) throw new AppError('Cannot mark attendance for a future date', 422);
  if (date < today && !hasPermission(role, correctPerm)) throw new AppError('Only today\'s attendance can be marked', 403);
  return date;
}

// ─── Students ───

router.get('/students', can('attendance.student.view', 'attendance.student.mark'), handler(async (req, res) => {
  const q = parseQuery(z.object({ sectionId: id, date: dateOnly.optional() }), req);
  await assertSectionAccess(me(req), q.sectionId);
  const date = q.date ? toDate(q.date) : await schoolToday();
  const [students, marks, holiday] = await Promise.all([
    prisma.student.findMany({
      where: { sectionId: q.sectionId, status: 'ACTIVE' },
      select: { id: true, name: true, admissionNo: true, rollNo: true, photoUrl: true },
      orderBy: [{ rollNo: 'asc' }, { name: 'asc' }],
    }),
    prisma.studentAttendance.findMany({ where: { sectionId: q.sectionId, date } }),
    prisma.calendarEvent.findFirst({ where: { type: 'HOLIDAY', startDate: { lte: date }, endDate: { gte: date } } }),
  ]);
  const byStudent = new Map(marks.map((m) => [m.studentId, m]));
  return sendSuccess(res, {
    date: toIso(date),
    holiday: holiday?.title ?? null,
    marked: marks.length > 0,
    students: students.map((s) => ({ ...s, status: byStudent.get(s.id)?.status ?? null, remarks: byStudent.get(s.id)?.remarks ?? null })),
  });
}));

const markStudents = z.object({
  sectionId: id,
  date: dateOnly.optional(),
  records: z.array(z.object({ studentId: id, status, remarks: z.string().max(200).optional() })).min(1).max(200),
});

router.put('/students', can('attendance.student.mark', 'attendance.student.correct'), handler(async (req, res) => {
  const body = parseBody(markStudents, req);
  const user = me(req);
  await assertSectionAccess(user, body.sectionId);
  const date = await resolveMarkDate(user.role, body.date, 'attendance.student.correct');

  const ids = [...new Set(body.records.map((r) => r.studentId))];
  if (ids.length !== body.records.length) throw new AppError('Duplicate student in records', 422);
  const valid = await prisma.student.count({ where: { id: { in: ids }, sectionId: body.sectionId, status: 'ACTIVE' } });
  if (valid !== ids.length) throw new AppError('Some students are not active in this section', 422);

  const schoolId = currentSchoolId();
  const before = new Map(
    (await prisma.studentAttendance.findMany({ where: { studentId: { in: ids }, date }, select: { studentId: true, status: true } }))
      .map((r) => [r.studentId, r.status]),
  );
  await transaction(async (tx) => {
    for (const r of body.records) {
      await tx.studentAttendance.upsert({
        where: { studentId_date: { studentId: r.studentId, date } },
        create: { schoolId, studentId: r.studentId, sectionId: body.sectionId, date, status: r.status, remarks: r.remarks, markedById: user.id },
        update: { status: r.status, remarks: r.remarks ?? null, markedById: user.id, sectionId: body.sectionId },
      });
    }
  });

  // Spec: "Student marked Absent → Parent". Only for newly absent students.
  const newlyAbsent = body.records.filter((r) => r.status === 'ABSENT' && before.get(r.studentId) !== 'ABSENT').map((r) => r.studentId);
  let notified = 0;
  if (newlyAbsent.length) {
    const parents = await guardiansOf(newlyAbsent);
    notified = await notifyEach(parents.map((p) => ({
      userId: p.userId, type: 'ATTENDANCE_ABSENT' as const,
      title: `${p.studentName} is absent today`,
      body: `${p.studentName} was marked absent on ${toIso(date)}.`,
      data: { studentId: p.studentId, date: toIso(date) },
    })));
    const names = await prisma.student.findMany({ where: { id: { in: newlyAbsent } }, select: { id: true, name: true } });
    await messageFamilies('ATTENDANCE_ABSENT', names.map((n) => ({ studentId: n.id, body: `${n.name} was marked absent today (${toIso(date)}).` })));
  }

  const counts = attendanceSummary(countStatuses(body.records));
  return sendSuccess(res, { date: toIso(date), saved: body.records.length, parentsNotified: notified, summary: counts }, 'Attendance saved');
}));

// Monthly calendar for one student (parent app: green/red/yellow days).
router.get('/students/:studentId/calendar', can('attendance.student.view'), handler(async (req, res) => {
  const q = parseQuery(z.object({ month: period.optional() }), req);
  await assertStudentAccess(me(req), req.params.studentId);
  const month = q.month ?? toIso(await schoolToday()).slice(0, 7);
  const { start, end } = periodRange(month);
  const [days, holidays] = await Promise.all([
    prisma.studentAttendance.findMany({
      where: { studentId: req.params.studentId, date: { gte: start, lte: end } },
      select: { date: true, status: true, remarks: true }, orderBy: { date: 'asc' },
    }),
    prisma.calendarEvent.findMany({
      where: { type: 'HOLIDAY', startDate: { lte: end }, endDate: { gte: start } },
      select: { title: true, startDate: true, endDate: true },
    }),
  ]);
  return sendSuccess(res, {
    month,
    days: days.map((d) => ({ date: toIso(d.date), status: d.status, remarks: d.remarks })),
    holidays: holidays.map((h) => ({ title: h.title, startDate: toIso(h.startDate), endDate: toIso(h.endDate) })),
    summary: attendanceSummary(countStatuses(days)),
  });
}));

// School-wide picture for one day: which sections are marked, present/absent counts.
router.get('/summary', can('attendance.student.view'), handler(async (req, res) => {
  const user = me(req);
  if (['TEACHER', 'PARENT', 'STUDENT'].includes(user.role)) throw new AppError('Forbidden: insufficient permissions', 403);
  const q = parseQuery(z.object({ date: dateOnly.optional() }), req);
  const date = q.date ? toDate(q.date) : await schoolToday();
  const [sections, counts] = await Promise.all([
    prisma.section.findMany({
      where: { class: { archivedAt: null } },
      include: {
        class: { select: { name: true, level: true } },
        classTeacher: { select: { name: true } },
        _count: { select: { students: { where: { status: 'ACTIVE' } } } },
      },
    }),
    prisma.studentAttendance.groupBy({ by: ['sectionId', 'status'], where: { date }, _count: true }),
  ]);
  const rows = sections
    .sort((a, b) => a.class.level - b.class.level || a.name.localeCompare(b.name))
    .map((s) => {
      const mine = counts.filter((c) => c.sectionId === s.id);
      const summary = attendanceSummary(mine);
      return {
        sectionId: s.id, name: `${s.class.name}-${s.name}`, classTeacher: s.classTeacher?.name ?? null,
        strength: s._count.students, marked: mine.length > 0, ...summary,
      };
    });
  const total = attendanceSummary(countStatuses(counts, (c) => c._count));
  return sendSuccess(res, {
    date: toIso(date),
    sectionsMarked: rows.filter((r) => r.marked).length,
    sectionsTotal: rows.length,
    total,
    sections: rows,
  });
}));

// ─── Staff ───

router.get('/staff', can('attendance.staff.view', 'attendance.staff.mark'), handler(async (req, res) => {
  const q = parseQuery(z.object({ date: dateOnly.optional() }), req);
  const date = q.date ? toDate(q.date) : await schoolToday();
  const [staff, marks, leaves] = await Promise.all([
    prisma.staff.findMany({ where: { status: onRoll }, select: { id: true, name: true, employeeNo: true, designation: true, isTeacher: true }, orderBy: { name: 'asc' } }),
    prisma.staffAttendance.findMany({ where: { date } }),
    prisma.leaveRequest.findMany({ where: { status: 'APPROVED', fromDate: { lte: date }, toDate: { gte: date } }, select: { staffId: true } }),
  ]);
  const byStaff = new Map(marks.map((m) => [m.staffId, m]));
  const onLeave = new Set(leaves.map((l) => l.staffId));
  return sendSuccess(res, {
    date: toIso(date),
    staff: staff.map((s) => {
      const m = byStaff.get(s.id);
      return { ...s, status: m?.status ?? null, checkIn: m?.checkIn ?? null, checkOut: m?.checkOut ?? null, remarks: m?.remarks ?? null, approvedLeave: onLeave.has(s.id) };
    }),
  });
}));

const markStaff = z.object({
  date: dateOnly.optional(),
  records: z.array(z.object({
    staffId: id, status,
    checkIn: z.string().datetime().optional(),
    checkOut: z.string().datetime().optional(),
    remarks: z.string().max(200).optional(),
  })).min(1).max(300),
});

router.put('/staff', can('attendance.staff.mark'), handler(async (req, res) => {
  const body = parseBody(markStaff, req);
  const user = me(req);
  const date = await resolveMarkDate(user.role, body.date, 'attendance.staff.mark');
  const ids = [...new Set(body.records.map((r) => r.staffId))];
  if (ids.length !== body.records.length) throw new AppError('Duplicate staff member in records', 422);
  if ((await prisma.staff.count({ where: { id: { in: ids }, status: onRoll } })) !== ids.length) {
    throw new AppError('Some staff members are not active', 422);
  }
  const schoolId = currentSchoolId();
  await transaction(async (tx) => {
    for (const r of body.records) {
      const data = {
        status: r.status, remarks: r.remarks ?? null, markedById: user.id,
        checkIn: r.checkIn ? new Date(r.checkIn) : null, checkOut: r.checkOut ? new Date(r.checkOut) : null,
      };
      await tx.staffAttendance.upsert({
        where: { staffId_date: { staffId: r.staffId, date } },
        create: { schoolId, staffId: r.staffId, date, ...data },
        update: data,
      });
    }
  });
  return sendSuccess(res, { date: toIso(date), saved: body.records.length }, 'Staff attendance saved');
}));

// Spec §12 "Low Attendance Alert → Parent + Principal" (also runs every Monday, see jobs/daily.ts).
router.post('/low-attendance-alerts', can('attendance.student.correct'), handler(async (req, res) => {
  const { minDays } = parseBody(z.object({ minDays: z.coerce.number().int().min(1).max(31).default(5) }), req);
  const r = await sendLowAttendanceAlerts(minDays);
  return sendSuccess(res, r, `Alerted ${r.parentsNotified} parent(s) about ${r.students} student(s)`);
}));

export default router;
