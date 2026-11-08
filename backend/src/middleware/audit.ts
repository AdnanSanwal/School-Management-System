import type { Request, Response, NextFunction } from 'express';
import { basePrisma } from '../config/database';
import logger from '../utils/logger';
import { bumpSchoolDataVersion } from '../utils/cache';

/**
 * Audit trail: one AuditLog row per successful change (POST/PUT/PATCH/DELETE), with who,
 * which school, the route and the record id — never the request body, so passwords and
 * personal data don't end up in it. Written after the response is sent and never blocks
 * or fails the request.
 */
const SKIP = [/^\/api\/v1\/auth\/(login|refresh|forgot-password|reset-password)$/, /^\/api\/v1\/push\//, /^\/api\/v1\/notifications\/.*read/];

export function auditTrail(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    const path = req.originalUrl.split('?')[0];
    if (SKIP.some((re) => re.test(path))) return;
    const user = (req as any).user as { id: string; schoolId: string | null } | undefined;
    if (!user) return;
    // Any change can affect cached summaries (dashboard): invalidate this school's caches.
    if (user.schoolId) bumpSchoolDataVersion(user.schoolId);
    // "/api/v1/students/:id/status" — the route pattern groups the same action together.
    const route = `${req.baseUrl}${req.route?.path ?? ''}`.replace(/^\/api\/v1/, '') || path;
    const entity = route.split('/')[1] || 'unknown';
    basePrisma.auditLog.create({
      data: {
        schoolId: user.schoolId,
        userId: user.id,
        action: `${req.method} ${route}`.slice(0, 190),
        entity: entity.slice(0, 190),
        entityId: (req.params?.id ?? req.params?.studentId ?? null)?.toString().slice(0, 190) ?? null,
        meta: { status: res.statusCode, requestId: req.id },
        ipAddress: req.ip ?? null,
      },
    }).catch((err) => logger.warn('audit log write failed', { requestId: req.id, error: (err as Error).message }));
  });
  next();
}
