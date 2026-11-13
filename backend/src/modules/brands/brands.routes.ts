import { Router } from 'express';
import { z } from 'zod';
import { basePrisma } from '../../config/database';
import { authenticate } from '../../middleware/auth';
import { can } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';
import { handler, parseBody, me, dateOnly } from '../../utils/http';
import { sendSuccess } from '../../utils/apiResponse';
import { hashPassword } from '../../utils/password';
import { assertStrongPassword } from '../../utils/passwordPolicy';
import { evaluateLicence, forgetLicence } from '../../utils/licence';
import { dayInTimezone, toDate, toIso } from '../../utils/dates';
import { endAllSessions, endSchoolSessions } from '../../utils/sessions';
import { DEFAULT_DESIGNATIONS } from '../../utils/staffStatus';
import { forgetCustomRoles } from '../../utils/rolePermissions';
import { audit } from '../../utils/audit';

const router = Router();
router.use(authenticate);
const slug = z.string().min(2).max(40).regex(/^[a-z0-9-]+$/);
const limit = z.number().int().min(1).max(1_000_000).nullable();
const url = z.string().url().max(1024).refine(s => /^https?:\/\//i.test(s)).nullable();
const licenceBody = z.object({ plan: z.string().trim().max(60).nullable().optional(), paidUntil: dateOnly.nullable().optional(), graceDays: z.number().int().min(0).max(90).optional(), notifyDays: z.number().int().min(0).max(90).optional(), override: z.boolean().optional(), message: z.string().max(300).nullable().optional(), maxBranches: limit.optional(), maxStudents: limit.optional() }).strict();
const ownerBody = z.object({ name: z.string().min(2).max(100), email: z.string().email(), password: z.string().min(8).max(72), phone: z.string().max(32).optional() });
const branchBody = z.object({ name: z.string().min(2).max(150), code: slug, address: z.string().max(500).optional(), phone: z.string().max(32).optional(), academicYear: z.object({ name: z.string().min(4).max(20), startDate: dateOnly, endDate: dateOnly }).refine(y => y.endDate > y.startDate, 'Academic year end must follow start') }).strict();

function licenceData(b: z.infer<typeof licenceBody>) {
  return { ...(b.plan !== undefined ? { licencePlan: b.plan } : {}), ...(b.paidUntil !== undefined ? { licencePaidUntil: b.paidUntil ? toDate(b.paidUntil) : null } : {}), ...(b.graceDays !== undefined ? { licenceGraceDays: b.graceDays } : {}), ...(b.notifyDays !== undefined ? { licenceNotifyDays: b.notifyDays } : {}), ...(b.override !== undefined ? { licenceOverride: b.override } : {}), ...(b.message !== undefined ? { licenceMessage: b.message } : {}), ...(b.maxBranches !== undefined ? { maxBranches: b.maxBranches } : {}), ...(b.maxStudents !== undefined ? { maxStudents: b.maxStudents } : {}) };
}
async function authorizedBrand(userId: string, role: string, brandId: string) {
  const brand = await basePrisma.brand.findUnique({ where: { id: brandId } });
  if (!brand) throw new AppError('Brand not found', 404);
  if (role !== 'SUPER_ADMIN' && !(role === 'OWNER' && await basePrisma.brandOwner.findUnique({ where: { brandId_userId: { brandId, userId } } }))) throw new AppError('Brand not found', 404);
  return brand;
}
async function brandView(id: string) {
  const brand = await basePrisma.brand.findUniqueOrThrow({ where: { id }, include: { branches: { orderBy: { name: 'asc' } }, owners: { select: { user: { select: { id: true, name: true, email: true } } } } } });
  const counts = await basePrisma.student.groupBy({ by: ['schoolId'], where: { schoolId: { in: brand.branches.map(b => b.id) }, status: 'ACTIVE' }, _count: true });
  const payments = await basePrisma.brandLicencePayment.findMany({ where: { brandId: id }, orderBy: { createdAt: 'desc' }, take: 24 });
  return { ...brand, licence: evaluateLicence(brand, dayInTimezone(brand.timezone)), branches: brand.branches.map(b => ({ ...b, activeStudents: counts.find(c => c.schoolId === b.id)?._count ?? 0 })), owners: brand.owners.map(o => o.user), payments };
}

router.get('/', handler(async (req, res) => {
  const actor = me(req);
  if (!['SUPER_ADMIN', 'OWNER'].includes(actor.role)) throw new AppError('Access denied', 403);
  const brands = await basePrisma.brand.findMany({ where: actor.role === 'SUPER_ADMIN' ? {} : { owners: { some: { userId: actor.id } } }, select: { id: true }, orderBy: { name: 'asc' } });
  return sendSuccess(res, await Promise.all(brands.map(b => brandView(b.id))));
}));
router.post('/', can('platform.manage'), handler(async (req, res) => {
  const b = parseBody(z.object({ name: z.string().min(2).max(150), code: slug, logoUrl: url.optional(), licence: licenceBody.optional(), owner: ownerBody, branch: branchBody }), req);
  assertStrongPassword(b.owner.password, b.owner);
  const password = await hashPassword(b.owner.password);
  const brand = await basePrisma.$transaction(async tx => {
    const brand = await tx.brand.create({ data: { name: b.name, code: b.code, logoUrl: b.logoUrl, ...licenceData(b.licence ?? {}) } });
    const { academicYear, ...branch } = b.branch;
    const school = await tx.school.create({ data: { ...branch, brandId: brand.id, currency: brand.currency, timezone: brand.timezone } });
    const owner = await tx.user.create({ data: { ...b.owner, email: b.owner.email.toLowerCase(), password, role: 'OWNER', schoolId: school.id, mustChangePassword: true } });
    await tx.brandOwner.create({ data: { brandId: brand.id, userId: owner.id } });
    await tx.academicYear.create({ data: { schoolId: school.id, name: academicYear.name, startDate: toDate(academicYear.startDate), endDate: toDate(academicYear.endDate), isCurrent: true } });
    await tx.designation.createMany({ data: DEFAULT_DESIGNATIONS.map(name => ({ schoolId: school.id, name })) });
    return brand;
  });
  await audit(req, { action: 'Brand created', entity: 'brands', entityId: brand.id, meta: { name: brand.name } });
  return sendSuccess(res, await brandView(brand.id), 'Brand and first branch created', 201);
}));
router.get('/:id', handler(async (req, res) => {
  await authorizedBrand(me(req).id, me(req).role, req.params.id);
  return sendSuccess(res, await brandView(req.params.id));
}));
router.patch('/:id', handler(async (req, res) => {
  const actor = me(req);
  await authorizedBrand(actor.id, actor.role, req.params.id);
  const b = parseBody(z.object({ name: z.string().min(2).max(150).optional(), logoUrl: url.optional(), isActive: z.boolean().optional() }).strict(), req);
  if (b.isActive !== undefined && actor.role !== 'SUPER_ADMIN') throw new AppError('Only the platform may suspend a brand', 403);
  await basePrisma.brand.update({ where: { id: req.params.id }, data: b });
  forgetLicence(req.params.id);
  if (b.isActive === false) for (const s of await basePrisma.school.findMany({ where: { brandId: req.params.id }, select: { id: true } })) await endSchoolSessions(s.id);
  await audit(req, { action: 'Brand updated', entity: 'brands', entityId: req.params.id, meta: b });
  return sendSuccess(res, await brandView(req.params.id));
}));
router.patch('/:id/licence', can('platform.manage'), handler(async (req, res) => {
  await authorizedBrand(me(req).id, me(req).role, req.params.id);
  const b = parseBody(licenceBody, req);
  await basePrisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM brands WHERE id = ${req.params.id} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM schools WHERE brandId = ${req.params.id} FOR UPDATE`;
    const branches = await tx.school.findMany({ where: { brandId: req.params.id }, select: { id: true } });
    if (b.maxBranches != null && branches.length > b.maxBranches) throw new AppError('Branch limit cannot be below existing branch count', 409);
    if (b.maxStudents != null) {
      const counts = await tx.student.groupBy({ by: ['schoolId'], where: { schoolId: { in: branches.map(s => s.id) }, status: 'ACTIVE' }, _count: true });
      if (counts.some(c => c._count > b.maxStudents!)) throw new AppError('Student limit cannot be below active students in any branch', 409);
    }
    await tx.brand.update({ where: { id: req.params.id }, data: licenceData(b) });
  });
  forgetLicence(req.params.id);
  await audit(req, { action: 'Brand licence updated', entity: 'brands', entityId: req.params.id, meta: b });
  return sendSuccess(res, await brandView(req.params.id), 'Brand licence saved');
}));
router.post('/:id/branches', can('platform.manage'), handler(async (req, res) => {
  const b = parseBody(branchBody, req);
  const branch = await basePrisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM brands WHERE id = ${req.params.id} FOR UPDATE`;
    const brand = await tx.brand.findUnique({ where: { id: req.params.id } });
    if (!brand) throw new AppError('Brand not found', 404);
    if (!brand.isActive || evaluateLicence(brand, dayInTimezone(brand.timezone)).state === 'LOCKED') throw new AppError('Brand is suspended or its licence is locked', 409);
    if (brand.maxBranches !== null && await tx.school.count({ where: { brandId: brand.id } }) >= brand.maxBranches) throw new AppError(`This brand licence allows ${brand.maxBranches} branches`, 409);
    const { academicYear, ...fields } = b;
    const s = await tx.school.create({ data: { ...fields, brandId: brand.id, timezone: brand.timezone, currency: brand.currency } });
    await tx.academicYear.create({ data: { schoolId: s.id, name: academicYear.name, startDate: toDate(academicYear.startDate), endDate: toDate(academicYear.endDate), isCurrent: true } });
    await tx.designation.createMany({ data: DEFAULT_DESIGNATIONS.map(name => ({ schoolId: s.id, name })) });
    return s;
  });
  await audit(req, { action: 'Branch created', entity: 'brands', entityId: req.params.id, meta: { branchId: branch.id, name: branch.name } });
  return sendSuccess(res, branch, 'Branch created', 201);
}));
router.post('/:id/owners', can('platform.manage'), handler(async (req, res) => {
  const { userId } = parseBody(z.object({ userId: z.string().uuid() }).strict(), req);
  const brand = await authorizedBrand(me(req).id, me(req).role, req.params.id);
  const user = await basePrisma.user.findUnique({ where: { id: userId }, include: { school: true } });
  if (!user || user.role !== 'OWNER' || user.school?.brandId !== brand.id) throw new AppError('Choose an owner login belonging to this brand', 422);
  await basePrisma.brandOwner.upsert({ where: { brandId_userId: { brandId: brand.id, userId } }, create: { brandId: brand.id, userId }, update: {} });
  await audit(req, { action: 'Brand owner assigned', entity: 'brands', entityId: brand.id, meta: { userId } });
  return sendSuccess(res, null, 'Owner assigned');
}));
router.get('/:id/access', handler(async (req, res) => {
  await authorizedBrand(me(req).id, me(req).role, req.params.id);
  const users = await basePrisma.user.findMany({ where: { school: { brandId: req.params.id }, role: { in: ['PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER'] } }, select: { id: true, name: true, role: true, schoolId: true } });
  const access = await basePrisma.branchAccess.findMany({ where: { school: { brandId: req.params.id } } });
  const [staff, customRoles] = await Promise.all([
    basePrisma.staff.findMany({ where: { schoolId: { in: (await basePrisma.school.findMany({ where: { brandId: req.params.id }, select: { id: true } })).map(s => s.id) }, userId: null, status: { in: ['ACTIVE', 'TEMPORARY_LEAVE'] } }, select: { id: true, schoolId: true, name: true }, take: 500 }),
    basePrisma.customRole.findMany({ where: { schoolId: { in: (await basePrisma.school.findMany({ where: { brandId: req.params.id }, select: { id: true } })).map(s => s.id) } }, select: { id: true, schoolId: true, name: true, baseRole: true } }),
  ]);
  return sendSuccess(res, { users, access, staff, customRoles });
}));
router.put('/:id/access', handler(async (req, res) => {
  await authorizedBrand(me(req).id, me(req).role, req.params.id);
  const b = parseBody(z.object({ schoolId: z.string().uuid(), userId: z.string().uuid(), role: z.enum(['PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER']), customRoleId: z.string().uuid().nullable().optional(), staffId: z.string().uuid().nullable().optional() }).strict(), req);
  const [school, user] = await Promise.all([basePrisma.school.findFirst({ where: { id: b.schoolId, brandId: req.params.id } }), basePrisma.user.findFirst({ where: { id: b.userId, school: { brandId: req.params.id }, role: { in: ['PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER'] } } })]);
  if (!school || !user) throw new AppError('User or branch not found in this brand', 404);
  if (user.schoolId === school.id) throw new AppError('Manage the home branch role from Users & logins', 422);
  if (b.customRoleId && !await basePrisma.customRole.findFirst({ where: { id: b.customRoleId, schoolId: school.id, baseRole: b.role } })) throw new AppError('Custom role does not belong to this branch or base role', 422);
  if (b.staffId && !await basePrisma.staff.findFirst({ where: { id: b.staffId, schoolId: school.id, userId: null, status: { in: ['ACTIVE', 'TEMPORARY_LEAVE'] } } })) throw new AppError('Choose an active unlinked HR profile in the target branch', 422);
  await basePrisma.branchAccess.upsert({ where: { schoolId_userId: { schoolId: school.id, userId: user.id } }, create: { ...b }, update: { role: b.role, customRoleId: b.customRoleId ?? null, staffId: b.staffId ?? null } });
  forgetCustomRoles(school.id);
  await endAllSessions(user.id);
  await audit(req, { action: 'Branch access assigned', entity: 'brands', entityId: req.params.id, meta: b });
  return sendSuccess(res, null, 'Access assigned; the user must sign in again');
}));
router.delete('/:id/access/:accessId', handler(async (req, res) => {
  await authorizedBrand(me(req).id, me(req).role, req.params.id);
  const a = await basePrisma.branchAccess.findFirst({ where: { id: req.params.accessId, school: { brandId: req.params.id } } });
  if (!a) throw new AppError('Branch access not found', 404);
  await basePrisma.branchAccess.delete({ where: { id: a.id } });
  await endAllSessions(a.userId);
  await audit(req, { action: 'Branch access removed', entity: 'brands', entityId: req.params.id, meta: { userId: a.userId, schoolId: a.schoolId } });
  return sendSuccess(res, null, 'Access removed');
}));
router.get('/:id/summary', handler(async (req, res) => {
  await authorizedBrand(me(req).id, me(req).role, req.params.id);
  const view = await brandView(req.params.id);
  const ids = view.branches.map(s => s.id);
  const [staff, fees, expenses, income] = await Promise.all([
    basePrisma.staff.groupBy({ by: ['schoolId'], where: { schoolId: { in: ids }, status: { in: ['ACTIVE', 'TEMPORARY_LEAVE'] } }, _count: true }),
    basePrisma.payment.groupBy({ by: ['schoolId'], where: { schoolId: { in: ids }, status: 'SUCCESS' }, _sum: { amount: true } }),
    basePrisma.expense.groupBy({ by: ['schoolId'], where: { schoolId: { in: ids }, status: 'APPROVED' }, _sum: { amount: true } }),
    basePrisma.otherIncome.groupBy({ by: ['schoolId'], where: { schoolId: { in: ids } }, _sum: { amount: true } }),
  ]);
  return sendSuccess(res, { brand: { id: view.id, name: view.name, currency: view.currency }, branches: view.branches.map(b => ({ id: b.id, name: b.name, isActive: b.isActive, activeStudents: b.activeStudents, activeStaff: staff.find(s => s.schoolId === b.id)?._count ?? 0, feeCollections: fees.find(s => s.schoolId === b.id)?._sum.amount ?? 0, expenses: expenses.find(s => s.schoolId === b.id)?._sum.amount ?? 0, otherIncome: income.find(s => s.schoolId === b.id)?._sum.amount ?? 0 })) });
}));
router.post('/:id/licence/payments', can('platform.manage'), handler(async (req, res) => {
  const b = parseBody(z.object({ amount: z.number().positive().max(100_000_000), paidOn: dateOnly, paidUntil: dateOnly, method: z.string().max(40).optional(), reference: z.string().max(100).optional(), note: z.string().max(300).optional() }).strict(), req);
  await basePrisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM brands WHERE id = ${req.params.id} FOR UPDATE`;
    const brand = await tx.brand.findUniqueOrThrow({ where: { id: req.params.id } });
    if (b.paidUntil < b.paidOn || (brand.licencePaidUntil && b.paidUntil <= toIso(brand.licencePaidUntil))) throw new AppError('Choose a later paid-until date', 422);
    await tx.brandLicencePayment.create({ data: { brandId: brand.id, amount: b.amount, paidOn: toDate(b.paidOn), coversUntil: toDate(b.paidUntil), paidUntilBefore: brand.licencePaidUntil, currency: brand.currency, recordedById: me(req).id, method: b.method, reference: b.reference, note: b.note } });
    await tx.brand.update({ where: { id: brand.id }, data: { licencePaidUntil: toDate(b.paidUntil) } });
  });
  forgetLicence(req.params.id);
  await audit(req, { action: 'Brand licence payment recorded', entity: 'brands', entityId: req.params.id, meta: b });
  return sendSuccess(res, await brandView(req.params.id), 'Brand licence renewed', 201);
}));
router.delete('/:id/licence/payments/:paymentId', can('platform.manage'), handler(async (req, res) => {
  await basePrisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM brands WHERE id = ${req.params.id} FOR UPDATE`;
    const latest = await tx.brandLicencePayment.findFirst({ where: { brandId: req.params.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    if (!latest || latest.id !== req.params.paymentId) throw new AppError('Only the latest brand licence payment can be removed', 409);
    await tx.brandLicencePayment.delete({ where: { id: latest.id } });
    await tx.brand.update({ where: { id: req.params.id }, data: { licencePaidUntil: latest.paidUntilBefore } });
  });
  forgetLicence(req.params.id);
  await audit(req, { action: 'Brand licence payment removed', entity: 'brands', entityId: req.params.id, meta: { paymentId: req.params.paymentId } });
  return sendSuccess(res, await brandView(req.params.id), 'Latest payment removed');
}));
export default router;
