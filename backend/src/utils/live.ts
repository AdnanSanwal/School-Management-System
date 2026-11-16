import type { Server as SocketServer } from 'socket.io';
import type Redis from 'ioredis';
import { getRedis } from '../config/redis';
import logger from './logger';

/**
 * Live events to signed-in users' open screens (web and mobile), across every worker
 * process and server.
 *
 * A user's socket is held by ONE process, but the event may be raised in any of them (or
 * in a background job). So events are published on a Redis channel; every process that
 * holds sockets listens and hands the event to its own connections. Without Redis
 * (development) there is one process, and events are handed over directly.
 *
 * Live events are a convenience, not the record: the notification is already saved, and a
 * client that was offline catches up from the API when it reconnects.
 */

const CHANNEL = 'live:events';
const PER_MESSAGE = 500;

export type LiveEvent = 'notification' | 'notifications:read';
interface Envelope { schoolId: string; event: LiveEvent; items: { userId: string; payload: unknown }[] }

let io: SocketServer | undefined;
let subscriber: Redis | undefined;

export const userRoom = (schoolId: string | null | undefined, userId: string) => `school:${schoolId}:user:${userId}`;

function handOver(env: Envelope) {
  if (!io) return;
  for (const item of env.items) io.local.to(userRoom(env.schoolId, item.userId)).emit(env.event, item.payload);
}

/** The shared Redis connection, if this process has a real one (not the in-memory stand-in). */
function redisForPublishing(): Redis | null {
  try {
    const redis = getRedis() as any;
    return typeof redis.publish === 'function' ? redis : null;
  } catch {
    return null; // Redis not started (scripts, unit tests)
  }
}

/** Called once by each process that accepts socket connections. */
export async function initLive(server: SocketServer) {
  io = server;
  const redis = redisForPublishing();
  if (!redis) return;
  // Subscribing needs its own connection. Unlike the main one it never gives up
  // reconnecting, and ioredis re-subscribes by itself after a reconnect.
  const sub = redis.duplicate({ lazyConnect: false, maxRetriesPerRequest: null, retryStrategy: (times: number) => Math.min(times * 500, 5000) });
  sub.on('error', (err) => logger.warn('Live events: Redis subscriber error', { message: err.message }));
  sub.on('message', (_channel, raw) => {
    try { handOver(JSON.parse(raw) as Envelope); } catch (err) { logger.warn('Live events: bad message', { message: (err as Error).message }); }
  });
  await sub.subscribe(CHANNEL);
  subscriber = sub;
}

export async function closeLive() {
  const sub = subscriber;
  subscriber = undefined;
  io = undefined;
  await sub?.quit().catch(() => {});
}

/** Sends an event to each listed user's open screens. Never throws. */
export async function emitToUsers(schoolId: string, event: LiveEvent, items: { userId: string; payload: unknown }[]) {
  if (!items.length) return;
  // Publish when sockets listen on Redis (this process subscribed), or when this process
  // holds no sockets at all (a job or script) and another process may.
  const redis = subscriber || !io ? redisForPublishing() : null;
  for (let i = 0; i < items.length; i += PER_MESSAGE) {
    const env: Envelope = { schoolId, event, items: items.slice(i, i + PER_MESSAGE) };
    try {
      if (redis) await redis.publish(CHANNEL, JSON.stringify(env));
      else handOver(env);
    } catch (err) {
      // Redis hiccup: at least reach the connections this process holds.
      logger.warn('Live events: publish failed', { message: (err as Error).message });
      handOver(env);
    }
  }
}
