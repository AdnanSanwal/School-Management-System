import { Request, Response, NextFunction } from 'express';
import { verifyToken, JwtPayload } from '../utils/jwt';
import { sendError } from '../utils/apiResponse';
import { isRevoked } from '../utils/sessions';
import { tenantStorage, TenantContext } from '../config/tenancy';
import { roleOverrides } from '../utils/rolePermissions';

export interface AuthRequest extends Request {
  user?: JwtPayload;
}

/**
 * Verifies the bearer token and runs the rest of the request inside the user's
 * tenant context, so the scoped Prisma client only sees that school's rows.
 */
const PASSWORD_CHANGE_ALLOWED = /^\/api\/v1\/auth\/(me|change-password|logout)$/;

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return sendError(res, 'No token provided', 401);
  }

  const token = authHeader.split(' ')[1];
  let user: JwtPayload;
  try {
    user = verifyToken(token);
    if (await isRevoked(token, user)) return sendError(res, 'Session ended. Please sign in again.', 401);
  } catch {
    return sendError(res, 'Invalid or expired token', 401);
  }

  // An admin-chosen password must be replaced before anything else.
  if (user.pwc && !PASSWORD_CHANGE_ALLOWED.test(req.originalUrl.split('?')[0])) {
    return res.status(403).json({ success: false, code: 'PASSWORD_CHANGE_REQUIRED', message: 'Please set your own password first' });
  }

  let ctx: TenantContext;
  if (user.role === 'SUPER_ADMIN') ctx = { kind: 'system' };
  else if (user.schoolId) ctx = { kind: 'tenant', schoolId: user.schoolId, roles: await roleOverrides(user.schoolId) };
  else return sendError(res, 'Token has no school', 401);

  req.user = user;
  tenantStorage.run(ctx, () => next());
}
