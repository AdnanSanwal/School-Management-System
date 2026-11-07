import { Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { AuthRequest } from '../../middleware/auth';
import prisma from '../../config/database';
import { sendSuccess } from '../../utils/apiResponse';
import { getIO } from '../../config/socket';
import { sendEmail, sendSMS } from '../../utils/email';
import { schoolRoom } from '../../config/socket';
import { currentSchoolId } from '../../config/tenancy';

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return sendSuccess(res, notifications);
  } catch (err) { next(err); }
}

const BROADCAST_ROLES = new Set<Role>(['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT']);

export async function broadcast(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { title, message, roles, channels } = req.body as {
      title: string; message: string; roles?: Role[]; channels?: string[];
    };
    const targetRoles = (roles ?? []).filter((r) => BROADCAST_ROLES.has(r));
    const users = await prisma.user.findMany({
      where: { isActive: true, ...(targetRoles.length ? { role: { in: targetRoles } } : { role: { not: 'SUPER_ADMIN' } }) },
      select: { id: true, email: true, phone: true },
    });

    await prisma.notification.createMany({
      data: users.map((u) => ({ schoolId: currentSchoolId(), userId: u.id, type: 'BROADCAST', title, body: message })),
    });

    if (channels?.includes('socket')) {
      const io = getIO();
      const schoolId = req.user!.schoolId!;
      if (targetRoles.length) targetRoles.forEach((r) => io.to(schoolRoom(schoolId, r)).emit('notification', { title, message }));
      else io.to(schoolRoom(schoolId)).emit('notification', { title, message });
    }
    if (channels?.includes('email')) {
      await Promise.allSettled(users.map((u) => sendEmail({ to: u.email, subject: title, html: `<p>${message}</p>` })));
    }
    if (channels?.includes('sms')) {
      await Promise.allSettled(users.filter((u) => u.phone).map((u) => sendSMS(u.phone!, message)));
    }

    return sendSuccess(res, null, `Notification sent to ${users.length} users`);
  } catch (err) { next(err); }
}

export async function markRead(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // updateMany + userId filter: a user can only mark their own notifications.
    await prisma.notification.updateMany({
      where: { id: req.params.id, userId: req.user!.id },
      data: { readAt: new Date() },
    });
    return sendSuccess(res, null, 'Marked as read');
  } catch (err) { next(err); }
}

export async function markAllRead(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user!.id, readAt: null },
      data: { readAt: new Date() },
    });
    return sendSuccess(res, null, 'All notifications marked as read');
  } catch (err) { next(err); }
}
