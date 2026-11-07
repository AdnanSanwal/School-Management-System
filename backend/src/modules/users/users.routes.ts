import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Role } from '@prisma/client';
import prisma from '../../config/database';
import { getRedis } from '../../config/redis';
import { authenticate } from '../../middleware/auth';
import { can } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';
import { sendSuccess, sendPaginated } from '../../utils/apiResponse';
import { handler, parseBody, parseQuery, paginationSchema, paging, me } from '../../utils/http';
import { assertCanManageRole, createAccount, temporaryPassword } from '../../utils/accounts';

// Login accounts of the school (spec: Settings & Users → Roles).

const router = Router();
router.use(authenticate, can('users.manage'));

const schoolRoles = z.enum(['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT']);

const userSelect = {
  id: true, name: true, email: true, phone: true, role: true, isActive: true, lastLoginAt: true, createdAt: true,
  staff: { select: { id: true, employeeNo: true } },
  guardian: { select: { id: true } },
  student: { select: { id: true, admissionNo: true } },
} as const;

router.get('/', handler(async (req, res) => {
  const q = parseQuery(paginationSchema.extend({
    role: schoolRoles.optional(),
    search: z.string().max(100).optional(),
    active: z.enum(['true', 'false']).optional(),
  }), req);
  const where = {
    role: q.role ?? { not: Role.SUPER_ADMIN },
    ...(q.active ? { isActive: q.active === 'true' } : {}),
    ...(q.search ? { OR: [{ name: { contains: q.search } }, { email: { contains: q.search } }, { phone: { contains: q.search } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.user.findMany({ where, select: userSelect, orderBy: { name: 'asc' }, ...paging(q) }),
    prisma.user.count({ where }),
  ]);
  return sendPaginated(res, rows, total, q.page, q.limit);
}));

const createBody = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  phone: z.string().max(32).optional(),
  role: schoolRoles,
  password: z.string().min(8).max(100).optional(),
});

// Office accounts. Staff, parent and student logins are normally created from
// their own screens (staff / admission), which also link the profile.
router.post('/', handler(async (req, res) => {
  const body = parseBody(createBody, req);
  const result = await prisma.$transaction((tx) => createAccount(tx, me(req).role, body));
  return sendSuccess(res, result, 'User created', 201);
}));

async function loadManageable(actor: { id: string; role: string }, userId: string) {
  const target = await prisma.user.findFirst({ where: { id: userId }, select: { id: true, role: true } });
  if (!target || target.role === 'SUPER_ADMIN') throw new AppError('User not found', 404);
  if (target.id === actor.id) throw new AppError('Use your profile to change your own account', 400);
  assertCanManageRole(actor.role, target.role);
  return target;
}

const updateBody = z.object({
  name: z.string().min(2).max(100).optional(),
  phone: z.string().max(32).nullable().optional(),
  role: schoolRoles.optional(),
  isActive: z.boolean().optional(),
}).strict();

router.patch('/:id', handler(async (req, res) => {
  const body = parseBody(updateBody, req);
  const target = await loadManageable(me(req), req.params.id);
  if (body.role) assertCanManageRole(me(req).role, body.role);
  const user = await prisma.user.update({ where: { id: target.id }, data: body, select: userSelect });
  // Deactivation or role change: end existing sessions so it takes effect now.
  if (body.isActive === false || body.role) await getRedis().del(`refresh:${target.id}`);
  return sendSuccess(res, user, 'User updated');
}));

router.post('/:id/reset-password', handler(async (req, res) => {
  const target = await loadManageable(me(req), req.params.id);
  const password = temporaryPassword();
  await prisma.user.update({ where: { id: target.id }, data: { password: await bcrypt.hash(password, 12) } });
  await getRedis().del(`refresh:${target.id}`);
  return sendSuccess(res, { temporaryPassword: password }, 'Password reset — share the new password with the user');
}));

export default router;
