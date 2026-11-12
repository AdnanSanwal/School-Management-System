import { Router } from 'express';
import { z } from 'zod';
import { DayOfWeek, Prisma } from '@prisma/client';
import prisma, { transaction } from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { authenticate } from '../../middleware/auth';
import { can } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { handler, parseBody, id, me } from '../../utils/http';
import { dayInTimezone, schoolTimezone } from '../../utils/dates';
import { isSchoolWide, staffForUser, studentScope, teacherSectionIds } from '../../utils/scope';
import type { JwtPayload } from '../../utils/jwt';
import { onRoll } from '../../utils/staffStatus';

// Class-wise and teacher-wise timetables (spec module 9; §8 My Timetable; §10 Timetable).

const router = Router();
router.use(authenticate);

const DAYS: DayOfWeek[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');

const include = {
  subject: { select: { id: true, name: true, code: true } },
  teacher: { select: { id: true, name: true } },
  section: { select: { id: true, name: true, class: { select: { name: true, level: true } } } },
} satisfies Prisma.TimetableSlotInclude;

type Slot = Prisma.TimetableSlotGetPayload<{ include: typeof include }>;
const present = (s: Slot) => ({
  id: s.id, dayOfWeek: s.dayOfWeek, period: s.period, startTime: s.startTime, endTime: s.endTime, room: s.room,
  subject: s.subject, teacher: s.teacher, section: { id: s.section.id, name: `${s.section.class.name}-${s.section.name}` },
});
const order = (a: Slot, b: Slot) => DAYS.indexOf(a.dayOfWeek) - DAYS.indexOf(b.dayOfWeek) || a.startTime.localeCompare(b.startTime);

async function canSeeSection(user: JwtPayload, sectionId: string) {
  if (isSchoolWide(user)) return true;
  if (user.role === 'TEACHER') return (await teacherSectionIds(user.id)).includes(sectionId);
  const kids = await prisma.student.findMany({ where: { AND: [await studentScope(user), { sectionId }] }, select: { id: true } });
  return kids.length > 0;
}

router.get('/section/:sectionId', can('timetable.view'), handler(async (req, res) => {
  if (!(await canSeeSection(me(req), req.params.sectionId))) throw new AppError('Section not found', 404);
  const slots = await prisma.timetableSlot.findMany({ where: { sectionId: req.params.sectionId }, include });
  return sendSuccess(res, slots.sort(order).map(present));
}));

/** A teacher's own week (or any teacher's, for the office). */
router.get('/teacher/:staffId', can('timetable.view'), handler(async (req, res) => {
  const user = me(req);
  let staffId = req.params.staffId;
  if (staffId === 'me') {
    const staff = await staffForUser(user.id);
    if (!staff) throw new AppError('No staff record for this login', 404);
    staffId = staff.id;
  } else if (!isSchoolWide(user)) {
    throw new AppError('Forbidden: insufficient permissions', 403);
  }
  const slots = await prisma.timetableSlot.findMany({ where: { teacherId: staffId }, include });
  return sendSuccess(res, slots.sort(order).map(present));
}));

/** Today's periods for the signed-in teacher (teacher home screen). */
router.get('/today', can('timetable.view'), handler(async (req, res) => {
  const staff = await staffForUser(me(req).id);
  if (!staff) return sendSuccess(res, { day: null, slots: [] });
  const tz = await schoolTimezone();
  const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(new Date()).toUpperCase() as DayOfWeek;
  const slots = await prisma.timetableSlot.findMany({ where: { teacherId: staff.id, dayOfWeek: day }, include });
  return sendSuccess(res, { day, date: dayInTimezone(tz), slots: slots.sort(order).map(present) });
}));

/**
 * When each teacher is already teaching in other sections, so the editor can grey out
 * busy teachers while picking instead of failing on save.
 */
router.get('/busy', can('timetable.manage'), handler(async (req, res) => {
  const excludeSectionId = typeof req.query.excludeSectionId === 'string' ? req.query.excludeSectionId : undefined;
  const slots = await prisma.timetableSlot.findMany({
    where: excludeSectionId ? { sectionId: { not: excludeSectionId } } : {},
    select: {
      teacherId: true, dayOfWeek: true, startTime: true, endTime: true,
      section: { select: { name: true, class: { select: { name: true } } } },
    },
  });
  return sendSuccess(res, slots.map((s) => ({
    teacherId: s.teacherId, dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime,
    section: `${s.section.class.name}-${s.section.name}`,
  })));
}));

const slotSchema = z.object({
  dayOfWeek: z.nativeEnum(DayOfWeek),
  period: z.coerce.number().int().min(1).max(15),
  startTime: time,
  endTime: time,
  subjectId: id,
  teacherId: id,
  room: z.string().max(30).optional().nullable(),
}).refine((s) => s.startTime < s.endTime, { message: 'End time must be after start time', path: ['endTime'] });

const overlaps = (a: { startTime: string; endTime: string }, b: { startTime: string; endTime: string }) => a.startTime < b.endTime && b.startTime < a.endTime;

/** Replaces a section's week. Rejects a teacher booked in two places at once. */
router.put('/section/:sectionId', can('timetable.manage'), handler(async (req, res) => {
  const { slots } = parseBody(z.object({ slots: z.array(slotSchema).max(100) }), req);
  const sectionId = req.params.sectionId;
  const section = await prisma.section.findFirst({ where: { id: sectionId }, select: { id: true } });
  if (!section) throw new AppError('Section not found', 404);

  const keys = slots.map((s) => `${s.dayOfWeek}:${s.period}`);
  if (new Set(keys).size !== keys.length) throw new AppError('Two subjects in the same period', 422);
  for (const day of DAYS) {
    const today = slots.filter((s) => s.dayOfWeek === day);
    for (let i = 0; i < today.length; i++) for (let j = i + 1; j < today.length; j++) {
      if (overlaps(today[i], today[j])) throw new AppError(`${day.toLowerCase()}: periods ${today[i].period} and ${today[j].period} overlap`, 422);
    }
  }
  const subjectIds = [...new Set(slots.map((s) => s.subjectId))];
  const teacherIds = [...new Set(slots.map((s) => s.teacherId))];
  const [subjects, teachers] = await Promise.all([
    prisma.subject.count({ where: { id: { in: subjectIds } } }),
    prisma.staff.findMany({ where: { id: { in: teacherIds }, status: onRoll, isTeacher: true }, select: { id: true, name: true } }),
  ]);
  if (subjects !== subjectIds.length || teachers.length !== teacherIds.length) throw new AppError('Unknown subject or teacher', 422);

  // Clash check against every other section's timetable.
  const elsewhere = await prisma.timetableSlot.findMany({
    where: { teacherId: { in: teacherIds }, sectionId: { not: sectionId } },
    include: { section: { select: { name: true, class: { select: { name: true } } } } },
  });
  const clashes = slots.flatMap((s) => elsewhere
    .filter((o) => o.teacherId === s.teacherId && o.dayOfWeek === s.dayOfWeek && overlaps(o, s))
    .map((o) => `${teachers.find((t) => t.id === s.teacherId)!.name} already teaches ${o.section.class.name}-${o.section.name} on ${s.dayOfWeek.toLowerCase()} ${o.startTime}–${o.endTime}`));
  if (clashes.length) throw new AppError(`Timetable clash: ${[...new Set(clashes)].slice(0, 3).join('; ')}`, 409);

  const schoolId = currentSchoolId();
  await transaction(async (tx) => {
    await tx.timetableSlot.deleteMany({ where: { sectionId } });
    if (slots.length) await tx.timetableSlot.createMany({ data: slots.map((s) => ({ schoolId, sectionId, ...s, room: s.room ?? null })) });
  });
  return sendSuccess(res, { saved: slots.length }, 'Timetable saved');
}));

export default router;

