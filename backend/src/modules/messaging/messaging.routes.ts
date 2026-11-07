import { Router } from 'express';
import { z } from 'zod';
import { MessagingChannel } from '@prisma/client';
import prisma from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { authenticate } from '../../middleware/auth';
import { can } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { handler, parseBody } from '../../utils/http';
import { activeDriver, deliver, MESSAGE_TYPES, toE164 } from '../../utils/messaging';

// School settings for WhatsApp/SMS alerts, a delivery log, and a test send.

const router = Router();
router.use(authenticate, can('school.manage'));

router.get('/', handler(async (_req, res) => {
  const [school, recent, counts] = await Promise.all([
    prisma.school.findUniqueOrThrow({ where: { id: currentSchoolId() }, select: { messagingEnabled: true, messagingChannel: true, messagingTypes: true } }),
    prisma.outboundMessage.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.outboundMessage.groupBy({ by: ['status'], _count: true, where: { createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } }),
  ]);
  const driver = activeDriver();
  return sendSuccess(res, {
    ...school,
    messagingTypes: Array.isArray(school.messagingTypes) ? school.messagingTypes : [],
    availableTypes: MESSAGE_TYPES,
    provider: driver?.name ?? null,
    last30Days: Object.fromEntries(counts.map((c) => [c.status, c._count])),
    recent,
  });
}));

router.put('/', handler(async (req, res) => {
  const b = parseBody(z.object({
    messagingEnabled: z.boolean(),
    messagingChannel: z.nativeEnum(MessagingChannel),
    messagingTypes: z.array(z.enum(MESSAGE_TYPES as [string, ...string[]])).max(MESSAGE_TYPES.length),
  }), req);
  await prisma.school.update({ where: { id: currentSchoolId() }, data: b });
  return sendSuccess(res, null, b.messagingEnabled ? 'WhatsApp/SMS alerts on' : 'WhatsApp/SMS alerts off');
}));

router.post('/test', handler(async (req, res) => {
  const { phone } = parseBody(z.object({ phone: z.string().min(7).max(32) }), req);
  const to = toE164(phone);
  if (!to) throw new AppError('That phone number does not look valid', 422);
  if (!activeDriver()) throw new AppError('No messaging provider is configured on the server (MESSAGING_PROVIDER)', 503);
  const school = await prisma.school.findUniqueOrThrow({ where: { id: currentSchoolId() }, select: { name: true, messagingChannel: true } });
  const msg = await prisma.outboundMessage.create({
    data: { schoolId: currentSchoolId(), type: 'TEST', channel: school.messagingChannel, to, body: `${school.name}: test message from the school ERP.`, provider: activeDriver()!.name },
  });
  await deliver([msg]);
  const after = await prisma.outboundMessage.findUniqueOrThrow({ where: { id: msg.id } });
  return sendSuccess(res, after, after.status === 'SENT' ? `Sent to ${to}` : `Failed: ${after.error}`);
}));

export default router;
