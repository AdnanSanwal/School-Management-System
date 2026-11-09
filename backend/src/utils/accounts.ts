import { hashPassword } from './password';
import crypto from 'crypto';
import type { Role } from '@prisma/client';
import type { ScopedTx } from '../config/database';
import { currentSchoolId } from '../config/tenancy';
import { AppError } from '../middleware/errorHandler';
import { basePrisma } from '../config/database';
import { normalizeUsername, usernameProblem, isUsernameTaken } from './usernames';

/**
 * Who may create/manage which accounts. A user can manage strictly lower ranks;
 * the owner can manage every school role, including other owners.
 */
const RANK: Record<Role, number> = {
  SUPER_ADMIN: 100, OWNER: 50, PRINCIPAL: 40, ADMIN: 30, ACCOUNTANT: 20, TEACHER: 20, PARENT: 10, STUDENT: 10,
};

export function canManageRole(actorRole: string, target: Role): boolean {
  if (target === 'SUPER_ADMIN') return false;
  if (actorRole === 'OWNER') return true;
  const actor = RANK[actorRole as Role];
  return actor !== undefined && actor > RANK[target];
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
