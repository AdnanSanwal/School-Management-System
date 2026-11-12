import { z } from 'zod';
import { newPassword } from '../../utils/passwordPolicy';

export const loginSchema = z.object({
  body: z.object({
    // Email or username (CR-05); the field keeps its old name for existing apps.
    email: z.string().trim().min(3).max(191),
    password: z.string().min(1).max(200),
    mfaCode: z.string().optional(),
  }),
});

export const profileSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(100),
    phone: z.string().trim().max(32).optional().nullable(),
    email: z.string().trim().email().max(191).optional().nullable().or(z.literal('').transform(() => null)),
    username: z.string().trim().min(3).max(40).optional().nullable().or(z.literal('').transform(() => null)),
    currentPassword: z.string().max(200).optional(),
  }).strict(),
});

export const forgotPasswordSchema = z.object({ body: z.object({ email: z.string().email() }) });

export const resetPasswordSchema = z.object({
  body: z.object({ token: z.string().min(10), newPassword: newPassword }),
});

export const mfaCodeSchema = z.object({ body: z.object({ code: z.string().regex(/^\d{6}$/, '6-digit code') }) });
export const disableMfaSchema = z.object({ body: z.object({ password: z.string().min(1) }) });
/** Turning two-step login on needs the password, so a borrowed session can't lock the owner out (AUTH-6). */
export const enableMfaSchema = z.object({ body: z.object({ password: z.string().min(1, 'Enter your password') }) });

export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string(),
    newPassword: newPassword,
  }),
});
