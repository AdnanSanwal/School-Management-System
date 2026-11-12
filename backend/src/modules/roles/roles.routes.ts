import { Router } from 'express';
import { z } from 'zod';
import type { Role } from '@prisma/client';
import prisma, { transaction } from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { authenticate } from '../../middleware/auth';
import { can, effectivePermissions, ROLE_PERMISSIONS } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { handler, parseBody } from '../../utils/http';
import { CREATE_OPTIONS, CREATE_STANDARD, creatableRoles, createKey } from '../../utils/accounts';
import { changeable, CUSTOM_ROLES, EDITABLE_ROLES, forgetRoleOverrides, permissionList, roleOverrides } from '../../utils/rolePermissions';

// Roles & permissions: the owner decides what each role may do in this school, and
// which logins each staff role may create.

const router = Router();
router.use(authenticate, can('roles.manage'));

const ROLE_INFO: Record<string, { label: string; about: string }> = {
  OWNER: { label: 'Owner', about: 'Full access to everything in the school. Cannot be limited.' },
  PRINCIPAL: { label: 'Principal', about: 'Academic and administrative head; approvals' },
  ADMIN: { label: 'Office admin', about: 'Admissions, records, staff and day-to-day office work' },
  ACCOUNTANT: { label: 'Accountant', about: 'Fees, expenses, payroll and the books' },
  TEACHER: { label: 'Teacher', about: 'Works inside their own classes: attendance, marks, diary' },
  PARENT: { label: 'Parent', about: 'Sees only their own children, in the app' },
  STUDENT: { label: 'Student', about: 'Sees only their own record, in the app' },
};
const ALL_ROLES: Role[] = ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT'];
const label = (role: string) => ROLE_INFO[role].label;

function roleParam(value: string): Role {
  if (!(EDITABLE_ROLES as string[]).includes(value)) throw new AppError(value === 'OWNER' ? 'The owner always has full access' : 'This role can’t be changed', 404);
  return value as Role;
}

async function matrix() {
  const overrides = await roleOverrides(currentSchoolId());
  const users = await prisma.user.groupBy({ by: ['role'], where: { isActive: true }, _count: true });
  const count = (role: string) => users.find((u) => u.role === role)?._count ?? 0;
  return {
    roles: ALL_ROLES.map((role) => {
      const base = { role, ...ROLE_INFO[role], users: count(role) };
      if (role === 'OWNER') {
        return { ...base, editable: false, changed: 0, permissions: [], creates: ALL_ROLES.map((r) => ({ role: r, label: label(r), standard: true, allowed: true, available: false })) };
      }
      const has = new Set<string>(effectivePermissions(role, overrides));
      const permissions = permissionList(role).map((p) => ({
        ...p, standard: ROLE_PERMISSIONS[role].has(p.key), granted: has.has(p.key), available: changeable(role, p.key),
      }));
      const now = creatableRoles(role, overrides);
      const creates = (CREATE_OPTIONS[role] ?? []).map((r) => ({
        role: r, label: label(r), standard: (CREATE_STANDARD[role] ?? []).includes(r), allowed: now.includes(r), available: true,
      }));
      return {
        ...base, editable: true, permissions, creates,
        changed: permissions.filter((p) => p.standard !== p.granted).length + creates.filter((c) => c.standard !== c.allowed).length,
      };
    }),
  };
}

router.get('/', handler(async (_req, res) => sendSuccess(res, await matrix())));

/**
 * Saves what the role may do (`permissions`) and which logins it may create (`creates`).
 * Both are the full lists; only the differences from the standard set are stored.
 */
router.put('/:role', handler(async (req, res) => {
  const role = roleParam(req.params.role);
  const b = parseBody(z.object({ permissions: z.array(z.string().max(60)).max(200), creates: z.array(z.string().max(20)).max(10).optional() }), req);
  const list = permissionList(role);
  const wanted = new Set(b.permissions);
  const unknown = b.permissions.find((p) => !list.some((x) => x.key === p));
  if (unknown) throw new AppError(`Unknown permission: ${unknown}`, 422);

  const rows: { permission: string; granted: boolean }[] = [];
  for (const p of list) {
    const standard = ROLE_PERMISSIONS[role].has(p.key);
    if (wanted.has(p.key) === standard) continue;
    if (!changeable(role, p.key)) {
      throw new AppError(wanted.has(p.key) ? `“${p.label}” can’t be given to ${label(role).toLowerCase()}s` : `“${p.label}” can’t be taken from ${label(role).toLowerCase()}s`, 422);
    }
    rows.push({ permission: p.key, granted: wanted.has(p.key) });
  }

  // Which logins the role may create.
  const options = CREATE_OPTIONS[role] ?? [];
  // Left out = keep what the role may create today.
  const creates: string[] = b.creates ?? creatableRoles(role, await roleOverrides(currentSchoolId()));
  const bad = creates.find((r) => !(options as string[]).includes(r));
  if (bad) throw new AppError(`${label(role)}s can’t be allowed to create ${ROLE_INFO[bad]?.label.toLowerCase() ?? bad} logins`, 422);
  for (const r of options) {
    const standard = (CREATE_STANDARD[role] ?? []).includes(r);
    if (creates.includes(r) !== standard) rows.push({ permission: createKey(r), granted: creates.includes(r) });
  }
  // Being able to create any login is what opens "Users & logins" (and resetting passwords) for the role.
  if ((CUSTOM_ROLES as string[]).includes(role)) {
    const standard = ROLE_PERMISSIONS[role].has('users.manage');
    if ((creates.length > 0) !== standard) rows.push({ permission: 'users.manage', granted: creates.length > 0 });
  }

  const schoolId = currentSchoolId();
  await transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { role } });
    if (rows.length) await tx.rolePermission.createMany({ data: rows.map((r) => ({ schoolId, role, ...r })) });
  });
  forgetRoleOverrides(schoolId);
  const m = await matrix();
  const changed = m.roles.find((r) => r.role === role)!.changed;
  return sendSuccess(res, m, changed ? `${label(role)} saved (${changed} change${changed > 1 ? 's' : ''} from the standard set)` : `${label(role)} is back to the standard set`);
}));

router.post('/:role/reset', handler(async (req, res) => {
  const role = roleParam(req.params.role);
  await prisma.rolePermission.deleteMany({ where: { role } });
  forgetRoleOverrides(currentSchoolId());
  return sendSuccess(res, await matrix(), `${label(role)} is back to the standard set`);
}));

export default router;
