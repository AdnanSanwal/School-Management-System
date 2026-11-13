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
import { changeable, CUSTOM_ROLES, customChoices, customRoleList, EDITABLE_ROLES, forgetCustomRoles, forgetRoleOverrides, permissionList, PERMISSION_INFO, roleOverrides } from '../../utils/rolePermissions';
import { audit } from '../../utils/audit';

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
    ...(await customMatrix()),
  };
}

// ─── Custom roles: the school's own access roles (e.g. Receptionist, Librarian) ───

async function customMatrix() {
  const list = await customRoleList(currentSchoolId());
  const counts = await prisma.user.groupBy({ by: ['customRoleId'], where: { isActive: true, customRoleId: { not: null } }, _count: true });
  return {
    custom: list.map((r) => ({
      id: r.id, name: r.name, baseRole: r.baseRole, baseLabel: label(r.baseRole),
      permissions: customChoices(r.baseRole).filter((p) => r.perms.has(p)),
      users: counts.find((c) => c.customRoleId === r.id)?._count ?? 0,
    })),
    // What can be ticked for a custom role, by the role it is built on.
    customChoices: Object.fromEntries(CUSTOM_ROLES.map((base) => [base, customChoices(base).map((key) => ({ key, ...PERMISSION_INFO[key]! }))])),
    customBases: CUSTOM_ROLES.map((r) => ({ role: r, label: label(r), about: ROLE_INFO[r].about })),
  };
}

const customBody = z.object({
  name: z.string().trim().min(2, 'Give the role a name').max(60),
  baseRole: z.enum(['PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER']),
  permissions: z.array(z.string().max(60)).max(200),
});

function cleanCustom(b: { name: string; baseRole: Role; permissions: string[] }) {
  if (Object.values(ROLE_INFO).some((i) => i.label.toLowerCase() === b.name.toLowerCase()) || ALL_ROLES.includes(b.name.toUpperCase() as Role)) {
    throw new AppError(`“${b.name}” is already a standard role — choose another name`, 409);
  }
  const choices = customChoices(b.baseRole);
  const bad = b.permissions.find((p) => !(choices as string[]).includes(p));
  if (bad) throw new AppError(PERMISSION_INFO[bad as keyof typeof PERMISSION_INFO] ? `“${PERMISSION_INFO[bad as keyof typeof PERMISSION_INFO]!.label}” can’t be given to a role built on ${label(b.baseRole).toLowerCase()}` : `Unknown permission: ${bad}`, 422);
  return [...new Set(b.permissions)];
}

async function nameTaken(name: string, exceptId?: string) {
  const other = await prisma.customRole.findFirst({ where: { name, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
  if (other) throw new AppError(`There is already a role called “${name}”`, 409);
}

router.post('/custom', handler(async (req, res) => {
  const b = parseBody(customBody, req);
  const permissions = cleanCustom(b);
  await nameTaken(b.name);
  const row = await prisma.customRole.create({ data: { schoolId: currentSchoolId(), name: b.name, baseRole: b.baseRole, permissions } });
  forgetCustomRoles(currentSchoolId());
  await audit(req, { action: 'Custom role created', entity: 'roles', entityId: row.id, meta: { name: b.name, baseRole: b.baseRole, permissions } });
  return sendSuccess(res, await matrix(), `Role “${b.name}” created`, 201);
}));

router.put('/custom/:id', handler(async (req, res) => {
  const existing = await prisma.customRole.findFirst({ where: { id: req.params.id } });
  if (!existing) throw new AppError('Role not found', 404);
  const b = parseBody(customBody.omit({ baseRole: true }), req);
  const permissions = cleanCustom({ ...b, baseRole: existing.baseRole });
  await nameTaken(b.name, existing.id);
  await prisma.customRole.update({ where: { id: existing.id }, data: { name: b.name, permissions } });
  forgetCustomRoles(currentSchoolId());
  await audit(req, { action: 'Custom role changed', entity: 'roles', entityId: existing.id, meta: { name: b.name, previousName: existing.name, permissions, previousPermissions: existing.permissions } });
  return sendSuccess(res, await matrix(), `Role “${b.name}” saved`);
}));

/** Deleting a role keeps its people: they go back to the standard role it was built on. */
router.delete('/custom/:id', handler(async (req, res) => {
  const existing = await prisma.customRole.findFirst({ where: { id: req.params.id } });
  if (!existing) throw new AppError('Role not found', 404);
  const moved = await transaction(async (tx) => {
    const r = await tx.user.updateMany({ where: { customRoleId: existing.id }, data: { customRoleId: null } });
    const shared = await tx.branchAccess.updateMany({ where: { customRoleId: existing.id }, data: { customRoleId: null } });
    await tx.customRole.delete({ where: { id: existing.id } });
    return r.count + shared.count;
  });
  forgetCustomRoles(currentSchoolId());
  await audit(req, { action: 'Custom role deleted', entity: 'roles', entityId: existing.id, meta: { name: existing.name, baseRole: existing.baseRole, usersMoved: moved } });
  return sendSuccess(res, await matrix(), moved ? `Role “${existing.name}” deleted — ${moved} ${moved > 1 ? 'people are' : 'person is'} now ${label(existing.baseRole).toLowerCase()}` : `Role “${existing.name}” deleted`);
}));

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
  forgetCustomRoles(schoolId);
  const m = await matrix();
  const changed = m.roles.find((r) => r.role === role)!.changed;
  return sendSuccess(res, m, changed ? `${label(role)} saved (${changed} change${changed > 1 ? 's' : ''} from the standard set)` : `${label(role)} is back to the standard set`);
}));

router.post('/:role/reset', handler(async (req, res) => {
  const role = roleParam(req.params.role);
  await prisma.rolePermission.deleteMany({ where: { role } });
  forgetRoleOverrides(currentSchoolId());
  forgetCustomRoles(currentSchoolId());
  return sendSuccess(res, await matrix(), `${label(role)} is back to the standard set`);
}));

export default router;
