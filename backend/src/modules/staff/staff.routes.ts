import { Router } from 'express';
import { endAllSessions } from '../../utils/sessions';
import { z } from 'zod';
import prisma, { transaction } from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { authenticate } from '../../middleware/auth';
import { can, hasPermission } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';
import { sendSuccess, sendPaginated } from '../../utils/apiResponse';
import { handler, parseBody, parseQuery, paginationSchema, paging, dateOnly, me } from '../../utils/http';
import { toDate } from '../../utils/dates';
import { createAccount } from '../../utils/accounts';
import { formatNumber, nextNumber } from '../../utils/counter';

// Teachers and other staff (spec: Teacher / Staff Management).

const router = Router();
router.use(authenticate);

const loginRoles = z.enum(['PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER']);

/** Sign-in for a staff member (CR-05): admin-chosen username + password, email optional. */
const loginBody = z.object({
  username: z.string().min(3).max(40).optional(),
  email: z.string().email().optional(),
  role: loginRoles.default('TEACHER'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100).optional(),
}).refine((l) => l.username || l.email, { message: 'Give the login a username or an email', path: ['username'] });

const staffBody = z.object({
  name: z.string().min(2).max(100),
  employeeNo: z.string().min(1).max(30).optional(),
  phone: z.string().max(32).optional(),
  designation: z.string().max(60).optional(),
  department: z.string().max(60).optional(),
  qualification: z.string().max(120).optional(),
  joiningDate: dateOnly.optional(),
  isTeacher: z.boolean().default(true),
  login: z.lazy(() => loginBody).optional(),
});

router.get('/', can('staff.view'), handler(async (req, res) => {
  const q = parseQuery(paginationSchema.extend({
    search: z.string().max(100).optional(),
    status: z.enum(['ACTIVE', 'LEFT']).default('ACTIVE'),
    teachers: z.enum(['true', 'false']).optional(),
  }), req);
  const where = {
    status: q.status,
    ...(q.teachers ? { isTeacher: q.teachers === 'true' } : {}),
    ...(q.search ? { OR: [{ name: { contains: q.search } }, { employeeNo: { contains: q.search } }, { phone: { contains: q.search } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.staff.findMany({
      where, orderBy: { name: 'asc' }, ...paging(q),
      include: {
        user: { select: { id: true, email: true, username: true, role: true, isActive: true } },
        classTeacherOf: { select: { id: true, name: true, class: { select: { name: true } } } },
        _count: { select: { subjectsTaught: true } },
      },
    }),
    prisma.staff.count({ where }),
  ]);
  return sendPaginated(res, rows, total, q.page, q.limit);
}));

router.get('/:id', can('staff.view'), handler(async (req, res) => {
  const staff = await prisma.staff.findFirst({
    where: { id: req.params.id },
    include: {
      user: { select: { id: true, email: true, username: true, role: true, isActive: true, lastLoginAt: true } },
      classTeacherOf: { select: { id: true, name: true, class: { select: { name: true } } } },
      subjectsTaught: { include: { subject: true, section: { include: { class: { select: { name: true } } } } } },
    },
  });
  if (!staff) throw new AppError('Staff member not found', 404);
  return sendSuccess(res, staff);
}));

router.post('/', can('staff.manage'), handler(async (req, res) => {
  const { login, joiningDate, ...body } = parseBody(staffBody, req);
  if (login && !hasPermission(me(req).role, 'users.manage')) throw new AppError('You cannot create logins', 403);
  const schoolId = currentSchoolId();

  const result = await transaction(async (tx) => {
    const account = login
      ? await createAccount(tx, me(req).role, { name: body.name, email: login.email, username: login.username, phone: body.phone, role: login.role, password: login.password })
      : undefined;
    const employeeNo = body.employeeNo ?? formatNumber('EMP', await nextNumber(tx, 'employee'), 4);
    const staff = await tx.staff.create({
      data: { ...body, schoolId, employeeNo, joiningDate: joiningDate ? toDate(joiningDate) : undefined, userId: account?.user.id },
    });
    return { staff, login: account };
  });
  return sendSuccess(res, result, 'Staff member added', 201);
}));

const staffUpdate = staffBody.omit({ login: true, isTeacher: true }).partial().extend({
  isTeacher: z.boolean().optional(),
  status: z.enum(['ACTIVE', 'LEFT']).optional(),
}).strict();

router.patch('/:id', can('staff.manage'), handler(async (req, res) => {
  const { joiningDate, ...body } = parseBody(staffUpdate, req);
  const staff = await transaction(async (tx) => {
    const updated = await tx.staff.update({
      where: { id: req.params.id },
      data: { ...body, ...(joiningDate !== undefined ? { joiningDate: toDate(joiningDate) } : {}) },
    });
    // Leaving the school disables the login and frees their class-teacher slots.
    if (body.status === 'LEFT') {
      if (updated.userId) await tx.user.update({ where: { id: updated.userId }, data: { isActive: false } });
      await tx.section.updateMany({ where: { classTeacherId: updated.id }, data: { classTeacherId: null } });
    }
    // Rejoining (reactivate): their login works again. Class-teacher and subject
    // assignments are not restored automatically; the office reassigns them.
    if (body.status === 'ACTIVE' && updated.userId) {
      await tx.user.update({ where: { id: updated.userId }, data: { isActive: true } });
    }
    return updated;
  });
  if (body.status === 'LEFT' && staff.userId) await endAllSessions(staff.userId); // signed out on every device now
  return sendSuccess(res, staff, 'Staff member updated');
}));

// Give an existing staff member app access.
router.post('/:id/login', can('staff.manage'), handler(async (req, res) => {
  if (!hasPermission(me(req).role, 'users.manage')) throw new AppError('You cannot create logins', 403);
  const login = parseBody(loginBody, req);
  const result = await transaction(async (tx) => {
    const staff = await tx.staff.findFirst({ where: { id: req.params.id } });
    if (!staff) throw new AppError('Staff member not found', 404);
    if (staff.userId) throw new AppError('This staff member already has a login', 409);
    const account = await createAccount(tx, me(req).role, { name: staff.name, phone: staff.phone, ...login });
    await tx.staff.update({ where: { id: staff.id }, data: { userId: account.user.id } });
    return account;
  });
  return sendSuccess(res, result, 'Login created', 201);
}));

export default router;
