import logger from './logger';

// Lazy import to avoid crash when Redis is unavailable
function getClient() {
  try {
    const { getRedis } = require('../config/redis');
    return getRedis() as import('ioredis').Redis;
  } catch {
    return null;
  }
}

const inflight = new Map<string, Promise<unknown>>();

/**
 * A school's data version. Bumped after every successful change in that school (see
 * middleware/audit.ts), so caches keyed by it are invalidated instantly and cheaply.
 */
export async function schoolDataVersion(schoolId: string): Promise<string> {
  const client = getClient();
  if (!client) return '0';
  try { return (await client.get(`data-version:${schoolId}`)) ?? '0'; } catch { return '0'; }
}

export async function bumpSchoolDataVersion(schoolId: string) {
  const client = getClient() as any;
  if (!client || typeof client.incr !== 'function') return;
  try { await client.incr(`data-version:${schoolId}`); } catch { /* cache only */ }
}

/**
 * Cache-aside helper.
 * Returns cached value if present, otherwise calls `fn`, caches the result, and returns it.
 * Falls through silently if Redis is unavailable.
 */
export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
): Promise<T> {
  const client = getClient();

  if (client) {
    try {
      const hit = await client.get(key);
      if (hit) {
        logger.debug(`cache hit: ${key}`);
        return JSON.parse(hit) as T;
      }
    } catch {
      logger.warn(`cache read failed for key: ${key}`);
    }
  }

  // Single-flight: identical requests arriving together share one computation instead of
  // all hitting the database at once (e.g. every office PC refreshing the dashboard).
  let pending = inflight.get(key) as Promise<T> | undefined;
  if (!pending) {
    pending = fn().finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  const result = await pending;

  if (client) {
    try {
      await client.setex(key, ttlSeconds, JSON.stringify(result));
    } catch {
      logger.warn(`cache write failed for key: ${key}`);
    }
  }

  return result;
}

/** Invalidate one or more cache keys (or glob patterns via SCAN). */
export async function invalidate(...keys: string[]) {
  const client = getClient();
  if (!client || keys.length === 0) return;
  try {
    await client.del(...keys);
  } catch {
    logger.warn(`cache invalidation failed for keys: ${keys.join(', ')}`);
  }
}

