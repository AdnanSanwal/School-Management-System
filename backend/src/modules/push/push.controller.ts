import { Response, NextFunction } from 'express';
import webpush from 'web-push';
import { AuthRequest } from '../../middleware/auth';
import prisma, { basePrisma } from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { sendSuccess, sendError } from '../../utils/apiResponse';
import logger from '../../utils/logger';
import { z } from 'zod';
import { parseBody } from '../../utils/http';

// Configure VAPID once at module load
let VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
let VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  try {
    webpush.setVapidDetails(
      `mailto:${process.env.EMAIL_FROM || 'admin@school.com'}`,
      VAPID_PUBLIC,
      VAPID_PRIVATE
    );
  } catch (err) {
    // Invalid keys (e.g. the .env.example placeholders) must not stop the API from starting.
    logger.warn('Invalid VAPID keys — web push disabled', { error: (err as Error).message });
    VAPID_PUBLIC = '';
    VAPID_PRIVATE = '';
  }
}

export async function getVapidKey(_req: AuthRequest, res: Response) {
  return sendSuccess(res, { publicKey: VAPID_PUBLIC });
}

export async function subscribe(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // Browsers' PushSubscription.toJSON() nests the keys; accept flat fields too.
    const { endpoint } = req.body;
    const keys = req.body.keys ?? { p256dh: req.body.p256dh, auth: req.body.auth };
    if (typeof endpoint !== 'string' || !endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(422).json({ success: false, message: 'endpoint and keys.p256dh / keys.auth are required' });
    }
    if (!isPushServiceUrl(endpoint) || !/^[A-Za-z0-9_-]{20,200}$/.test(String(keys.p256dh)) || !/^[A-Za-z0-9_-]{8,100}$/.test(String(keys.auth))) {
      return res.status(422).json({ success: false, message: 'Not a browser push subscription' });
    }
    // Endpoint is globally unique; scoped upsert means another school's row can't be hijacked.
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: { userId: req.user!.id, p256dh: keys.p256dh, auth: keys.auth },
      create: { schoolId: currentSchoolId(), userId: req.user!.id, endpoint, p256dh: keys.p256dh, auth: keys.auth },
    });
    return sendSuccess(res, null, 'Subscribed to push notifications', 201);
  } catch (err) { next(err); }
}

export async function unsubscribe(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // Only this browser's subscription; the user's other devices keep receiving pushes.
    const endpoint = req.body?.endpoint ?? req.query.endpoint;
    await prisma.pushSubscription.deleteMany({ where: { userId: req.user!.id, ...(endpoint ? { endpoint: String(endpoint) } : {}) } });
    return sendSuccess(res, null, 'Unsubscribed');
  } catch (err) { next(err); }
}

export async function sendPush(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { title, body, url, roles, userIds } = parseBody(z.object({
      title: z.string().trim().min(1).max(150),
      body: z.string().trim().min(1).max(1000),
      url: z.string().max(300).regex(/^\/(?![/\\])/, 'A path inside the app, e.g. /notices').optional(),
      roles: z.array(z.enum(['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT'])).max(7).optional(),
      userIds: z.array(z.string().uuid()).max(1000).optional(),
    }), req);

    const where: any = {};
    if (userIds?.length) where.userId = { in: userIds };
    else if (roles?.length) where.user = { role: { in: roles } };

    const subscriptions = await prisma.pushSubscription.findMany({
      where,
      include: { user: { select: { id: true } } },
    });

    const payload = JSON.stringify({ title, body, url: url || '/', icon: '/icon-192.png' });

    const results = await Promise.allSettled(
      subscriptions.map(sub =>
        webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
      )
    );

    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length) logger.warn(`Push: ${failed.length} failed out of ${subscriptions.length}`);

    return sendSuccess(res, { sent: subscriptions.length - failed.length, failed: failed.length });
  } catch (err) { next(err); }
}

// ─── Mobile (Expo) device tokens ───

const EXPO_TOKEN = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/;

export async function registerDevice(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { token, platform } = req.body as { token?: string; platform?: string };
    if (!token || !EXPO_TOKEN.test(token)) return sendError(res, 'Invalid push token', 422);
    // A phone belongs to whoever signed in last: hand the token over from any previous user/school.
    await basePrisma.deviceToken.deleteMany({ where: { token, NOT: { userId: req.user!.id } } });
    await prisma.deviceToken.upsert({
      where: { token },
      update: { platform: (platform ?? 'unknown').slice(0, 16) },
      create: { schoolId: currentSchoolId(), userId: req.user!.id, token, platform: (platform ?? 'unknown').slice(0, 16) },
    });
    return sendSuccess(res, null, 'Device registered', 201);
  } catch (err) { next(err); }
}

export async function unregisterDevice(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { token } = req.body as { token?: string };
    if (token) await prisma.deviceToken.deleteMany({ where: { token, userId: req.user!.id } });
    return sendSuccess(res, null, 'Device removed');
  } catch (err) { next(err); }
}

/**
 * The server POSTs to every stored endpoint, so only the browsers' push services are
 * accepted (SECURITY_FINDINGS API-1): never an internal address or arbitrary host.
 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /^web\.push\.apple\.com$/];
export function isPushServiceUrl(endpoint: string) {
  if (endpoint.length > 1000) return false;
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && !u.username && !u.password && (u.port === '' || u.port === '443') && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch { return false; }
}
