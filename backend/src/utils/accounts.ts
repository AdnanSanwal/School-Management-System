import { hashPassword } from './password';
import crypto from 'crypto';
import type { Role } from '@prisma/client';
import type { ScopedTx } from '../config/database';
import { currentSchoolId } from '../config/tenancy';
import { AppError } from '../middleware/errorHandler';
import { basePrisma } from '../config/database';
import { normalizeUsername, usernameProblem, isUsernameTaken } from './usernames';
import { tenantStorage, RoleOverrides } from '../config/tenancy';
import { forgetCustomRoles } from './rolePermissions';
import { assertStrongPassword } from './passwordPolicy';
import { effectivePermissions } from '../middleware/rbac';

/**
 * Who may create and manage which logins.
 *  - The owner manages every school role, including other owners.
 *  - For the staff roles the owner decides (Settings → Roles & permissions). CREATE_OPTIONS
 *    lists what each role can be allowed; CREATE_STANDARD is what it has until the owner changes it.
 *  - Parents and students never create logins.
 * A school's choices are stored with its role settings as "create:<ROLE>" entries.
 */
export const CREATE_OPTIONS: Partial<Record<Role, Role[]>> = {
  PRINCIPAL: ['ADMIN', 'ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT'],
  ADMIN: ['ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT'],
  ACCOUNTANT: ['TEACHER', 'PARENT', 'STUDENT'],
  TEACHER: ['PARENT', 'STUDENT'],
};
export const CREATE_STANDARD: Partial<Record<Role, Role[]>> = {
  PRINCIPAL: ['ADMIN', 'ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT'],
  ADMIN: ['ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT'],
};
export const createKey = (role: string) => `create:${role}`;
const SCHOOL_ROLES: Role[] = ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT'];

/** The roles this role may create logins for, with the school's own settings applied. */
export function creatableRoles(actorRole: string, overrides?: RoleOverrides): Role[] {
  if (actorRole === 'OWNER') return SCHOOL_ROLES;
  const options = CREATE_OPTIONS[actorRole as Role];
  if (!options) return [];
  const standard = CREATE_STANDARD[actorRole as Role] ?? [];
  const o = overrides?.[actorRole];
  return options.filter((r) => (standard.includes(r) && !o?.revoke.has(createKey(r))) || !!o?.grant.has(createKey(r)));
}

export function canManageRole(actorRole: string, target: Role): boolean {
  if (target === 'SUPER_ADMIN') return false;
  const ctx = tenantStorage.getStore();
  if (!creatableRoles(actorRole, ctx?.kind === 'tenant' ? ctx.roles : undefined).includes(target)) return false;
  // Someone whose custom role was deliberately limited must not reach more by creating or
  // resetting a login of another role (SECURITY_FINDINGS AUTHZ-1): every permission of the
  // target role has to be one they already hold.
  if (ctx?.kind === 'tenant' && ctx.custom && ctx.custom.role === actorRole) {
    const mine = ctx.custom.perms;
    return effectivePermissions(target, ctx.roles).every((p) => mine.has(p));
  }
  return true;
}

/** Same rule for giving someone a school-defined role. */
export function canGrantPermissions(perms: Iterable<string>): boolean {
  const ctx = tenantStorage.getStore();
  if (ctx?.kind !== 'tenant' || !ctx.custom) return true;
  for (const p of perms) if (!ctx.custom.perms.has(p)) return false;
  return true;
}

export function assertCanManageRole(actorRole: string, target: Role) {
  if (!canManageRole(actorRole, target)) throw new AppError(`You cannot manage ${target} accounts`, 403);
}

/** The custom role must belong to this school and be built on the login's role. */
export async function assertCustomRole(customRoleId: string, role: Role) {
  const r = await basePrisma.customRole.findFirst({ where: { id: customRoleId, schoolId: currentSchoolId() }, select: { baseRole: true, name: true, permissions: true } });
  if (!r) throw new AppError('That role no longer exists', 422);
  if (r.baseRole !== role) throw new AppError(`“${r.name}” is built on a different role`, 422);
  if (!canGrantPermissions(Array.isArray(r.permissions) ? (r.permissions as string[]) : [])) throw new AppError(`You cannot give the “${r.name}” role`, 403);
}

/**
 * Readable one-time password, e.g. "Kite-Moon-Rose-482913" (about 38 bits: 64³ words ×
 * 900,000 numbers), shown once to the admin. The person must replace it at first sign-in,
 * and the per-account sign-in limit stops guessing long before it could be found.
 */
const WORDS = ['Kite', 'Moon', 'Lake', 'Star', 'Rose', 'Hill', 'Tree', 'Bird', 'Rain', 'Sand', 'Leaf', 'Wave', 'Snow', 'Fire', 'Gold', 'Mint',
  'Pine', 'Reef', 'Sky', 'Sun', 'Wind', 'Bear', 'Deer', 'Fox', 'Hawk', 'Lion', 'Owl', 'Wolf', 'Swan', 'Crow', 'Dove', 'Lark',
  'Apple', 'Berry', 'Cedar', 'Daisy', 'Ember', 'Fern', 'Grape', 'Honey', 'Iris', 'Jade', 'Lemon', 'Maple', 'Olive', 'Pearl', 'Plum', 'Ruby',
  'Sage', 'Tulip', 'Coral', 'River', 'Stone', 'Cloud', 'Brook', 'Field', 'Ocean', 'Cliff', 'Shore', 'Spark', 'Light', 'Frost', 'Storm', 'Dawn'];
export function temporaryPassword(): string {
  const w = () => WORDS[crypto.randomInt(WORDS.length)];
  return `${w()}-${w()}-${w()}-${crypto.randomInt(100000, 1000000)}`;
}

export interface NewAccount {
  name: string;
  /** At least one of email / username is needed to sign in. */
  email?: string | null;
  username?: string | null;
  phone?: string | null;
  role: Role;
  /** A school-defined role built on `role` (Settings → Roles & permissions). */
  customRoleId?: string | null;
  password?: string;
}

/**
 * Creates a login in the current school. Returns the generated password when
 * none was given so the office can hand it to the person.
 */
export async function createAccount(tx: Pick<ScopedTx, 'user'>, actorRole: string, a: NewAccount) {
  assertCanManageRole(actorRole, a.role);
  if (a.customRoleId) await assertCustomRole(a.customRoleId, a.role);
  const email = a.email ? a.email.toLowerCase().trim() : null;
  const username = a.username ? normalizeUsername(a.username) : null;
  if (!email && !username) throw new AppError('Give the login a username or an email', 422);
  if (username) {
    const problem = usernameProblem(username);
    if (problem) throw new AppError(problem, 422);
    if (await isUsernameTaken(username)) throw new AppError(`Username “${username}” is already taken. Choose another.`, 409);
  }
  // Emails are unique across the platform too (checked unscoped, like usernames).
  if (email && await basePrisma.user.findFirst({ where: { email }, select: { id: true } })) {
    throw new AppError(`${email} already has a login`, 409);
  }
  if (a.password) assertStrongPassword(a.password, { email, username, name: a.name });
  const plain = a.password ?? temporaryPassword();
  const user = await tx.user.create({
    data: {
      schoolId: currentSchoolId(),
      name: a.name,
      email,
      username,
      phone: a.phone ?? null,
      role: a.role,
      customRoleId: a.customRoleId || null,
      password: await hashPassword(plain),
      // Someone else chose this password: the person picks their own at first sign-in.
      mustChangePassword: true,
    },
    select: { id: true, name: true, email: true, username: true, role: true },
  });
  if (a.customRoleId) forgetCustomRoles(currentSchoolId());
  return { user, temporaryPassword: a.password ? undefined : plain };
}
