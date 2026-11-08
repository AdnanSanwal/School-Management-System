import type { Request } from 'express';
import rateLimit, { type Options, type Store, type IncrementResponse } from 'express-rate-limit';
import { getRedis } from '../config/redis';

/**
 * Rate limits shared by every server process through Redis, so running several
 * instances doesn't multiply the allowance. Without a real Redis (development) each
 * process counts on its own.
 */
class RedisStore implements Store {
  prefix: string;
  private windowMs = 60_000;
  constructor(name: string) { this.prefix = `rl:${name}:`; }

  init(options: Options) { this.windowMs = options.windowMs; }

  private client() {
    const c = getRedis() as any;
    return typeof c.multi === 'function' ? c : null;
  }

  async increment(key: string): Promise<IncrementResponse> {
    const c = this.client();
    if (!c) return memory.increment(this.prefix + key, this.windowMs);
    const k = this.prefix + key;
    // First hit of a window sets the expiry; later hits only count.
    const [[, hits], [, ttl]] = await c.multi().incr(k).pttl(k).exec();
    if (ttl < 0) await c.pexpire(k, this.windowMs);
    return { totalHits: Number(hits), resetTime: new Date(Date.now() + (ttl > 0 ? ttl : this.windowMs)) };
  }

  async decrement(key: string) {
    const c = this.client();
    if (!c) return memory.decrement(this.prefix + key);
    await c.decr(this.prefix + key);
  }

  async resetKey(key: string) {
    const c = this.client();
    if (!c) return memory.reset(this.prefix + key);
    await c.del(this.prefix + key);
  }
}

/** Per-process fallback used when Redis isn't available (development only). */
const memory = (() => {
  const hits = new Map<string, { n: number; reset: number }>();
  return {
    increment(key: string, windowMs: number): IncrementResponse {
      const now = Date.now();
      const cur = hits.get(key);
      const entry = cur && cur.reset > now ? { n: cur.n + 1, reset: cur.reset } : { n: 1, reset: now + windowMs };
      hits.set(key, entry);
      return { totalHits: entry.n, resetTime: new Date(entry.reset) };
    },
    decrement(key: string) { const e = hits.get(key); if (e) e.n = Math.max(0, e.n - 1); },
    reset(key: string) { hits.delete(key); },
  };
})();

// Jest runs hundreds of requests from one IP; limits are tested explicitly with RATE_LIMIT_IN_TESTS.
const skipInTests = () => process.env.NODE_ENV === 'test' && !process.env.RATE_LIMIT_IN_TESTS;
const tooMany = (message: string) => ({ success: false, message });

function limiter(name: string, opts: Partial<Options> & { windowMs: number; limit: number; message: string }) {
  return rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: new RedisStore(name),
    skip: skipInTests,
    ...opts,
    message: tooMany(opts.message),
  });
}

const userOrIp = (req: Request) => (req as any).user?.id ?? req.ip ?? 'unknown';

/** Everything under /api: generous, per client IP. */
export const apiLimiter = limiter('api', {
  windowMs: 15 * 60_000,
  limit: Number(process.env.RATE_LIMIT_MAX) || 1000,
  message: 'Too many requests from this network. Please wait a few minutes.',
});

/** Failed sign-ins per account+IP (guessing one password)… */
export const loginAccountLimiter = limiter('login-account', {
  windowMs: 15 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${req.ip}:${String(req.body?.email ?? '').toLowerCase().trim()}`,
  message: 'Too many failed sign-ins for this account. Try again in 15 minutes, or use "Forgot password".',
});

/** …and per IP across accounts (trying many accounts). */
export const loginIpLimiter = limiter('login-ip', {
  windowMs: 15 * 60_000,
  limit: 50,
  skipSuccessfulRequests: true,
  message: 'Too many failed sign-ins from this network. Try again in 15 minutes.',
});

/** Password-reset emails and token guesses. */
export const passwordResetLimiter = limiter('password-reset', {
  windowMs: 60 * 60_000,
  limit: 10,
  message: 'Too many password-reset attempts. Try again in an hour.',
});

/** Two-step login code checks while setting it up. */
export const mfaLimiter = limiter('mfa', {
  windowMs: 15 * 60_000,
  limit: 10,
  keyGenerator: userOrIp,
  message: 'Too many code attempts. Try again in 15 minutes.',
});

/** PDF/Excel generation is CPU-heavy: per signed-in user. */
export const heavyLimiter = limiter('heavy', {
  windowMs: 60_000,
  limit: 30,
  keyGenerator: userOrIp,
  message: 'Too many reports at once. Please wait a minute.',
});
