import { Router } from 'express';
import { z } from 'zod';
import prisma, { transaction } from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { authenticate } from '../../middleware/auth';
import { can } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { handler, parseBody, dateOnly } from '../../utils/http';
import { toDate } from '../../utils/dates';

// School profile and academic years (spec: Settings).

const router = Router();
router.use(authenticate);

router.get('/', can('school.view'), handler(async (_req, res) => {
  const school = await prisma.school.findUniqueOrThrow({ where: { id: currentSchoolId() } });
  const currentYear = await prisma.academicYear.findFirst({ where: { isCurrent: true } });
  return sendSuccess(res, { ...school, currentYear });
}));

const schoolUpdate = z.object({
  name: z.string().min(2).max(150).optional(),
  address: z.string().max(500).nullable().optional(),
  phone: z.string().max(32).nullable().optional(),
  email: z.string().email().nullable().optional(),
  logoUrl: z.string().url().max(1024).nullable().optional(),
  timezone: z.string().max(64).optional(),
  lateFeeAmount: z.coerce.number().min(0).max(100_000).optional(),
  lateFeeGraceDays: z.coerce.number().int().min(0).max(90).optional(),
  lowAttendanceThreshold: z.coerce.number().int().min(0).max(100).optional(),
  libraryFinePerDay: z.coerce.number().min(0).max(10_000).optional(),
}).strict();

router.patch('/', can('school.manage'), handler(async (req, res) => {
  const data = parseBody(schoolUpdate, req);
  if (data.timezone) {
    try { new Intl.DateTimeFormat('en', { timeZone: data.timezone }); } catch { throw new AppError('Unknown timezone', 422); }
  }
  // School is not a tenant model (it *is* the tenant), so update it by the context's id.
  const school = await prisma.school.update({ where: { id: currentSchoolId() }, data });
  return sendSuccess(res, school, 'School updated');
}));

// ─── Academic years ───

router.get('/academic-years', can('school.view'), handler(async (_req, res) => {
  return sendSuccess(res, await prisma.academicYear.findMany({ orderBy: { startDate: 'desc' } }));
}));

const yearBody = z.object({
  name: z.string().min(4).max(20),
  startDate: dateOnly,
  endDate: dateOnly,
}).refine((y) => y.startDate < y.endDate, { message: 'endDate must be after startDate', path: ['endDate'] });

router.post('/academic-years', can('school.manage'), handler(async (req, res) => {
  const y = parseBody(yearBody, req);
  const year = await prisma.academicYear.create({
    data: { schoolId: currentSchoolId(), name: y.name, startDate: toDate(y.startDate), endDate: toDate(y.endDate) },
  });
  return sendSuccess(res, year, 'Academic year created', 201);
}));

router.post('/academic-years/:id/make-current', can('school.manage'), handler(async (req, res) => {
  const year = await transaction(async (tx) => {
    const target = await tx.academicYear.findFirst({ where: { id: req.params.id } });
    if (!target) throw new AppError('Academic year not found', 404);
    await tx.academicYear.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
    return tx.academicYear.update({ where: { id: target.id }, data: { isCurrent: true } });
  });
  return sendSuccess(res, year, `${year.name} is now the current year`);
}));

export default router;
