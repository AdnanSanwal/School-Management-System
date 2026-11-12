import { evaluateLicence, forgetLicence } from '../../utils/licence';
import { dayInTimezone, toDate, toIso } from '../../utils/dates';
import { Router, Response, NextFunction } from 'express';
import { hashPassword } from '../../utils/password';
import { z } from 'zod';
import { basePrisma } from '../../config/database';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { can } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { sendSuccess } from '../../utils/apiResponse';
import { AppError } from '../../middleware/errorHandler';
import { DEFAULT_DESIGNATIONS } from '../../utils/staffStatus';
import { endSchoolSessions } from '../../utils/sessions';

// Platform (SaaS operator) endpoints: onboard and suspend schools.
// SUPER_ADMIN only; runs in system context, so it uses the unscoped client.

const router = Router();
router.use(authenticate, can('platform.manage'));

const createSchoolSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(150),
    code: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/, 'lowercase letters, digits and dashes only'),
    phone: z.string().max(32).optional(),
    email: z.string().email().optional(),
    address: z.string().max(500).optional(),
    academicYear: z.object({
      name: z.string().min(4).max(20),
      startDate: z.coerce.date(),
      endDate: z.coerce.date(),
    }),
    // Optional: the subscription the school starts with (can be set later).
    licence: z.object({
      plan: z.string().trim().max(60).optional(),
      paidUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      maxStudents: z.number().int().min(1).max(1_000_000).optional(),
    }).optional(),
    owner: z.object({
      name: z.string().min(2).max(100),
      email: z.string().email(),
      phone: z.string().max(32).optional(),
      password: z.string().min(8).max(100),
    }),
  }),
});

router.get('/schools', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const [schools, students, owners] = await Promise.all([
      basePrisma.school.findMany({ orderBy: { createdAt: 'desc' }, include: { _count: { select: { users: true } } } }),
      basePrisma.student.groupBy({ by: ['schoolId'], where: { status: 'ACTIVE' }, _count: true }),
      basePrisma.user.findMany({ where: { role: 'OWNER' }, select: { schoolId: true, name: true, email: true, lastLoginAt: true } }),
    ]);
    return sendSuccess(res, schools.map((sc) => ({
      ...sc,
      licence: evaluateLicence(sc, dayInTimezone(sc.timezone)),
      activeStudents: students.find((x) => x.schoolId === sc.id)?._count ?? 0,
      owners: owners.filter((o) => o.schoolId === sc.id),
    })));
  } catch (err) { next(err); }
});

router.post('/schools', validate(createSchoolSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { academicYear, owner, licence, ...school } = req.body as z.infer<typeof createSchoolSchema>['body'];
    const password = await hashPassword(owner.password);

    const created = await basePrisma.$transaction(async (tx) => {
      const s = await tx.school.create({
        data: { ...school, licencePlan: licence?.plan || null, licencePaidUntil: licence?.paidUntil ? toDate(licence.paidUntil) : null, maxStudents: licence?.maxStudents ?? null },
      });
      await tx.academicYear.create({ data: { ...academicYear, schoolId: s.id, isCurrent: true } });
      // The standard job titles for the staff forms (the school can change the list).
      await tx.designation.createMany({ data: DEFAULT_DESIGNATIONS.map((name) => ({ schoolId: s.id, name })), skipDuplicates: true });
      const o = await tx.user.create({
        data: { schoolId: s.id, role: 'OWNER', name: owner.name, email: owner.email.toLowerCase(), phone: owner.phone, password, mustChangePassword: true },
        select: { id: true, name: true, email: true, role: true },
      });
      return { school: s, owner: o };
    });
    return sendSuccess(res, created, 'School created', 201);
  } catch (err) { next(err); }
});

router.patch(
  '/schools/:id/status',
  validate(z.object({ body: z.object({ isActive: z.boolean() }) })),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const school = await basePrisma.school.update({ where: { id: req.params.id }, data: { isActive: req.body.isActive } });
      forgetLicence(school.id);
      if (!school.isActive) await endSchoolSessions(school.id); // signed out everywhere, at once
      return sendSuccess(res, school, school.isActive ? 'School activated' : 'School suspended');
    } catch (err) { next(err); }
  },
);

// ─── Subscriptions ───

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

async function licenceView(schoolId: string) {
  const school = await basePrisma.school.findUnique({ where: { id: schoolId } });
  if (!school) throw new AppError('School not found', 404);
  const [payments, students] = await Promise.all([
    basePrisma.licencePayment.findMany({ where: { schoolId }, orderBy: [{ createdAt: 'desc' }] }),
    basePrisma.student.count({ where: { schoolId, status: 'ACTIVE' } }),
  ]);
  return {
    school: { id: school.id, name: school.name, code: school.code, isActive: school.isActive, currency: school.currency },
    status: evaluateLicence(school, dayInTimezone(school.timezone)),
    override: school.licenceOverride, activeStudents: students,
    payments: payments.map((p, i) => ({ ...p, paidOn: toIso(p.paidOn), coversUntil: toIso(p.coversUntil), paidUntilBefore: p.paidUntilBefore ? toIso(p.paidUntilBefore) : null, removable: i === 0 })),
  };
}

router.get('/schools/:id/licence', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { return sendSuccess(res, await licenceView(req.params.id)); } catch (err) { next(err); }
});

/** Plan, dates, limits and the note shown to the school. */
router.patch(
  '/schools/:id/licence',
  validate(z.object({
    body: z.object({
      plan: z.string().trim().max(60).nullable().optional(),
      paidUntil: dateOnly.nullable().optional(),
      graceDays: z.number().int().min(0).max(90).optional(),
      notifyDays: z.number().int().min(0).max(90).optional(),
      override: z.boolean().optional(),
      message: z.string().trim().max(300).nullable().optional(),
      maxStudents: z.number().int().min(1).max(1_000_000).nullable().optional(),
    }).strict(),
  })),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const b = req.body;
      if (!(await basePrisma.school.findUnique({ where: { id: req.params.id }, select: { id: true } }))) throw new AppError('School not found', 404);
      await basePrisma.school.update({
        where: { id: req.params.id },
        data: {
          ...(b.plan !== undefined ? { licencePlan: b.plan || null } : {}),
          ...(b.paidUntil !== undefined ? { licencePaidUntil: b.paidUntil ? toDate(b.paidUntil) : null } : {}),
          ...(b.graceDays !== undefined ? { licenceGraceDays: b.graceDays } : {}),
          ...(b.notifyDays !== undefined ? { licenceNotifyDays: b.notifyDays } : {}),
          ...(b.override !== undefined ? { licenceOverride: b.override } : {}),
          ...(b.message !== undefined ? { licenceMessage: b.message || null } : {}),
          ...(b.maxStudents !== undefined ? { maxStudents: b.maxStudents } : {}),
        },
      });
      forgetLicence(req.params.id);
      return sendSuccess(res, await licenceView(req.params.id), 'Subscription saved');
    } catch (err) { next(err); }
  },
);

/** A payment received from the school; it moves the paid-until date. */
router.post(
  '/schools/:id/licence/payments',
  validate(z.object({
    body: z.object({
      amount: z.number().positive().max(100_000_000),
      paidOn: dateOnly,
      paidUntil: dateOnly,
      method: z.string().trim().max(40).optional(),
      reference: z.string().trim().max(100).optional(),
      note: z.string().trim().max(300).optional(),
    }),
  })),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const b = req.body;
      const school = await basePrisma.school.findUnique({ where: { id: req.params.id } });
      if (!school) throw new AppError('School not found', 404);
      if (b.paidUntil < b.paidOn) throw new AppError('The new paid-until date is before the payment date', 422);
      if (school.licencePaidUntil && b.paidUntil <= toIso(school.licencePaidUntil)) {
        throw new AppError(`This school is already paid until ${toIso(school.licencePaidUntil)}. Choose a later date.`, 422);
      }
      await basePrisma.$transaction([
        basePrisma.licencePayment.create({
          data: {
            schoolId: school.id, amount: b.amount, currency: school.currency, paidOn: toDate(b.paidOn), coversUntil: toDate(b.paidUntil), paidUntilBefore: school.licencePaidUntil,
            method: b.method || null, reference: b.reference || null, note: b.note || null, recordedById: req.user!.id,
          },
        }),
        basePrisma.school.update({ where: { id: school.id }, data: { licencePaidUntil: toDate(b.paidUntil) } }),
      ]);
      forgetLicence(school.id);
      return sendSuccess(res, await licenceView(school.id), `Payment recorded; ${school.name} is paid until ${b.paidUntil}`, 201);
    } catch (err) { next(err); }
  },
);

/** Entered by mistake: the latest payment can be removed, and the paid-until date goes back to what it was. */
router.delete('/schools/:id/licence/payments/:paymentId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const payment = await basePrisma.licencePayment.findFirst({ where: { id: req.params.paymentId, schoolId: req.params.id } });
    if (!payment) throw new AppError('Payment not found', 404);
    const latest = await basePrisma.licencePayment.findFirst({ where: { schoolId: payment.schoolId }, orderBy: [{ createdAt: 'desc' }] });
    if (latest?.id !== payment.id) throw new AppError('Only the latest payment can be removed', 409);
    await basePrisma.$transaction([
      basePrisma.licencePayment.delete({ where: { id: payment.id } }),
      basePrisma.school.update({ where: { id: payment.schoolId }, data: { licencePaidUntil: payment.paidUntilBefore } }),
    ]);
    forgetLicence(payment.schoolId);
    return sendSuccess(res, await licenceView(payment.schoolId), 'Payment removed');
  } catch (err) { next(err); }
});

export default router;
