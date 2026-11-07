import { Router } from 'express';
import { z } from 'zod';
import { CalendarEventType } from '@prisma/client';
import prisma from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { authenticate } from '../../middleware/auth';
import { can } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { handler, parseBody, parseQuery, dateOnly, me } from '../../utils/http';
import { addDays, schoolToday, toDate, toIso } from '../../utils/dates';

// Holidays & events (spec module 10: Holidays & Calendar).

const router = Router();
router.use(authenticate);

const present = (e: { startDate: Date; endDate: Date } & Record<string, unknown>) => ({ ...e, startDate: toIso(e.startDate), endDate: toIso(e.endDate) });

router.get('/', can('calendar.view'), handler(async (req, res) => {
  const q = parseQuery(z.object({ from: dateOnly.optional(), to: dateOnly.optional(), type: z.nativeEnum(CalendarEventType).optional() }), req);
  const today = await schoolToday();
  const from = q.from ? toDate(q.from) : today;
  const to = q.to ? toDate(q.to) : addDays(from, 120);
  const rows = await prisma.calendarEvent.findMany({
    where: { startDate: { lte: to }, endDate: { gte: from }, ...(q.type ? { type: q.type } : {}) },
    orderBy: { startDate: 'asc' },
  });
  return sendSuccess(res, rows.map(present));
}));

const eventBody = z.object({
  title: z.string().min(2).max(120),
  description: z.string().max(2000).optional(),
  type: z.nativeEnum(CalendarEventType).default('HOLIDAY'),
  startDate: dateOnly,
  endDate: dateOnly.optional(),
});

router.post('/', can('calendar.manage'), handler(async (req, res) => {
  const b = parseBody(eventBody, req);
  const end = b.endDate ?? b.startDate;
  if (end < b.startDate) throw new AppError('End date is before start date', 422);
  const e = await prisma.calendarEvent.create({
    data: {
      schoolId: currentSchoolId(), title: b.title, description: b.description, type: b.type,
      startDate: toDate(b.startDate), endDate: toDate(end), createdById: me(req).id,
    },
  });
  return sendSuccess(res, present(e), 'Added to calendar', 201);
}));

router.patch('/:id', can('calendar.manage'), handler(async (req, res) => {
  const b = parseBody(eventBody.partial().strict(), req);
  const cur = await prisma.calendarEvent.findFirst({ where: { id: req.params.id } });
  if (!cur) throw new AppError('Event not found', 404);
  const start = b.startDate ?? toIso(cur.startDate);
  const end = b.endDate ?? toIso(cur.endDate);
  if (end < start) throw new AppError('End date is before start date', 422);
  const e = await prisma.calendarEvent.update({
    where: { id: cur.id },
    data: { ...b, startDate: toDate(start), endDate: toDate(end) },
  });
  return sendSuccess(res, present(e), 'Updated');
}));

router.delete('/:id', can('calendar.manage'), handler(async (req, res) => {
  const { count } = await prisma.calendarEvent.deleteMany({ where: { id: req.params.id } });
  if (!count) throw new AppError('Event not found', 404);
  return sendSuccess(res, null, 'Removed from calendar');
}));

export default router;
