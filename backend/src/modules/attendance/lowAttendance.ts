import prisma from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { attendanceSummary } from '../../utils/attendanceStats';
import { schoolTimezone, schoolToday, toIso, zonedDayStart } from '../../utils/dates';
import { guardiansOf, notify, notifyEach } from '../../utils/notify';
import { messageFamilies } from '../../utils/messaging';

/**
 * Spec §12 "Low Attendance Alert → Parent + Principal".
 * Students below the school's threshold this month (with at least `minDays` marked)
 * — each parent hears about each child at most once a month; principals get a summary.
 */
export async function sendLowAttendanceAlerts(minDays = 5) {
  const school = await prisma.school.findUniqueOrThrow({ where: { id: currentSchoolId() }, select: { lowAttendanceThreshold: true } });
  const threshold = school.lowAttendanceThreshold;
  const today = await schoolToday();
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const rows = await prisma.studentAttendance.groupBy({
    by: ['studentId', 'status'], where: { date: { gte: monthStart, lte: today }, student: { status: 'ACTIVE' } }, _count: true,
  });
  const byStudent = new Map<string, { status: string; _count: number }[]>();
  for (const r of rows) byStudent.set(r.studentId, [...(byStudent.get(r.studentId) ?? []), { status: r.status, _count: r._count }]);
  const low = [...byStudent].map(([studentId, counts]) => ({ studentId, ...attendanceSummary(counts) }))
    .filter((s) => s.total >= minDays && s.percent !== null && s.percent < threshold);

  const parents = await guardiansOf(low.map((s) => s.studentId));
  const tz = await schoolTimezone();
  const already = await prisma.notification.findMany({
    where: { type: 'LOW_ATTENDANCE', userId: { in: parents.map((p) => p.userId) }, createdAt: { gte: zonedDayStart(toIso(monthStart), tz) } },
    select: { userId: true, data: true },
  });
  const sent = new Set(already.map((n) => `${n.userId}:${(n.data as { studentId?: string } | null)?.studentId}`));
  const fresh = parents.filter((p) => !sent.has(`${p.userId}:${p.studentId}`));
  const pct = new Map(low.map((s) => [s.studentId, s.percent]));
  const parentsNotified = await notifyEach(fresh.map((p) => ({
    userId: p.userId, type: 'LOW_ATTENDANCE' as const,
    title: `Low attendance: ${p.studentName}`,
    body: `${p.studentName}'s attendance this month is ${pct.get(p.studentId)}% (school minimum ${threshold}%).`,
    data: { studentId: p.studentId },
  })));

  const names = await prisma.student.findMany({ where: { id: { in: low.map((s) => s.studentId) } }, select: { id: true, name: true } });
  await messageFamilies('LOW_ATTENDANCE', names.map((n) => ({ studentId: n.id, body: `${n.name}'s attendance this month is ${pct.get(n.id)}%, below the school minimum of ${threshold}%.` })), { oncePerDays: 28 });

  let principalsNotified = 0;
  if (fresh.length) {
    const principals = await prisma.user.findMany({ where: { role: 'PRINCIPAL', isActive: true }, select: { id: true } });
    principalsNotified = await notify(principals.map((p) => p.id), {
      type: 'LOW_ATTENDANCE', title: `${low.length} student(s) below ${threshold}% attendance`,
      body: 'See Attendance today → this month for details.', data: {},
    });
  }
  return { threshold, students: low.length, parentsNotified, principalsNotified, skippedAlreadyAlerted: parents.length - fresh.length };
}
