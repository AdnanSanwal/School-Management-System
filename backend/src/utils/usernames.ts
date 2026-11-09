import { basePrisma } from '../config/database';

/**
 * Sign-in usernames (CR-05). Unique across the whole platform, so a user can sign in
 * without a school code. Stored lowercase. Lookups use the unscoped client on purpose:
 * a name taken in another school is still taken.
 */
const FORMAT = /^[a-z0-9](?:[a-z0-9._-]{1,38})[a-z0-9]$/;

export const normalizeUsername = (u: string) => u.trim().toLowerCase();

/** Why a username can't be used, or null when the format is fine. */
export function usernameProblem(u: string): string | null {
  if (u.includes('@')) return 'A username can’t contain @ (that would look like an email)';
  if (!FORMAT.test(u)) return 'Use 3–40 letters, numbers, dots, dashes or underscores, starting and ending with a letter or number';
  if (/[._-]{2}/.test(u)) return 'Don’t put two dots, dashes or underscores in a row';
  return null;
}

export async function isUsernameTaken(username: string, exceptUserId?: string) {
  const hit = await basePrisma.user.findFirst({ where: { username, ...(exceptUserId ? { NOT: { id: exceptUserId } } : {}) }, select: { id: true } });
  return !!hit;
}

const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').replace(/\.{2,}/g, '.');

/** Up to `max` free usernames close to what was asked (and the person's name / school code). */
export async function suggestUsernames(wanted: string, opts: { name?: string; schoolCode?: string; max?: number } = {}) {
  const base = slug(wanted) || slug(opts.name ?? '') || 'user';
  const parts = slug(opts.name ?? '').split('.').filter(Boolean);
  const school = opts.schoolCode ? slug(opts.schoolCode) : '';
  const year = String(new Date().getFullYear()).slice(2);
  const raw = [
    school && `${school}.${base}`,
    parts.length >= 2 && `${parts[0]}.${parts[parts.length - 1]}`,
    parts.length >= 2 && `${parts[0][0]}${parts[parts.length - 1]}`,
    school && parts.length && `${school}.${parts[0]}`,
    `${base}${year}`,
    ...Array.from({ length: 8 }, (_, i) => `${base}${i + 1}`),
    `${base}.${Math.floor(100 + Math.random() * 900)}`,
  ].filter((c): c is string => !!c && !usernameProblem(c));
  const candidates = [...new Set(raw.map((c) => c.slice(0, 40)))];
  const taken = new Set((await basePrisma.user.findMany({ where: { username: { in: candidates } }, select: { username: true } })).map((u) => u.username));
  return candidates.filter((c) => !taken.has(c) && c !== wanted).slice(0, opts.max ?? 4);
}

/** Full check for a form: format, availability and alternatives when it can't be used. */
export async function checkUsername(input: string, opts: { name?: string; schoolCode?: string; exceptUserId?: string } = {}) {
  const username = normalizeUsername(input);
  const problem = usernameProblem(username);
  const available = !problem && !(await isUsernameTaken(username, opts.exceptUserId));
  return {
    username,
    valid: !problem,
    available,
    message: problem ?? (available ? 'Available' : `“${username}” is already taken`),
    suggestions: available ? [] : await suggestUsernames(username, opts),
  };
}
