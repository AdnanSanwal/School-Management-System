import { randomUUID } from 'crypto';
import webpush from 'web-push';
import client from 'prom-client';
import { Prisma, type Notification } from '@prisma/client';
import { basePrisma } from '../config/database';
import { activeDriver, deliver as deliverMessages, toE164 } from './messaging';
import { URGENT_TYPES } from './notificationRules';
import logger from './logger';

/**
 * Gets saved notifications to phones (Expo push) and browsers (Web Push).
 *
 * The queue is the `notifications` table itself: `notify()` saves each row as PENDING in
 * the same statement that creates it, so a notification can never exist without its
 * delivery being owed. Workers then:
 *
 *   claim   one atomic UPDATE stamps a batch with this worker's lock. Any number of
 *           workers and servers can run; no two can claim the same row. If a worker dies,
 *           its lock simply expires and the rows are claimed again.
 *   send    in bulk, with a timeout on every outside call.
 *   settle  DELIVERED (a push service accepted it for at least one device), UNREACHED
 *           (nothing registered for this user), or try again later with growing delays;
 *           FAILED after the last attempt, EXPIRED when too old to be worth a push.
 *
 * Delivery is at-least-once: a crash between sending and settling re-sends that batch.
 * A duplicate alert is better than a missing one.
 *
 * Urgent types that could not reach the user in the app are texted instead, when the
 * school has switched that on (School settings, WhatsApp/SMS).
 */

export const BATCH = 500;
const LOCK_MS = 2 * 60_000;
const POLL_MS = 5_000;
export const MAX_ATTEMPTS = 5;
/** Wait before attempts 2, 3, 4 and 5. */
const BACKOFF_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000];
const MAX_AGE_MS = 24 * 60 * 60_000;
const OUTSIDE_CALL_TIMEOUT_MS = 15_000;
const EXPO_URL = 'https://exp.host/--/api/v2/push/send';

/** Types texted to people the app could not reach (if the school turned that on). */
export { URGENT_TYPES };

export type Outcome = 'ok' | 'gone' | 'retry' | 'error';
export interface ExpoMessage { to: string; title: string; body: string; data: Record<string, unknown>; sound: 'default'; channelId: 'default' }
export interface WebTarget { endpoint: string; p256dh: string; auth: string }

const outcomes = new client.Counter({ name: 'notification_deliveries_total', help: 'Notifications settled by the delivery worker', labelNames: ['outcome'] });

// ─── Outside calls (replaceable in tests) ───

async function sendExpo(messages: ExpoMessage[]): Promise<Outcome[]> {
  const out: Outcome[] = [];
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const res = await fetch(EXPO_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(chunk),
        signal: AbortSignal.timeout(OUTSIDE_CALL_TIMEOUT_MS),
      });
      if (!res.ok) {
        logger.warn('Expo push HTTP error', { status: res.status });
        out.push(...chunk.map((): Outcome => (res.status === 429 || res.status >= 500 ? 'retry' : 'error')));
        continue;
      }
      const { data } = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
      out.push(...chunk.map((_, j): Outcome => {
        const ticket = data?.[j];
        if (ticket?.status === 'ok') return 'ok';
        if (ticket?.details?.error === 'DeviceNotRegistered') return 'gone';
        return ticket?.details?.error === 'MessageRateExceeded' || !ticket ? 'retry' : 'error';
      }));
    } catch (err) {
      logger.warn('Expo push unreachable', { message: (err as Error).message });
      out.push(...chunk.map((): Outcome => 'retry'));
    }
  }
  return out;
}

async function sendWeb(target: WebTarget, payload: string): Promise<Outcome> {
  try {
    await webpush.sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } }, payload, {
      timeout: OUTSIDE_CALL_TIMEOUT_MS, TTL: 24 * 60 * 60,
      vapidDetails: { subject: `mailto:${process.env.EMAIL_FROM || 'admin@school.com'}`, publicKey: process.env.VAPID_PUBLIC_KEY!, privateKey: process.env.VAPID_PRIVATE_KEY! },
    });
    return 'ok';
  } catch (e: any) {
    if (e?.statusCode === 404 || e?.statusCode === 410) return 'gone';
    return !e?.statusCode || e.statusCode === 429 || e.statusCode >= 500 ? 'retry' : 'error';
  }
}

export const transport = { expo: sendExpo, web: sendWeb };

const pushOn = () => process.env.PUSH_DISABLED !== 'true';
const webPushOn = () => !!process.env.VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY;

/** Runs `fn` over `items`, at most `limit` at a time. */
async function pooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

// ─── Claim, send, settle ───

/** MySQL picked this statement as the loser of a lock race: nothing was changed, run it again. */
async function retryOnDeadlock<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const text = `${err?.code ?? ''} ${err?.meta?.code ?? ''} ${err?.message ?? ''}`;
      if (attempt >= 5 || !/P2034|1213|1205|deadlock|write conflict/i.test(text)) throw err;
      await new Promise((r) => setTimeout(r, 20 * attempt + Math.floor(Math.random() * 50)));
    }
  }
}

async function claim(schoolId?: string): Promise<{ token: string; rows: Notification[] }> {
  const token = randomUUID();
  const now = new Date();
  const until = new Date(now.getTime() + LOCK_MS);
  // SKIP LOCKED: workers claiming at the same moment each take different rows instead of
  // queueing up behind (or deadlocking with) one another.
  const ids = await retryOnDeadlock(() => basePrisma.$transaction(async (tx) => {
    const due = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM notifications
      WHERE deliveryState = 'PENDING' AND deliverAfter <= ${now}
        AND (deliveryLockedUntil IS NULL OR deliveryLockedUntil < ${now})
        ${schoolId ? Prisma.sql`AND schoolId = ${schoolId}` : Prisma.empty}
      ORDER BY deliverAfter LIMIT ${BATCH}
      FOR UPDATE SKIP LOCKED`;
    if (!due.length) return [];
    const picked = due.map((r) => r.id);
    await tx.notification.updateMany({ where: { id: { in: picked } }, data: { deliveryLock: token, deliveryLockedUntil: until } });
    return picked;
  }, { isolationLevel: 'ReadCommitted', timeout: 20_000 }));
  if (!ids.length) return { token, rows: [] };
  return { token, rows: await basePrisma.notification.findMany({ where: { id: { in: ids }, deliveryLock: token, deliveryState: 'PENDING' } }) };
}

type Final = 'DELIVERED' | 'UNREACHED' | 'FAILED' | 'EXPIRED';

/**
 * One batch. Returns how many rows it claimed (BATCH means there is probably more).
 * `only.schoolId` limits it to one school (tests, or draining a single school by hand).
 */
export async function drainOnce(only?: { schoolId: string }): Promise<number> {
  const { token, rows } = await claim(only?.schoolId);
  if (!rows.length) return 0;

  const now = Date.now();
  const final = new Map<string, Final>();
  const live: Notification[] = [];
  for (const n of rows) {
    if (n.readAt) final.set(n.id, 'DELIVERED'); // already seen in the app
    else if (now - n.createdAt.getTime() > MAX_AGE_MS) final.set(n.id, 'EXPIRED');
    else live.push(n);
  }

  const ok = new Set<string>();
  const retry = new Set<string>();
  const targeted = new Set<string>();

  if (live.length && pushOn()) {
    const userIds = [...new Set(live.map((n) => n.userId))];
    const schoolIds = [...new Set(live.map((n) => n.schoolId))];
    const [devices, subs] = await Promise.all([
      basePrisma.deviceToken.findMany({ where: { schoolId: { in: schoolIds }, userId: { in: userIds } }, select: { token: true, userId: true, schoolId: true } }),
      webPushOn() ? basePrisma.pushSubscription.findMany({ where: { schoolId: { in: schoolIds }, userId: { in: userIds } } }) : Promise.resolve([]),
    ]);
    const key = (schoolId: string, userId: string) => `${schoolId}|${userId}`;
    const group = <T extends { schoolId: string; userId: string }>(list: T[]) => {
      const m = new Map<string, T[]>();
      for (const x of list) {
        const k = key(x.schoolId, x.userId);
        const have = m.get(k);
        if (have) have.push(x); else m.set(k, [x]);
      }
      return m;
    };
    const devicesOf = group(devices);
    const subsOf = group(subs);

    const note = (id: string, o: Outcome) => { if (o === 'ok') ok.add(id); else if (o === 'retry') retry.add(id); };

    // Phones
    const expo = live.flatMap((n) => (devicesOf.get(key(n.schoolId, n.userId)) ?? []).map((d) => ({
      id: n.id,
      message: { to: d.token, title: n.title, body: n.body, data: { type: n.type, ...((n.data as object | null) ?? {}), schoolId: n.schoolId, notificationId: n.id }, sound: 'default', channelId: 'default' } as ExpoMessage,
    })));
    if (expo.length) {
      expo.forEach((e) => targeted.add(e.id));
      const results = await transport.expo(expo.map((e) => e.message));
      const dead: string[] = [];
      results.forEach((o, i) => { note(expo[i].id, o); if (o === 'gone') dead.push(expo[i].message.to); });
      // Forget phones that uninstalled the app or revoked permission.
      if (dead.length) await basePrisma.deviceToken.deleteMany({ where: { token: { in: dead } } });
    }

    // Browsers
    const web = live.flatMap((n) => (subsOf.get(key(n.schoolId, n.userId)) ?? []).map((s) => ({ id: n.id, sub: s, payload: JSON.stringify({ title: n.title, body: n.body, url: '/notifications' }) })));
    if (web.length) {
      web.forEach((w) => targeted.add(w.id));
      const results = await pooled(web, 20, (w) => transport.web(w.sub, w.payload));
      const dead: string[] = [];
      results.forEach((o, i) => { note(web[i].id, o); if (o === 'gone') dead.push(web[i].sub.id); });
      if (dead.length) await basePrisma.pushSubscription.deleteMany({ where: { id: { in: dead } } });
    }
  }

  // Decide each row: done, or try again later.
  const later = new Map<number, string[]>(); // attempts so far, ids
  for (const n of live) {
    if (ok.has(n.id)) final.set(n.id, 'DELIVERED');
    else if (retry.has(n.id) && n.deliveryAttempts + 1 < MAX_ATTEMPTS) later.set(n.deliveryAttempts, [...(later.get(n.deliveryAttempts) ?? []), n.id]);
    else final.set(n.id, targeted.has(n.id) ? 'FAILED' : 'UNREACHED');
  }

  // Queue the texts before settling, so a crash in between cannot lose them.
  const texts = await queueFallbackTexts(live.filter((n) => final.get(n.id) === 'UNREACHED' || final.get(n.id) === 'FAILED'));

  const settledAt = new Date();
  const byState = new Map<Final, string[]>();
  for (const [id, state] of final) {
    const have = byState.get(state);
    if (have) have.push(id); else byState.set(state, [id]);
  }
  // `deliveryLock: token`: if this worker was so slow that its lock expired and another
  // worker took the rows over, it must not overwrite their result.
  await Promise.all([
    ...[...byState].map(([state, ids]) => retryOnDeadlock(() => basePrisma.notification.updateMany({
      where: { id: { in: ids }, deliveryLock: token },
      data: {
        deliveryState: state, deliveryAttempts: { increment: 1 }, deliveryLock: null, deliveryLockedUntil: null,
        deliveredAt: state === 'DELIVERED' ? settledAt : null,
        deliveryError: state === 'FAILED' ? 'Push services refused or were unreachable' : null,
      },
    }))),
    ...[...later].map(([attempts, ids]) => retryOnDeadlock(() => basePrisma.notification.updateMany({
      where: { id: { in: ids }, deliveryLock: token },
      data: { deliveryAttempts: { increment: 1 }, deliveryLock: null, deliveryLockedUntil: null, deliverAfter: new Date(settledAt.getTime() + BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)]) },
    }))),
  ]);
  for (const [state, ids] of byState) outcomes.inc({ outcome: state }, ids.length);
  const retried = [...later.values()].reduce((t, ids) => t + ids.length, 0);
  if (retried) outcomes.inc({ outcome: 'RETRY' }, retried);

  if (texts.length) deliverMessages(texts).catch((err) => logger.warn('Fallback text delivery failed', { message: (err as Error).message }));
  return rows.length;
}

/** Saves a text message for each urgent notification the app could not deliver. */
async function queueFallbackTexts(missed: Notification[]) {
  const urgent = missed.filter((n) => URGENT_TYPES.includes(n.type));
  const driver = activeDriver();
  if (!urgent.length || !driver) return [];

  const schools = await basePrisma.school.findMany({
    where: { id: { in: [...new Set(urgent.map((n) => n.schoolId))] }, messagingFallback: true },
    select: { id: true, name: true, messagingEnabled: true, messagingChannel: true, messagingTypes: true },
  });
  const schoolOf = new Map(schools.map((s) => [s.id, s]));
  // A type the school already texts to every family has gone out by text; don't send it twice.
  const wanted = urgent.filter((n) => {
    const s = schoolOf.get(n.schoolId);
    return s && !(s.messagingEnabled && Array.isArray(s.messagingTypes) && (s.messagingTypes as string[]).includes(n.type));
  });
  if (!wanted.length) return [];

  const users = await basePrisma.user.findMany({ where: { id: { in: [...new Set(wanted.map((n) => n.userId))] } }, select: { id: true, phone: true } });
  const phoneOf = new Map(users.map((u) => [u.id, toE164(u.phone)]));
  const drafts = wanted.flatMap((n) => {
    const to = phoneOf.get(n.userId);
    const s = schoolOf.get(n.schoolId)!;
    return to ? [{ schoolId: n.schoolId, type: n.type, channel: s.messagingChannel, to, body: `${s.name}: ${n.title}. ${n.body}`.slice(0, 600), provider: driver.name }] : [];
  });
  if (!drafts.length) return [];

  // The same words to the same number within a day are not repeated (two guardians sharing
  // a phone, a re-sent batch after a crash).
  const recent = await basePrisma.outboundMessage.findMany({
    where: { to: { in: [...new Set(drafts.map((d) => d.to))] }, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) } },
    select: { to: true, body: true },
  });
  const seen = new Set(recent.map((m) => `${m.to}|${m.body}`));
  const fresh = drafts.filter((d) => { const k = `${d.to}|${d.body}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return Promise.all(fresh.map((data) => basePrisma.outboundMessage.create({ data, select: { id: true, to: true, body: true, channel: true } })));
}

// ─── The worker loop ───

let timer: NodeJS.Timeout | undefined;
let running: Promise<void> | undefined;
let stopped = true;
let kicked = false;
let broadcastsCheckedAt = 0;
const CHECK_BROADCASTS_EVERY_MS = 20_000;

/** Scheduled broadcasts that have come due (loaded late: that module uses notify, which uses this one). */
async function sendDueBroadcasts() {
  if (Date.now() - broadcastsCheckedAt < CHECK_BROADCASTS_EVERY_MS) return;
  broadcastsCheckedAt = Date.now();
  const { sendDueBroadcasts: send } = await import('../modules/notifications/broadcasts');
  await send();
}

function schedule(ms: number) {
  if (stopped) return;
  clearTimeout(timer);
  timer = setTimeout(run, ms);
  timer.unref();
}

function run() {
  if (running) { kicked = true; return; }
  kicked = false;
  running = (async () => {
    try {
      await sendDueBroadcasts();
      while (!stopped && (await drainOnce()) === BATCH) { /* keep going while batches come back full */ }
    } catch (err) {
      logger.error('Notification delivery failed', { message: (err as Error).message });
    }
  })().finally(() => {
    running = undefined;
    // A little randomness so several workers don't all ask at the same instant.
    schedule(kicked ? 0 : POLL_MS + Math.floor(Math.random() * 1000));
  });
}

/** Each server process runs one. Off in tests and with JOBS_ENABLED=false. */
export function startDeliveryWorker() {
  if (process.env.NODE_ENV === 'test' || process.env.JOBS_ENABLED === 'false') return;
  stopped = false;
  schedule(2_000);
  logger.info('Notification delivery worker started');
}

/** New notifications were just saved: don't wait for the next poll. */
export function kickDeliveryWorker() {
  if (stopped) return;
  if (running) kicked = true; else schedule(0);
}

/** Stops claiming and waits for the batch in hand; anything unsettled is claimed again later. */
export async function stopDeliveryWorker() {
  stopped = true;
  clearTimeout(timer);
  await running;
}
