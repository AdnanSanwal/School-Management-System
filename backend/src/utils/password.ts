import bcrypt from 'bcryptjs';

/**
 * bcrypt work factor. bcryptjs is pure JavaScript, so each step up doubles login time:
 * 10 ≈ 0.15–0.2 s, 12 ≈ 0.7–0.8 s on a small server. 10 is the widely used default.
 * Raise it with BCRYPT_ROUNDS if your server is fast.
 */
export const BCRYPT_ROUNDS = Math.min(14, Math.max(10, Number(process.env.BCRYPT_ROUNDS) || 10));

export function hashPassword(plain: string) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

/** True when a stored hash uses a different cost than today's setting (re-hash after login). */
export function needsRehash(hash: string) {
  try { return bcrypt.getRounds(hash) !== BCRYPT_ROUNDS; } catch { return false; }
}
