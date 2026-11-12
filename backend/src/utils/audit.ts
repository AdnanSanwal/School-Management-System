import type { Prisma } from '@prisma/client';
import { basePrisma } from '../config/database';
import { currentSchoolId } from '../config/tenancy';
import type { AuthRequest } from '../middleware/auth';
import logger from './logger';

/**
 * A detailed activity-log entry (who, when, what changed — e.g. previous and new status).
 * The generic trail in middleware/audit.ts records every change by route; use this where
 * the details matter. `action` is a short readable phrase: "Status changed", "Role created".
 */
export async function audit(req: AuthRequest, entry: { action: string; entity: string; entityId?: string | null; meta?: Record<string, unknown> }) {
  const user = req.user;
  if (!user) return;
  try {
    await basePrisma.auditLog.create({
      data: {
        schoolId: user.schoolId, userId: user.id,
        action: entry.action.slice(0, 190), entity: entry.entity.slice(0, 190), entityId: entry.entityId ?? null,
        meta: (entry.meta ?? {}) as Prisma.InputJsonValue, ipAddress: req.ip ?? null,
      },
    });
  } catch (err) {
    logger.warn('activity log write failed', { error: (err as Error).message });
  }
}

/** The latest activity-log entries about one record (e.g. a student or staff member), newest first. */
export async function activityFor(entity: string, entityId: string, take = 30) {
  const schoolId = currentSchoolId();
  const rows = await basePrisma.auditLog.findMany({
    where: { schoolId, entity, entityId, NOT: { action: { contains: ' /' } } }, // skip the generic "POST /route" trail rows
    orderBy: { createdAt: 'desc' }, take,
  });
  const users = await basePrisma.user.findMany({ where: { schoolId, id: { in: [...new Set(rows.map((r) => r.userId).filter(Boolean) as string[])] } }, select: { id: true, name: true } });
  const name = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({ id: r.id, action: r.action, at: r.createdAt, by: r.userId ? name.get(r.userId) ?? null : null, meta: r.meta }));
}
