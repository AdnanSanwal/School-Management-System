import { hashPassword, needsRehash, verifyPassword } from '../../utils/password';
import crypto from 'crypto';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import type { User } from '@prisma/client';
import { basePrisma } from '../../config/database';
import { signToken, signRefreshToken, verifyRefreshToken, JwtPayload } from '../../utils/jwt';
import { AppError } from '../../middleware/errorHandler';
import { sendEmail } from '../../utils/email';
import { endAllSessions, endSession, newSessionId, saveSession, storedRefreshToken } from '../../utils/sessions';
import { normalizeUsername, usernameProblem, isUsernameTaken } from '../../utils/usernames';
import { permissionsFor } from '../../utils/rolePermissions';

// Auth runs before a tenant is known (login, refresh, reset) or concerns only
// the caller's own User row, so it uses the unscoped client and filters by user id.

const publicUser = {
  id: true, name: true, email: true, username: true, phone: true, role: true, avatar: true, mfaEnabled: true, mustChangePassword: true,
  school: { select: { id: true, name: true, code: true, logoUrl: true, currency: true } },
} as const;

/** The profile plus what this user may do in their school (the web and mobile apps show menus from it). */
async function withPermissions<T extends { role: string; school: { id: string } | null }>(profile: T) {
  return { ...profile, permissions: await permissionsFor(profile?.role ?? '', profile?.school?.id) };
}

/** Blocks disabled users and users of disabled schools. */
async function assertCanSignIn(user: Pick<User, 'isActive' | 'schoolId' | 'role'>) {
  if (!user.isActive) throw new AppError('Account is disabled', 403);
  if (user.role === 'SUPER_ADMIN') return;
  if (!user.schoolId) throw new AppError('Account is not linked to a school', 403);
  const school = await basePrisma.school.findUnique({ where: { id: user.schoolId }, select: { isActive: true } });
  if (!school?.isActive) throw new AppError('School account is suspended', 403);
}

export async function issueTokens(user: Pick<User, 'id' | 'role' | 'email' | 'schoolId' | 'mustChangePassword'>) {
  const sid = newSessionId();
  const payload: JwtPayload = { id: user.id, role: user.role, email: user.email, schoolId: user.schoolId, sid, pwc: user.mustChangePassword };
  const accessToken = signToken(payload);
  const refreshToken = signRefreshToken(payload);
  await saveSession(user.id, sid, refreshToken);
  return { accessToken, refreshToken };
}

// Compared against when the email is unknown, so a wrong email takes as long as a wrong
// password and the response time doesn't reveal which accounts exist.
let dummyHash: Promise<string> | undefined;
const timingDecoy = (password: string) => {
  dummyHash ??= hashPassword(crypto.randomBytes(16).toString('hex'));
  return dummyHash.then((h) => verifyPassword(password, h));
};

/** Signs in with an email or a username (CR-05). */
export async function login(identifier: string, password: string, mfaCode?: string) {
  const id = identifier.toLowerCase().trim();
  const user = await basePrisma.user.findUnique({ where: id.includes('@') ? { email: id } : { username: id } });
  if (!user) {
    await timingDecoy(password);
    throw new AppError('Invalid credentials', 401);
  }

  const valid = await verifyPassword(password, user.password);
  if (!valid) throw new AppError('Invalid credentials', 401);
  // Older hashes used a slower cost; upgrade quietly so the next login is fast.
  if (needsRehash(user.password)) {
    hashPassword(password)
      .then((hash) => basePrisma.user.update({ where: { id: user.id }, data: { password: hash } }))
      .catch(() => { /* keep the old hash; try again next login */ });
  }

  await assertCanSignIn(user);

  if (user.mfaEnabled) {
    if (!mfaCode) throw new AppError('MFA code required', 403);
    const isValid = authenticator.verify({ token: mfaCode, secret: user.mfaSecret! });
    if (!isValid) throw new AppError('Invalid MFA code', 401);
  }

  await basePrisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const tokens = await issueTokens(user);
  const profile = await basePrisma.user.findUniqueOrThrow({ where: { id: user.id }, select: publicUser });
  return { user: await withPermissions(profile), ...tokens };
}

export async function refreshAccessToken(token: string) {
  let payload: JwtPayload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    throw new AppError('Invalid refresh token', 401);
  }
  const stored = await storedRefreshToken(payload.id, payload.sid);
  if (!stored || stored !== token) throw new AppError('Session ended. Please sign in again.', 401);

  // Re-read the user so role changes / deactivation take effect on refresh.
  const user = await basePrisma.user.findUnique({ where: { id: payload.id } });
  if (!user) throw new AppError('Invalid refresh token', 401);
  await assertCanSignIn(user);

  const accessToken = signToken({ id: user.id, role: user.role, email: user.email, schoolId: user.schoolId, sid: payload.sid, pwc: user.mustChangePassword });
  return { accessToken };
}

/** Ends this device's session only. */
export async function logout(user: JwtPayload, token: string) {
  await endSession(user.id, user.sid, token, user.exp);
}

export async function forgotPassword(email: string) {
  const user = await basePrisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user?.email) return; // silent — don't reveal if email exists

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 3600 * 1000);
  await basePrisma.user.update({
    where: { id: user.id },
    data: { resetToken: hashResetToken(token), resetTokenExpires: expires },
  });

  const resetUrl = `${(process.env.FRONTEND_URL || '').split(',')[0]}/reset-password?token=${token}`;
  // Never fail (or reveal anything) because email isn't configured; the office can still
  // reset the password from Users & logins.
  await sendEmail({
    to: user.email!,
    subject: 'Password Reset',
    html: `<p>Click <a href="${resetUrl}">here</a> to reset your password. Link expires in 1 hour.</p>`,
  }).catch(() => {});
}

function hashResetToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function resetPassword(token: string, newPassword: string) {
  const user = await basePrisma.user.findFirst({
    where: { resetToken: hashResetToken(token), resetTokenExpires: { gt: new Date() } },
  });
  if (!user) throw new AppError('Invalid or expired reset token', 400);

  const hash = await hashPassword(newPassword);
  await basePrisma.user.update({
    where: { id: user.id },
    data: { password: hash, resetToken: null, resetTokenExpires: null },
  });
  await endAllSessions(user.id); // a reset means the old password may be known: sign out everywhere
}

/** Returns fresh tokens: the old ones may carry the "must change password" mark. */
export async function changePassword(userId: string, currentPassword: string, newPassword: string, keepSid?: string) {
  const user = await basePrisma.user.findUniqueOrThrow({ where: { id: userId } });
  const valid = await verifyPassword(currentPassword, user.password);
  if (!valid) throw new AppError('Current password is incorrect', 400);

  if (await verifyPassword(newPassword, user.password)) throw new AppError('Choose a password different from the current one', 400);
  const hash = await hashPassword(newPassword);
  const updated = await basePrisma.user.update({ where: { id: userId }, data: { password: hash, mustChangePassword: false } });
  await endAllSessions(userId); // every device, this one included, continues on the new tokens below
  const tokens = await issueTokens(updated);
  const profile = await basePrisma.user.findUniqueOrThrow({ where: { id: userId }, select: publicUser });
  return { user: await withPermissions(profile), ...tokens };
}

export async function getMe(userId: string) {
  return withPermissions(await basePrisma.user.findUniqueOrThrow({ where: { id: userId }, select: publicUser }));
}

export async function updateProfile(userId: string, body: { name: string; phone?: string | null; email?: string | null; username?: string | null; currentPassword?: string }) {
  const user = await basePrisma.user.findUniqueOrThrow({ where: { id: userId } });
  const email = body.email === undefined ? user.email : body.email ? body.email.toLowerCase().trim() : null;
  const username = body.username === undefined ? user.username : body.username ? normalizeUsername(body.username) : null;
  const loginChanged = email !== user.email || username !== user.username;
  if (loginChanged) {
    // Changing how you sign in needs your password, so a borrowed session can't take the account.
    if (!body.currentPassword || !(await verifyPassword(body.currentPassword, user.password))) {
      throw new AppError('Enter your current password to change your email or username', 400);
    }
    if (!email && !username) throw new AppError('Keep at least a username or an email to sign in with', 422);
    if (username !== user.username && username) {
      const problem = usernameProblem(username);
      if (problem) throw new AppError(problem, 422);
      if (await isUsernameTaken(username, userId)) throw new AppError(`Username “${username}” is already taken`, 409);
    }
    if (email !== user.email && email && await basePrisma.user.findFirst({ where: { email, NOT: { id: userId } }, select: { id: true } })) {
      throw new AppError(`${email} is already used by another account`, 409);
    }
  }
  return basePrisma.user.update({
    where: { id: userId },
    data: { name: body.name, phone: body.phone || null, email, username },
    select: publicUser,
  });
}

export async function enableMFA(userId: string) {
  const secret = authenticator.generateSecret();
  const user = await basePrisma.user.findUniqueOrThrow({ where: { id: userId } });
  // Replacing the secret of an active 2FA would let a stolen session lock the owner out.
  if (user.mfaEnabled) throw new AppError('Two-step login is already on. Turn it off first.', 409);
  const otpauth = authenticator.keyuri(user.email ?? user.username ?? user.name, process.env.MFA_ISSUER || 'School ERP', secret);
  const qrCodeUrl = await QRCode.toDataURL(otpauth);

  await basePrisma.user.update({ where: { id: userId }, data: { mfaSecret: secret } });
  return { secret, qrCodeUrl };
}

export async function verifyMFA(userId: string, code: string) {
  const user = await basePrisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.mfaSecret) throw new AppError('MFA not set up', 400);

  const isValid = authenticator.verify({ token: code, secret: user.mfaSecret });
  if (!isValid) throw new AppError('Invalid MFA code', 400);

  await basePrisma.user.update({ where: { id: userId }, data: { mfaEnabled: true } });
}

export async function disableMFA(userId: string, password: string) {
  const user = await basePrisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(password, user.password))) throw new AppError('Password is incorrect', 400);
  await basePrisma.user.update({ where: { id: userId }, data: { mfaEnabled: false, mfaSecret: null } });
}
