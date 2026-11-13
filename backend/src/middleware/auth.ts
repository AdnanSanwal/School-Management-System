import { Request, Response, NextFunction } from 'express';
import { verifyToken, JwtPayload } from '../utils/jwt';
import { sendError } from '../utils/apiResponse';
import { isRevoked } from '../utils/sessions';
import { tenantStorage, TenantContext } from '../config/tenancy';
import { branchIdentity, validateBranchToken } from '../utils/branches';
import { customRoleList, roleOverrides } from '../utils/rolePermissions';
import { licenceStatus, LOCKED_MESSAGE } from '../utils/licence';

export interface AuthRequest extends Request {
  user?: JwtPayload;
}

/**
 * Verifies the bearer token and runs the rest of the request inside the user's
 * tenant context, so the scoped Prisma client only sees that school's rows.
 */
const PASSWORD_CHANGE_ALLOWED = /^\/api\/v1\/auth\/(me|change-password|logout)$/;
// A school whose subscription has run out can still sign in, see why, and sign out.
const LOCKED_ALLOWED = /^\/api\/v1\/(auth\/|licence(\/|$))/;

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
  if (user.role === 'SUPER_ADMIN') {
    try { await validateBranchToken(user); } catch { return sendError(res, 'Session ended', 401); }
    ctx = { kind: 'system' };
  }
  else if (user.schoolId) {
    let identity;
    try { identity = await branchIdentity(user.id, user.schoolId); }
    catch { return sendError(res, 'Branch access is unavailable. Please sign in again.', 403); }
    if (identity.role !== user.role) return sendError(res, 'Branch permissions changed. Please sign in again.', 401);
    const roles = await roleOverrides(user.schoolId);
    const custom = identity.customRoleId ? (await customRoleList(user.schoolId)).find(r => r.id === identity.customRoleId && r.baseRole === user.role) : undefined;
    if (identity.customRoleId && !custom) return sendError(res, 'Assigned branch role is unavailable', 403);
    ctx = { kind: 'tenant', schoolId: user.schoolId, roles, ...(custom && custom.baseRole === user.role ? { custom: { role: user.role, perms: custom.perms } } : {}) };
  }
  else return sendError(res, 'Token has no school', 401);

  if (ctx.kind === 'tenant' && !LOCKED_ALLOWED.test(req.originalUrl.split('?')[0])) {
    const licence = await licenceStatus(ctx.schoolId);
    if (licence.state === 'LOCKED') return res.status(402).json({ success: false, code: 'LICENCE_LOCKED', message: LOCKED_MESSAGE, licence });
  }

  req.user = user;
  tenantStorage.run(ctx, () => next());
}
