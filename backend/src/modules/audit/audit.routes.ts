import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { basePrisma } from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { authenticate } from '../../middleware/auth';
import { can } from '../../middleware/rbac';
import { sendPaginated } from '../../utils/apiResponse';
import { handler, parseQuery, paginationSchema, paging, id } from '../../utils/http';

// Who changed what, for the owner and principal. AuditLog isn't a tenant-scoped model
// (platform actions have no school), so every query pins schoolId explicitly.
const router = Router();
router.use(authenticate, can('audit.view'));

router.get('/', handler(async (req, res) => {
  const q = parseQuery(paginationSchema.extend({
    userId: id.optional(),
    entity: z.string().max(60).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  }), req);
  const where: Prisma.AuditLogWhereInput = {
    schoolId: currentSchoolId(),
    ...(q.userId ? { userId: q.userId } : {}),
    ...(q.entity ? { entity: q.entity } : {}),
    ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: new Date(q.to.getTime() + 86_400_000) } : {}) } } : {}),
  };
  const [rows, total] = await Promise.all([
    basePrisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...paging(q) }),
    basePrisma.auditLog.count({ where }),
  ]);
  const users = await basePrisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.userId).filter(Boolean) as string[])] }, schoolId: currentSchoolId() },
    select: { id: true, name: true, role: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  return sendPaginated(res, rows.map((r) => ({ ...r, user: r.userId ? byId.get(r.userId) ?? null : null })), total, q.page, q.limit);
}));

export default router;
