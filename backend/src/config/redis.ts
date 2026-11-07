import Redis from 'ioredis';
import logger from '../utils/logger';

/**
 * Minimal in-memory stand-in for the handful of Redis commands this app uses
 * (get/set/setex/del/rpush/scan). Used in development when no Redis server is
 * running, so login, logout, token refresh and caching still work.
 */
class MemoryRedis {
  private store = new Map<string, { value: string | string[]; expiresAt?: number }>();

  private alive(key: string) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  async get(key: string) {
    const entry = this.alive(key);
    return typeof entry?.value === 'string' ? entry.value : null;
  }

  async set(key: string, value: string) {
    this.store.set(key, { value: String(value) });
    return 'OK';
  }

  async setex(key: string, seconds: number, value: string) {
    this.store.set(key, { value: String(value), expiresAt: Date.now() + seconds * 1000 });
    return 'OK';
  }

  async del(...keys: string[]) {
    let n = 0;
    for (const k of keys.flat()) if (this.store.delete(k)) n++;
    return n;
  }

  async rpush(key: string, ...values: string[]) {
    const entry = this.alive(key);
    const list = Array.isArray(entry?.value) ? entry!.value as string[] : [];
    list.push(...values);
    this.store.set(key, { value: list });
    return list.length;
  }

  async scan(_cursor: string, _match: string, pattern: string) {
    const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    const keys = [...this.store.keys()].filter((k) => this.alive(k) && re.test(k));
    return ['0', keys] as [string, string[]];
  }

  async quit() {
    return 'OK';
  }
}

let redis: Redis | undefined;

export async function connectRedis() {
  const client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    // don't keep retrying forever on startup if Redis isn't there
    retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
  });

  let warned = false;
  client.on('error', (err) => {
    if (!warned) logger.error('Redis error', err);
    warned = true;
  });

  try {
    await client.connect();
    redis = client;
    logger.info('Redis connected');
  } catch (error) {
    client.disconnect();
    if (process.env.NODE_ENV === 'production') {
      throw error;
    }
    logger.warn('Redis unavailable — using in-memory store (development only)');
    redis = new MemoryRedis() as unknown as Redis;
  }
}

export function getRedis(): Redis {
  if (!redis) throw new Error('Redis not initialized. Set REDIS_URL or install Redis.');
  return redis;
}

export default redis as Redis;
