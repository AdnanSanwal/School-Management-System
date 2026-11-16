import { Router } from 'express';
import { z } from 'zod';
import prisma, { basePrisma } from '../../config/database';
import { currentSchoolId, runWithTenant } from '../../config/tenancy';
import { can } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { handler, parseBody } from '../../utils/http';
import { audit } from '../../utils/audit';
import { familiesOfSections, guardiansOf, notify } from '../../utils/notify';
import logger from '../../utils/logger';

/**
 * Messages the office sends to chosen people, now or at a set time, with a report of how
 * each one fared.
 *
 * A broadcast is saved first, then sent: sending creates one notification per person, each
 * tagged with the broadcast's id, and those go through the normal delivery queue. Sending
 * can be repeated safely (people who already have this broadcast are skipped), which is what
 * lets a send that was cut off by a restart be finished by another worker.
 */

const STAFF_AND_FAMILY = ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT'] as const;
/** A send that has made no progress for this long is assumed dead and taken over. */
const TAKE_OVER_AFTER_MS = 5 * 60_000;

const id = z.string().min(1).max(64);
const audienceSchema = z.object({
  everyone: z.boolean().optional(),
  roles: z.array(z.enum(STAFF_AND_FAMILY)).max(STAFF_AND_FAMILY.length).optional(),
  classIds: z.array(id).max(200).optional(),
  sectionIds: z.array(id).max(500).optional(),
  studentIds: z.array(id).max(500).optional(),
}).strict();
export type Audience = z.infer<typeof audienceSchema>;

const hasTarget = (a: Audience) => !!(a.everyone || a.roles?.length || a.classIds?.length || a.sectionIds?.length || a.studentIds?.length);

/** The app users an audience comes to. Runs inside the school's context. */
export async function resolveAudience(a: Audience): Promise<string[]> {
  const users = new Set<string>();
  if (a.everyone || a.roles?.length) {
    const rows = await prisma.user.findMany({
      where: { isActive: true, ...(a.everyone ? { role: { not: 'SUPER_ADMIN' } } : { role: { in: [...a.roles!] } }) },
      select: { id: true },
    });
    rows.forEach((u) => users.add(u.id));
  }
  const sectionIds = new Set(a.sectionIds ?? []);
  if (a.classIds?.length) {
    (await prisma.section.findMany({ where: { classId: { in: a.classIds } }, select: { id: true } })).forEach((s) => sectionIds.add(s.id));
  }
  if (sectionIds.size) (await familiesOfSections([...sectionIds])).forEach((u) => users.add(u));
  if (a.studentIds?.length) {
    const [parents, students] = await Promise.all([
      guardiansOf(a.studentIds),
      prisma.student.findMany({ where: { id: { in: a.studentIds }, userId: { not: null } }, select: { userId: true } }),
    ]);
    parents.forEach((p) => users.add(p.userId));
    students.forEach((s) => users.add(s.userId!));
  }
  // Only people who can still sign in.
  if (!users.size) return [];
  const active = await prisma.user.findMany({ where: { id: { in: [...users] }, isActive: true }, select: { id: true } });
  return active.map((u) => u.id);
}

/**
 * Sends a saved broadcast. Safe to call from several workers and more than once: only one
 * caller wins the claim, and people who already received it are skipped.
 * Returns the number of recipients, or null if someone else is sending it (or it is done).
 */
export async function sendBroadcast(broadcastId: string): Promise<number | null> {
  const now = new Date();
  const claimed = await basePrisma.broadcast.updateMany({
    where: { id: broadcastId, OR: [{ status: 'SCHEDULED' }, { status: 'SENDING', sendingSince: { lt: new Date(now.getTime() - TAKE_OVER_AFTER_MS) } }] },
    data: { status: 'SENDING', sendingSince: now },
  });
  if (!claimed.count) return null;
  const b = await basePrisma.broadcast.findUniqueOrThrow({ where: { id: broadcastId } });

  return runWithTenant(b.schoolId, async () => {
    const everyone = await resolveAudience(audienceSchema.parse(b.audience));
    const already = new Set((await prisma.notification.findMany({ where: { broadcastId: b.id }, select: { userId: true } })).map((n) => n.userId));
    await notify(everyone.filter((u) => !already.has(u)), { type: 'BROADCAST', title: b.title, body: b.body, data: { broadcastId: b.id } }, { broadcastId: b.id });
    const recipients = new Set([...everyone, ...already]).size;
    await basePrisma.broadcast.update({ where: { id: b.id }, data: { status: 'SENT', sentAt: new Date(), sendingSince: null, recipients } });
    return recipients;
  });
}

/** Called by the delivery worker: sends whatever is due, and finishes sends that were cut off. */
export async function sendDueBroadcasts(now = new Date()): Promise<number> {
  const due = await basePrisma.broadcast.findMany({
    where: { OR: [{ status: 'SCHEDULED', scheduledAt: { lte: now } }, { status: 'SENDING', sendingSince: { lt: new Date(now.getTime() - TAKE_OVER_AFTER_MS) } }] },
    select: { id: true },
    orderBy: { scheduledAt: 'asc' },
    take: 20,
  });
  let sent = 0;
  for (const b of due) {
    try {
      if ((await sendBroadcast(b.id)) !== null) sent++;
    } catch (err) {
      logger.error('Broadcast could not be sent; it will be tried again', { broadcastId: b.id, message: (err as Error).message });
    }
  }
  return sent;
}

// ─── Report ───

interface Report { sent: number; delivered: number; unreached: number; failed: number; waiting: number; muted: number; read: number }

async function reportsFor(ids: string[]): Promise<Map<string, Report>> {
  const out = new Map<string, Report>(ids.map((i) => [i, { sent: 0, delivered: 0, unreached: 0, failed: 0, waiting: 0, muted: 0, read: 0 }]));
  if (!ids.length) return out;
  const [states, read] = await Promise.all([
    prisma.notification.groupBy({ by: ['broadcastId', 'deliveryState'], where: { broadcastId: { in: ids } }, _count: true }),
    prisma.notification.groupBy({ by: ['broadcastId'], where: { broadcastId: { in: ids }, readAt: { not: null } }, _count: true }),
  ]);
  for (const s of states) {
    const r = out.get(s.broadcastId!)!;
    r.sent += s._count;
    if (s.deliveryState === 'DELIVERED') r.delivered += s._count;
    else if (s.deliveryState === 'UNREACHED') r.unreached += s._count;
    else if (s.deliveryState === 'FAILED' || s.deliveryState === 'EXPIRED') r.failed += s._count;
    else if (s.deliveryState === 'PENDING') r.waiting += s._count;
    else r.muted += s._count;
  }
  for (const s of read) out.get(s.broadcastId!)!.read = s._count;
  return out;
}

// ─── Routes (mounted at /notifications/broadcasts, after authenticate) ───

const router = Router();
router.use(can('message.broadcast', 'notice.publish'));

router.get('/', handler(async (_req, res) => {
  const rows = await prisma.broadcast.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
  const [reports, authors] = await Promise.all([
    reportsFor(rows.filter((b) => b.status === 'SENT' || b.status === 'SENDING').map((b) => b.id)),
    prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((b) => b.createdById))] } }, select: { id: true, name: true } }),
  ]);
  const nameOf = new Map(authors.map((u) => [u.id, u.name]));
  return sendSuccess(res, rows.map((b) => ({ ...b, createdBy: nameOf.get(b.createdById) ?? null, report: reports.get(b.id) ?? null })));
}));

/** How many people an audience comes to, before sending. */
router.post('/preview', handler(async (req, res) => {
  const { audience } = parseBody(z.object({ audience: audienceSchema }), req);
  return sendSuccess(res, { recipients: hasTarget(audience) ? (await resolveAudience(audience)).length : 0 });
}));

router.post('/', handler(async (req, res) => {
  const b = parseBody(z.object({
    title: z.string().trim().min(1).max(150),
    message: z.string().trim().min(1).max(2000),
    audience: audienceSchema,
    scheduledAt: z.string().datetime().nullable().optional(),
  }), req);
  if (!hasTarget(b.audience)) throw new AppError('Choose who should receive this message', 422);
  const when = b.scheduledAt ? new Date(b.scheduledAt) : null;
  if (when && when.getTime() < Date.now() + 60_000) throw new AppError('Choose a time at least a minute from now, or send it now', 422);
  if (when && when.getTime() > Date.now() + 366 * 86_400_000) throw new AppError('That is more than a year away', 422);

  // Ids must be this school's own (the tenant-scoped client only sees this school).
  const [classes, sections, students] = await Promise.all([
    b.audience.classIds?.length ? prisma.class.count({ where: { id: { in: b.audience.classIds } } }) : 0,
    b.audience.sectionIds?.length ? prisma.section.count({ where: { id: { in: b.audience.sectionIds } } }) : 0,
    b.audience.studentIds?.length ? prisma.student.count({ where: { id: { in: b.audience.studentIds } } }) : 0,
  ]);
  if (classes !== new Set(b.audience.classIds ?? []).size || sections !== new Set(b.audience.sectionIds ?? []).size || students !== new Set(b.audience.studentIds ?? []).size) {
    throw new AppError('Some of the chosen classes, sections or students were not found', 422);
  }
  if (!when && !(await resolveAudience(b.audience)).length) throw new AppError('Nobody in that audience has an app login yet', 422);

  const created = await prisma.broadcast.create({
    data: { schoolId: currentSchoolId(), title: b.title, body: b.message, audience: b.audience, scheduledAt: when, createdById: req.user!.id },
  });
  await audit(req, { action: when ? 'BROADCAST_SCHEDULED' : 'BROADCAST_SENT', entity: 'Broadcast', entityId: created.id, meta: { title: b.title, audience: b.audience, scheduledAt: when } });
  if (when) return sendSuccess(res, created, 'Message scheduled', 201);

  const recipients = await sendBroadcast(created.id);
  return sendSuccess(res, { ...created, status: 'SENT', recipients }, `Message sent to ${recipients} ${recipients === 1 ? 'person' : 'people'}`, 201);
}));

router.get('/:id', handler(async (req, res) => {
  const b = await prisma.broadcast.findFirst({ where: { id: req.params.id } });
  if (!b) throw new AppError('Message not found', 404);
  const [reports, missed] = await Promise.all([
    reportsFor([b.id]),
    // The people it did not reach, so the office can follow up another way.
    prisma.notification.findMany({
      where: { broadcastId: b.id, deliveryState: { in: ['UNREACHED', 'FAILED', 'EXPIRED'] }, readAt: null },
      select: { deliveryState: true, user: { select: { id: true, name: true, role: true, phone: true } } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    }),
  ]);
  return sendSuccess(res, { ...b, report: reports.get(b.id), notReached: missed.map((m) => ({ ...m.user, state: m.deliveryState })) });
}));

/** Cancels a message that has not gone out yet. */
router.delete('/:id', handler(async (req, res) => {
  const done = await prisma.broadcast.updateMany({ where: { id: req.params.id, status: 'SCHEDULED' }, data: { status: 'CANCELLED' } });
  if (!done.count) throw new AppError('Only a message that has not been sent yet can be cancelled', 409);
  await audit(req, { action: 'BROADCAST_CANCELLED', entity: 'Broadcast', entityId: req.params.id });
  return sendSuccess(res, null, 'Scheduled message cancelled');
}));

export default router;
