import { hashPassword, needsRehash, verifyPassword } from '../../utils/password';
import crypto from 'crypto';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import type { User } from '@prisma/client';
import { basePrisma } from '../../config/database';
import { getRedis } from '../../config/redis';
import { signToken, signRefreshToken, verifyRefreshToken, JwtPayload } from '../../utils/jwt';
import { AppError } from '../../middleware/errorHandler';
import { sendEmail } from '../../utils/email';

// Auth runs before a tenant is known (login, refresh, reset) or concerns only
// the caller's own User row, so it uses the unscoped client and filters by user id.

const REFRESH_TTL = 30 * 24 * 3600;

const publicUser = {
  id: true, name: true, email: true, phone: true, role: true, avatar: true, mfaEnabled: true,
  school: { select: { id: true, name: true, code: true, logoUrl: true, currency: true } },
} as const;

/** Blocks disabled users and users of disabled schools. */
async function assertCanSignIn(user: Pick<User, 'isActive' | 'schoolId' | 'role'>) {
  if (!user.isActive) throw new AppError('Account is disabled', 403);
  if (user.role === 'SUPER_ADMIN') return;
  if (!user.schoolId) throw new AppError('Account is not linked to a school', 403);
  const school = await basePrisma.school.findUnique({ where: { id: user.schoolId }, select: { isActive: true } });
  if (!school?.isActive) throw new AppError('School account is suspended', 403);
}

export async function issueTokens(user: Pick<User, 'id' | 'role' | 'email' | 'schoolId'>) {
  const payload: JwtPayload = { id: user.id, role: user.role, email: user.email, schoolId: user.schoolId };
  const accessToken = signToken(payload);
  const refreshToken = signRefreshToken(payload);
  await getRedis().setex(`refresh:${user.id}`, REFRESH_TTL, refreshToken);
  return { accessToken, refreshToken };
}

export async function login(email: string, password: string, mfaCode?: string) {
  const user = await basePrisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user) throw new AppError('Invalid credentials', 401);

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
  return { user: profile, ...tokens };
}

export async function refreshAccessToken(token: string) {
  let payload: JwtPayload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    throw new AppError('Invalid refresh token', 401);
  }
  const stored = await getRedis().get(`refresh:${payload.id}`);
  if (stored !== token) throw new AppError('Invalid refresh token', 401);

  // Re-read the user so role changes / deactivation take effect on refresh.
  const user = await basePrisma.user.findUnique({ where: { id: payload.id } });
  if (!user) throw new AppError('Invalid refresh token', 401);
  await assertCanSignIn(user);

  const accessToken = signToken({ id: user.id, role: user.role, email: user.email, schoolId: user.schoolId });
  return { accessToken };
}

export async function logout(userId: string, token: string) {
  const redis = getRedis();
  await redis.del(`refresh:${userId}`);
  await redis.setex(`blacklist:${token}`, 7 * 24 * 3600, '1');
}

export async function forgotPassword(email: string) {
  const user = await basePrisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user) return; // silent — don't reveal if email exists

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 3600 * 1000);
  await basePrisma.user.update({
    where: { id: user.id },
    data: { resetToken: hashResetToken(token), resetTokenExpires: expires },
  });

  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
  await sendEmail({
    to: user.email,
    subject: 'Password Reset',
    html: `<p>Click <a href="${resetUrl}">here</a> to reset your password. Link expires in 1 hour.</p>`,
  });
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
  await getRedis().del(`refresh:${user.id}`);
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await basePrisma.user.findUniqueOrThrow({ where: { id: userId } });
  const valid = await verifyPassword(currentPassword, user.password);
  if (!valid) throw new AppError('Current password is incorrect', 400);

  const hash = await hashPassword(newPassword);
  await basePrisma.user.update({ where: { id: userId }, data: { password: hash } });
}

export async function getMe(userId: string) {
  return basePrisma.user.findUniqueOrThrow({ where: { id: userId }, select: publicUser });
}

export async function enableMFA(userId: string) {
  const secret = authenticator.generateSecret();
  const user = await basePrisma.user.findUniqueOrThrow({ where: { id: userId } });
  const otpauth = authenticator.keyuri(user.email, process.env.MFA_ISSUER || 'School ERP', secret);
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

export async function disableMFA(userId: string) {
  await basePrisma.user.update({ where: { id: userId }, data: { mfaEnabled: false, mfaSecret: null } });
}
