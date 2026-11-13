import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { basePrisma } from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { authenticate } from '../../middleware/auth';
import { can } from '../../middleware/rbac';
import { sendSuccess } from '../../utils/apiResponse';
import { handler, parseQuery, paginationSchema, paging, id, dateOnly } from '../../utils/http';
import { addDays, schoolTimezone, zonedDayStart } from '../../utils/dates';
import { auditKind, safeAuditMeta } from './audit.presentation';

// Who changed what, for the owner and principal. AuditLog isn't a tenant-scoped model
// (platform actions have no school), so every query pins schoolId explicitly.
const router = Router();
router.use(authenticate, can('audit.view'));

const day = dateOnly.refine(s => { const d = new Date(`${s}T00:00:00Z`); return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === s; }, 'Invalid calendar date');
const filters = paginationSchema.extend({
  userId: id.optional(), entity: z.string().trim().min(1).max(60).optional(),
  from: day.optional(), to: day.optional(), search: z.string().trim().max(120).optional(),
  kind: z.enum(['activity', 'request', 'security']).optional(),
}).refine(q => !q.from || !q.to || q.from <= q.to, { message: 'From date must not be after To date', path: ['to'] });

router.get('/options', handler(async (_req, res) => {
  const schoolId = currentSchoolId();
  const [entities, actors, timezone] = await Promise.all([
    basePrisma.auditLog.groupBy({ by: ['entity'], where: { schoolId }, orderBy: { entity: 'asc' } }),
    basePrisma.auditLog.groupBy({ by: ['userId'], where: { schoolId, userId: { not: null } } }),
    schoolTimezone(),
  ]);
  // Brand owners may be homed in another branch. Resolve only actors already in
  // this branch's log, never the global user directory.
  const users = await basePrisma.user.findMany({ where: { id: { in: actors.map(a => a.userId!).filter(Boolean) } }, select: { id: true, name: true, role: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
  return sendSuccess(res, { entities: entities.map(e => e.entity), users, timezone });
}));

router.get('/', handler(async (req, res) => {
  const q = parseQuery(filters, req);
  const schoolId = currentSchoolId();
  const timezone = await schoolTimezone();
  const AND: Prisma.AuditLogWhereInput[] = [];
  if (q.kind === 'security') AND.push({ entity: 'auth' });
  if (q.kind === 'request') AND.push({ action: { contains: ' /' }, NOT: { entity: 'auth' } });
  if (q.kind === 'activity') AND.push({ NOT: [{ entity: 'auth' }, { action: { contains: ' /' } }] });
  if (q.search) {
    const actors = await basePrisma.auditLog.groupBy({ by: ['userId'], where: { schoolId, userId: { not: null } } });
    const matching = await basePrisma.user.findMany({ where: { id: { in: actors.map(a => a.userId!) }, name: { contains: q.search } }, select: { id: true } });
    AND.push({ OR: [ ...(['action', 'entity', 'entityId', 'ipAddress'] as const).map(key => ({ [key]: { contains: q.search } })), { userId: { in: matching.map(u => u.id) } } ] });
  }
  const where: Prisma.AuditLogWhereInput = {
    schoolId,
    ...(q.userId ? { userId: q.userId } : {}),
    ...(q.entity ? { entity: q.entity } : {}),
    ...(q.from || q.to ? { createdAt: {
      ...(q.from ? { gte: zonedDayStart(q.from, timezone) } : {}),
      ...(q.to ? { lt: zonedDayStart(addDays(new Date(`${q.to}T00:00:00Z`), 1).toISOString().slice(0, 10), timezone) } : {}),
    } } : {}), ...(AND.length ? { AND } : {}),
  };
  const [rows, total] = await Promise.all([
    basePrisma.auditLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...paging(q) }),
    basePrisma.auditLog.count({ where }),
  ]);
  const users = await basePrisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.userId).filter(Boolean) as string[])] } },
    select: { id: true, name: true, role: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  return res.json({ success: true, data: rows.map(r => ({ ...r, meta: safeAuditMeta(r.meta), kind: auditKind(r), user: r.userId ? byId.get(r.userId) ?? null : null })), pagination: { total, page: q.page, limit: q.limit, pages: Math.ceil(total / q.limit) }, timezone });
}));

export default router;
