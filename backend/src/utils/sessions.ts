import crypto from 'crypto';
import { getRedis } from '../config/redis';
import type { JwtPayload } from './jwt';

/**
 * Sign-in sessions, one per device. Each login gets a session id (`sid`, inside both
 * tokens) and its own refresh token in Redis, so signing in on the phone no longer logs
 * the web out, and signing out ends only that device.
 *
 * "Sign out everywhere" (deactivation, role or password change) also records a cut-off
 * time: access tokens issued before it are refused at once, not when they expire.
 */
const REFRESH_TTL = 30 * 24 * 3600;
const CUTOFF_TTL = 30 * 24 * 3600; // longer than any access token can live

const refreshKey = (userId: string, sid: string) => `refresh:${userId}:${sid}`;

export const newSessionId = () => crypto.randomUUID();

export async function saveSession(userId: string, sid: string, refreshToken: string) {
  await getRedis().setex(refreshKey(userId, sid), REFRESH_TTL, refreshToken);
}

/** The refresh token stored for this session (or the pre-sessions single token). */
export async function storedRefreshToken(userId: string, sid?: string) {
  return getRedis().get(sid ? refreshKey(userId, sid) : `refresh:${userId}`);
}

export async function endSession(userId: string, sid: string | undefined, accessToken: string, exp?: number) {
  const redis = getRedis();
  await redis.del(sid ? refreshKey(userId, sid) : `refresh:${userId}`);
  // Refuse this access token until it would have expired anyway.
  const ttl = exp ? Math.max(60, exp - Math.floor(Date.now() / 1000)) : 24 * 3600;
  await redis.setex(`blacklist:${accessToken}`, ttl, '1');
}

/** Ends every session of a user, optionally keeping the one making the request. */
export async function endAllSessions(userId: string, opts: { keepSid?: string } = {}) {
  const redis = getRedis();
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `refresh:${userId}:*`, 'COUNT', 200);
    const drop = keys.filter((k) => !opts.keepSid || k !== refreshKey(userId, opts.keepSid));
    if (drop.length) await redis.del(...drop);
    cursor = next;
  } while (cursor !== '0');
  await redis.del(`refresh:${userId}`); // pre-sessions token
  // Without a session to keep, also refuse every access token issued until now.
  if (!opts.keepSid) await redis.setex(`revoked-before:${userId}`, CUTOFF_TTL, String(Math.floor(Date.now() / 1000)));
}

/** True when an access token was signed out or issued before a "sign out everywhere". */
export async function isRevoked(token: string, payload: JwtPayload) {
  const [blacklisted, cutoff] = await getRedis().mget(`blacklist:${token}`, `revoked-before:${payload.id}`);
  if (blacklisted) return true;
  return !!cutoff && typeof payload.iat === 'number' && payload.iat <= Number(cutoff);
}
