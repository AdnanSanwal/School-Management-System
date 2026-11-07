import { Router, Response, NextFunction } from 'express';
import { hashPassword } from '../../utils/password';
import { z } from 'zod';
import { basePrisma } from '../../config/database';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { can } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { sendSuccess } from '../../utils/apiResponse';

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
      activeStudents: students.find((x) => x.schoolId === sc.id)?._count ?? 0,
      owners: owners.filter((o) => o.schoolId === sc.id),
    })));
  } catch (err) { next(err); }
});

router.post('/schools', validate(createSchoolSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { academicYear, owner, ...school } = req.body as z.infer<typeof createSchoolSchema>['body'];
    const password = await hashPassword(owner.password);

    const created = await basePrisma.$transaction(async (tx) => {
      const s = await tx.school.create({ data: school });
      await tx.academicYear.create({ data: { ...academicYear, schoolId: s.id, isCurrent: true } });
      const o = await tx.user.create({
        data: { schoolId: s.id, role: 'OWNER', name: owner.name, email: owner.email.toLowerCase(), phone: owner.phone, password },
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
      return sendSuccess(res, school, school.isActive ? 'School activated' : 'School suspended');
    } catch (err) { next(err); }
  },
);

export default router;
