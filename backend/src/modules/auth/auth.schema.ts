import { z } from 'zod';

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string(),
    mfaCode: z.string().optional(),
  }),
});

export const profileSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(100),
    phone: z.string().trim().max(32).optional().nullable(),
  }).strict(),
});

export const forgotPasswordSchema = z.object({ body: z.object({ email: z.string().email() }) });

export const resetPasswordSchema = z.object({
  body: z.object({ token: z.string().min(10), newPassword: z.string().min(8).max(100) }),
});

export const mfaCodeSchema = z.object({ body: z.object({ code: z.string().regex(/^\d{6}$/, '6-digit code') }) });
export const disableMfaSchema = z.object({ body: z.object({ password: z.string().min(1) }) });

export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string(),
    newPassword: z.string().min(8).max(100),
  }),
});
