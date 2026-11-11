import { Router } from 'express';
import { z } from 'zod';
import type { Role } from '@prisma/client';
import prisma, { transaction } from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { authenticate } from '../../middleware/auth';
import { can, effectivePermissions, Permission, ROLE_PERMISSIONS } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { handler, parseBody } from '../../utils/http';
import { CUSTOM_ROLES, forgetRoleOverrides, grantable, PERMISSION_INFO, roleOverrides, TUNABLE } from '../../utils/rolePermissions';

// Roles & permissions: the owner tunes what each staff role may do in this school.

const router = Router();
router.use(authenticate, can('roles.manage'));

const ROLE_INFO: Record<string, { label: string; about: string }> = {
  PRINCIPAL: { label: 'Principal', about: 'Academic and administrative head; approvals' },
  ADMIN: { label: 'Office admin', about: 'Admissions, records, staff and day-to-day office work' },
  ACCOUNTANT: { label: 'Accountant', about: 'Fees, expenses, payroll and the books' },
  TEACHER: { label: 'Teacher', about: 'Works inside their own classes: attendance, marks, diary' },
};

function roleParam(value: string): Role {
  if (!(CUSTOM_ROLES as string[]).includes(value)) throw new AppError('This role can’t be changed', 404);
  return value as Role;
}

async function matrix() {
  const overrides = await roleOverrides(currentSchoolId());
  const users = await prisma.user.groupBy({ by: ['role'], where: { isActive: true }, _count: true });
  return {
    modules: [...new Set(TUNABLE.map((p) => PERMISSION_INFO[p]!.module))],
    roles: CUSTOM_ROLES.map((role) => {
      const has = new Set(effectivePermissions(role, overrides));
      const permissions = TUNABLE.map((p) => ({
        key: p, ...PERMISSION_INFO[p]!, standard: ROLE_PERMISSIONS[role].has(p), granted: has.has(p), available: grantable(role, p),
      }));
      return {
        role, ...ROLE_INFO[role], users: users.find((u) => u.role === role)?._count ?? 0,
        changed: permissions.filter((p) => p.standard !== p.granted).length, permissions,
      };
    }),
  };
}

router.get('/', handler(async (_req, res) => sendSuccess(res, await matrix())));

/** Saves the full list of what the role may do; only the differences from the standard set are stored. */
router.put('/:role', handler(async (req, res) => {
  const role = roleParam(req.params.role);
  const b = parseBody(z.object({ permissions: z.array(z.string().max(60)).max(200) }), req);
  const wanted = new Set(b.permissions);
  const unknown = b.permissions.find((p) => !(TUNABLE as string[]).includes(p));
  if (unknown) throw new AppError(`Unknown permission: ${unknown}`, 422);
  const rows: { permission: Permission; granted: boolean }[] = [];
  for (const p of TUNABLE) {
    const standard = ROLE_PERMISSIONS[role].has(p);
    if (wanted.has(p) === standard) continue;
    if (wanted.has(p) && !grantable(role, p)) throw new AppError(`“${PERMISSION_INFO[p]!.label}” can’t be given to ${ROLE_INFO[role].label.toLowerCase()}s`, 422);
    rows.push({ permission: p, granted: wanted.has(p) });
  }
  const schoolId = currentSchoolId();
  await transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { role } });
    if (rows.length) await tx.rolePermission.createMany({ data: rows.map((r) => ({ schoolId, role, ...r })) });
  });
  forgetRoleOverrides(schoolId);
  return sendSuccess(res, await matrix(), rows.length ? `${ROLE_INFO[role].label} permissions saved (${rows.length} change${rows.length > 1 ? 's' : ''} from the standard set)` : `${ROLE_INFO[role].label} is back to the standard set`);
}));

router.post('/:role/reset', handler(async (req, res) => {
  const role = roleParam(req.params.role);
  await prisma.rolePermission.deleteMany({ where: { role } });
  forgetRoleOverrides(currentSchoolId());
  return sendSuccess(res, await matrix(), `${ROLE_INFO[role].label} is back to the standard set`);
}));

export default router;
