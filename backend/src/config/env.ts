import { z } from 'zod';

/**
 * Checks configuration once at start-up. In production a missing or weak setting stops
 * the server with a clear message instead of failing later on some request (or worse,
 * running with a guessable secret). In development it only warns.
 */
const PLACEHOLDER = /change[-_ ]?me|your_|example|secret_key|min_32|^test$/i;
const secret = (name: string) => z.string({ error: `${name} is required` })
  .min(32, `${name} must be at least 32 characters (use: openssl rand -hex 32)`)
  .refine((v) => !PLACEHOLDER.test(v), `${name} still has the example value`);

const prodSchema = z.object({
  DATABASE_URL: z.string().startsWith('mysql://', 'DATABASE_URL must be a mysql:// URL'),
  REDIS_URL: z.string({ error: 'REDIS_URL is required in production (sessions, rate limits, job locks)' }).min(1, 'REDIS_URL is required in production (sessions, rate limits, job locks)'),
  JWT_SECRET: secret('JWT_SECRET'),
  REFRESH_TOKEN_SECRET: secret('REFRESH_TOKEN_SECRET'),
  AES_SECRET_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'AES_SECRET_KEY must be exactly 64 hex characters'),
  FRONTEND_URL: z.string().url('FRONTEND_URL must be the web address, e.g. https://erp.example.com'),
  BACKEND_URL: z.string().url('BACKEND_URL must be the public API address'),
  PAYMENT_GATEWAY: z.string().optional().refine((v) => v !== 'test', 'PAYMENT_GATEWAY=test is a simulator and is not allowed in production'),
  PAYMENT_GATEWAY_SECRET: z.string().optional(),
  // Signs file download links; must not be the login-token secret (SEC-3).
  FILE_URL_SECRET: secret('FILE_URL_SECRET'),
  // Protects /metrics (Prometheus scrapes it with this bearer token).
  METRICS_TOKEN: secret('METRICS_TOKEN'),
  MESSAGING_PROVIDER: z.string().optional().refine((v) => v !== 'test', 'MESSAGING_PROVIDER=test only pretends to send; not allowed in production'),
  ALLOW_DEMO_SEED: z.string().optional().refine((v) => v !== 'true', 'ALLOW_DEMO_SEED must not be set on a production server'),
}).refine((e) => e.JWT_SECRET !== e.REFRESH_TOKEN_SECRET, { message: 'JWT_SECRET and REFRESH_TOKEN_SECRET must be different', path: ['REFRESH_TOKEN_SECRET'] })
  .refine((e) => e.FILE_URL_SECRET !== e.JWT_SECRET && e.FILE_URL_SECRET !== e.REFRESH_TOKEN_SECRET, { message: 'FILE_URL_SECRET must be different from the token secrets', path: ['FILE_URL_SECRET'] })
  .refine((e) => !e.PAYMENT_GATEWAY || (!!e.PAYMENT_GATEWAY_SECRET && e.PAYMENT_GATEWAY_SECRET.length >= 32 && e.PAYMENT_GATEWAY_SECRET !== e.JWT_SECRET), { message: 'PAYMENT_GATEWAY_SECRET (32+ characters, not a token secret) is required when PAYMENT_GATEWAY is set', path: ['PAYMENT_GATEWAY_SECRET'] });

export function validateEnv(env: NodeJS.ProcessEnv = process.env): { ok: true } | { ok: false; problems: string[] } {
  if (env.NODE_ENV !== 'production') {
    const missing = ['DATABASE_URL', 'JWT_SECRET', 'REFRESH_TOKEN_SECRET'].filter((k) => !env[k]);
    return missing.length ? { ok: false, problems: missing.map((k) => `${k} is required`) } : { ok: true };
  }
  const r = prodSchema.safeParse(env);
  return r.success ? { ok: true } : { ok: false, problems: r.error.issues.map((e) => e.message) };
}
