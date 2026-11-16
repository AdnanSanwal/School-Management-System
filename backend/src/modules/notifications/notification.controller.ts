import { Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { AuthRequest } from '../../middleware/auth';
import prisma from '../../config/database';
import { sendSuccess } from '../../utils/apiResponse';
import { sendEmail, sendSMS } from '../../utils/email';
import { parseBody } from '../../utils/http';
import { hasPermission } from '../../middleware/rbac';
import { notify } from '../../utils/notify';
import { emitToUsers } from '../../utils/live';
import { mutedList, typesFor } from '../../utils/notificationRules';

/**
 * The signed-in user's notifications, newest first. `?before=<createdAt of the last row>`
 * loads the next page; `?limit=` up to 100 (default 50).
 */
export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const q = z.object({
      before: z.string().datetime().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }).safeParse(req.query);
    const { before, limit } = q.success ? q.data : { before: undefined, limit: 50 };
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user!.id, ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: { id: true, schoolId: true, userId: true, type: true, title: true, body: true, data: true, readAt: true, createdAt: true },
    });
    return sendSuccess(res, notifications);
  } catch (err) { next(err); }
}

/** The number on the bell. */
export async function unreadCount(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const count = await prisma.notification.count({ where: { userId: req.user!.id, readAt: null } });
    return sendSuccess(res, { count });
  } catch (err) { next(err); }
}

const BROADCAST_ROLES = new Set<Role>(['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT']);

export async function broadcast(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // Validated (API-2): bounded text, known roles and channels. Email and SMS go to the
    // whole school, so they need message.broadcast, not just notice.publish.
    const { title, message, roles, channels } = parseBody(z.object({
      title: z.string().trim().min(1).max(150),
      message: z.string().trim().min(1).max(2000),
      roles: z.array(z.enum(['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT'])).max(7).optional(),
      channels: z.array(z.enum(['socket', 'email', 'sms', 'push'])).max(4).optional(),
    }), req);
    if (channels?.some((c) => c === 'email' || c === 'sms') && !hasPermission(req.user!.role, 'message.broadcast')) {
      return res.status(403).json({ success: false, message: 'Sending email or SMS to everyone needs the "send messages" permission' });
    }
    const targetRoles = (roles ?? []).filter((r) => BROADCAST_ROLES.has(r));
    const users = await prisma.user.findMany({
      where: { isActive: true, ...(targetRoles.length ? { role: { in: targetRoles } } : { role: { not: 'SUPER_ADMIN' } }) },
      select: { id: true, email: true, phone: true },
    });

    // In the app, live on open screens, and pushed to phones and browsers.
    await notify(users.map((u) => u.id), { type: 'BROADCAST', title, body: message });

    if (channels?.includes('email')) {
      // Escape: the message is typed by school staff and must not become HTML in the email.
      const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
      await Promise.allSettled(users.filter((u) => u.email).map((u) => sendEmail({ to: u.email!, subject: title, html: `<p>${esc(message)}</p>` })));
    }
    if (channels?.includes('sms')) {
      await Promise.allSettled(users.filter((u) => u.phone).map((u) => sendSMS(u.phone!, message)));
    }

    return sendSuccess(res, null, `Notification sent to ${users.length} users`);
  } catch (err) { next(err); }
}

/** The user's other open screens drop their badge too. */
function tellOtherScreens(req: AuthRequest) {
  const schoolId = req.user!.schoolId;
  return schoolId ? emitToUsers(schoolId, 'notifications:read', [{ userId: req.user!.id, payload: {} }]) : Promise.resolve();
}

export async function markRead(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // updateMany + userId filter: a user can only mark their own notifications.
    const done = await prisma.notification.updateMany({
      where: { id: req.params.id, userId: req.user!.id, readAt: null },
      data: { readAt: new Date() },
    });
    if (done.count) await tellOtherScreens(req);
    return sendSuccess(res, null, 'Marked as read');
  } catch (err) { next(err); }
}

export async function markAllRead(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const done = await prisma.notification.updateMany({
      where: { userId: req.user!.id, readAt: null },
      data: { readAt: new Date() },
    });
    if (done.count) await tellOtherScreens(req);
    return sendSuccess(res, null, 'All notifications marked as read');
  } catch (err) { next(err); }
}

/** What this person can be told about, and which types they have switched off. */
export async function getPreferences(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const me = await prisma.user.findFirst({ where: { id: req.user!.id }, select: { mutedNotifications: true } });
    const muted = new Set(mutedList(me?.mutedNotifications));
    return sendSuccess(res, { types: typesFor(req.user!.role).map((t) => ({ ...t, muted: muted.has(t.type) })) });
  } catch (err) { next(err); }
}

export async function setPreferences(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { muted } = parseBody(z.object({ muted: z.array(z.string().max(40)).max(40) }), req);
    // mutedList drops anything unknown or not allowed to be muted (urgent alerts, office messages).
    const clean = mutedList(muted);
    await prisma.user.updateMany({ where: { id: req.user!.id }, data: { mutedNotifications: clean } });
    return sendSuccess(res, { muted: clean }, 'Notification settings saved');
  } catch (err) { next(err); }
}
