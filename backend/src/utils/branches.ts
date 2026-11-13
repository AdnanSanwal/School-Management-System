import { basePrisma } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import type { JwtPayload } from './jwt';

/** Every request revalidates branch access. A signed token alone never grants membership. */
export async function branchIdentity(userId: string, schoolId: string) {
  const [user, school] = await Promise.all([
    basePrisma.user.findUnique({ where: { id: userId } }),
    basePrisma.school.findUnique({ where: { id: schoolId }, include: { brand: true } }),
  ]);
  if (!user?.isActive || user.role === 'SUPER_ADMIN' || !school) throw new AppError('Branch access denied', 403);
  if (!school.isActive || school.brand?.isActive === false) throw new AppError('Branch or brand is suspended', 403);
  const owner = school.brandId && user.role === 'OWNER'
    ? await basePrisma.brandOwner.findUnique({ where: { brandId_userId: { brandId: school.brandId, userId } } }) : null;
  if (owner) return { user, school, role: 'OWNER' as const, customRoleId: null, staffId: null };
  if (user.role === 'OWNER' && school.brandId) throw new AppError('Brand ownership is not assigned', 403);
  if (user.schoolId === schoolId) return { user, school, role: user.role, customRoleId: user.customRoleId, staffId: null };
  if (!['PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER'].includes(user.role)) throw new AppError('Branch access denied', 403);
  const access = await basePrisma.branchAccess.findUnique({ where: { schoolId_userId: { schoolId, userId } } });
  if (!access || ['OWNER', 'SUPER_ADMIN', 'PARENT', 'STUDENT'].includes(access.role)) throw new AppError('Branch access denied', 403);
  if (access.staffId && !await basePrisma.staff.findFirst({ where: { id: access.staffId, schoolId, status: { in: ['ACTIVE', 'TEMPORARY_LEAVE'] } } })) throw new AppError('Staff branch access is inactive', 403);
  return { user, school, role: access.role, customRoleId: access.customRoleId, staffId: access.staffId };
}

export async function availableBranches(userId: string) {
  const user = await basePrisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.role === 'SUPER_ADMIN') return [];
  const [owned, access] = await Promise.all([
    user.role === 'OWNER' ? basePrisma.brandOwner.findMany({ where: { userId }, select: { brandId: true } }) : [],
    basePrisma.branchAccess.findMany({ where: { userId }, select: { schoolId: true } }),
  ]);
  const schools = await basePrisma.school.findMany({
    where: { OR: [{ id: user.schoolId ?? '' }, { id: { in: access.map(a => a.schoolId) } }, { brandId: { in: owned.map(o => o.brandId) } }] },
    include: { brand: { select: { id: true, name: true, logoUrl: true, isActive: true } } }, orderBy: { name: 'asc' },
  });
  return schools.map(s => ({ id: s.id, name: s.name, code: s.code, brand: s.brand, isActive: s.isActive && s.brand?.isActive !== false }));
}

export async function validateBranchToken(payload: JwtPayload) {
  if (payload.role === 'SUPER_ADMIN') {
    const user = await basePrisma.user.findUnique({ where: { id: payload.id } });
    if (!user?.isActive || user.role !== 'SUPER_ADMIN') throw new AppError('Session ended', 401);
    return;
  }
  if (!payload.schoolId) throw new AppError('No branch selected', 401);
  const identity = await branchIdentity(payload.id, payload.schoolId);
  if (identity.role !== payload.role) throw new AppError('Branch access changed. Please sign in again.', 401);
}

/** Owners of the active branch, including brand owners with a different home branch. */
export async function branchOwners(schoolId: string) {
  const school = await basePrisma.school.findUnique({ where: { id: schoolId }, select: { brandId: true } });
  return basePrisma.user.findMany({ where: { isActive: true, role: 'OWNER', OR: [{ schoolId }, ...(school?.brandId ? [{ ownedBrands: { some: { brandId: school.brandId } } }] : [])] }, select: { id: true } });
}
