import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';

/**
 * Password rules for passwords people choose (SECURITY_FINDINGS AUTH-15):
 *  - 8 to 72 bytes: bcrypt only reads the first 72 bytes, so a longer "passphrase" would
 *    silently be cut; we say so instead of accepting it.
 *  - not one of the most common passwords, and not the person's own name / username / email.
 * Long passphrases are welcome; there are no forced symbol rules.
 */
const COMMON = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword', 'admin123', 'admin@123', 'administrator',
  '12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', '12341234', '11223344', 'qwertyuiop', 'qwerty123',
  'qwerty12', '1q2w3e4r', '1qaz2wsx', 'zaq12wsx', 'asdfghjkl', 'iloveyou', 'sunshine', 'princess', 'football', 'baseball',
  'welcome1', 'welcome123', 'letmein1', 'monkey123', 'dragon123', 'master123', 'abc12345', 'abcd1234', 'pakistan', 'pakistan1',
  'pakistan123', 'karachi123', 'lahore123', 'school123', 'school@123', 'teacher123', 'student123', 'changeme', 'changeme1', 'test1234',
  'test@123', 'welcome@123', 'pass@123', 'pass1234', 'secret123', 'superman', 'trustno1', 'whatever', 'computer', 'internet',
]);

export function passwordProblem(plain: string, person?: { email?: string | null; username?: string | null; name?: string | null }): string | null {
  if (plain.length < 8) return 'Password must be at least 8 characters';
  if (Buffer.byteLength(plain, 'utf8') > 72) return 'Password is too long (72 characters at most)';
  const lower = plain.toLowerCase();
  if (COMMON.has(lower)) return 'This password is too common. Choose something harder to guess.';
  if (/^(.)\1+$/.test(plain)) return 'This password is too easy to guess';
  const own = [person?.username, person?.email?.split('@')[0], ...(person?.name ?? '').toLowerCase().split(/\s+/)]
    .filter((x): x is string => !!x && x.length >= 4).map((x) => x.toLowerCase());
  if (own.some((x) => lower === x || lower.replace(/[^a-z]/g, '') === x)) return 'Don’t use your own name or username as the password';
  return null;
}

export function assertStrongPassword(plain: string, person?: { email?: string | null; username?: string | null; name?: string | null }) {
  const problem = passwordProblem(plain);
  const personal = problem ?? passwordProblem(plain, person);
  if (personal) throw new AppError(personal, 422);
}

/** zod field for a new password (length and common-password checks; personal checks happen in the service). */
export const newPassword = z.string().min(8, 'Password must be at least 8 characters').max(200)
  .refine((v) => Buffer.byteLength(v, 'utf8') <= 72, 'Password is too long (72 characters at most)')
  .refine((v) => passwordProblem(v) === null, 'This password is too common. Choose something harder to guess.');
