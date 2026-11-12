import { hashPassword } from './password';
import crypto from 'crypto';
import type { Role } from '@prisma/client';
import type { ScopedTx } from '../config/database';
import { currentSchoolId } from '../config/tenancy';
import { AppError } from '../middleware/errorHandler';
import { basePrisma } from '../config/database';
import { normalizeUsername, usernameProblem, isUsernameTaken } from './usernames';
import { tenantStorage, RoleOverrides } from '../config/tenancy';

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
  return creatableRoles(actorRole, ctx?.kind === 'tenant' ? ctx.roles : undefined).includes(target);
}

export function assertCanManageRole(actorRole: string, target: Role) {
  if (!canManageRole(actorRole, target)) throw new AppError(`You cannot manage ${target} accounts`, 403);
}

/** Readable one-time password, e.g. "Kite-7342-Moon". Shown once to the admin. */
export function temporaryPassword(): string {
  const words = ['Kite', 'Moon', 'Lake', 'Star', 'Rose', 'Hill', 'Tree', 'Bird', 'Rain', 'Sand'];
  const w = () => words[crypto.randomInt(words.length)];
  return `${w()}-${crypto.randomInt(1000, 10000)}-${w()}`;
}

export interface NewAccount {
  name: string;
  /** At least one of email / username is needed to sign in. */
  email?: string | null;
  username?: string | null;
  phone?: string | null;
  role: Role;
  password?: string;
}

/**
 * Creates a login in the current school. Returns the generated password when
 * none was given so the office can hand it to the person.
 */
export async function createAccount(tx: Pick<ScopedTx, 'user'>, actorRole: string, a: NewAccount) {
  assertCanManageRole(actorRole, a.role);
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
  const plain = a.password ?? temporaryPassword();
  const user = await tx.user.create({
    data: {
      schoolId: currentSchoolId(),
      name: a.name,
      email,
      username,
      phone: a.phone ?? null,
      role: a.role,
      password: await hashPassword(plain),
      // Someone else chose this password: the person picks their own at first sign-in.
      mustChangePassword: true,
    },
    select: { id: true, name: true, email: true, username: true, role: true },
  });
  return { user, temporaryPassword: a.password ? undefined : plain };
}
