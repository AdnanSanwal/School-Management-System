import { Router } from 'express';
import { endAllSessions } from '../../utils/sessions';
import { z } from 'zod';
import prisma, { transaction } from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { authenticate } from '../../middleware/auth';
import { can, hasPermission } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';
import { sendSuccess, sendPaginated } from '../../utils/apiResponse';
import { handler, parseBody, parseQuery, paginationSchema, paging, dateOnly, me, patchOf } from '../../utils/http';
import { schoolToday, toDate, toIso } from '../../utils/dates';
import { currentAcademicYear } from '../../utils/scope';
import { leaveBalances, salariesOn } from '../../utils/hr';
import { assertKind, deleteFile, MIME, saveFile, signedUrl } from '../../utils/storage';
import { uploadOne } from '../files/files.routes';
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
  // HR profile
  cnic: z.string().trim().max(20).optional().nullable(),
  dateOfBirth: dateOnly.optional().nullable(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional().nullable(),
  email: z.string().trim().email().max(191).optional().nullable().or(z.literal('').transform(() => null)),
  address: z.string().trim().max(500).optional().nullable(),
  emergencyContactName: z.string().trim().max(100).optional().nullable(),
  emergencyContactPhone: z.string().trim().max(32).optional().nullable(),
  contractType: z.enum(['PERMANENT', 'CONTRACT', 'VISITING']).optional(),
  bankName: z.string().trim().max(100).optional().nullable(),
  bankAccountTitle: z.string().trim().max(100).optional().nullable(),
  bankAccountNo: z.string().trim().max(40).optional().nullable(),
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
      documents: { orderBy: { uploadedAt: 'desc' } },
      user: { select: { id: true, email: true, username: true, role: true, isActive: true, lastLoginAt: true } },
      classTeacherOf: { select: { id: true, name: true, class: { select: { name: true } } } },
      subjectsTaught: { include: { subject: true, section: { include: { class: { select: { name: true } } } } } },
    },
  });
  if (!staff) throw new AppError('Staff member not found', 404);
  const [year, today] = await Promise.all([currentAcademicYear(), schoolToday()]);
  const [balances, pay] = await Promise.all([
    leaveBalances([staff.id], year),
    hasPermission(me(req).role, 'salary.view') ? salariesOn([staff.id], today) : null,
  ]);
  const { documents, ...rest } = staff;
  return sendSuccess(res, {
    ...rest,
    joiningDate: staff.joiningDate ? toIso(staff.joiningDate) : null,
    dateOfBirth: staff.dateOfBirth ? toIso(staff.dateOfBirth) : null,
    leftOn: staff.leftOn ? toIso(staff.leftOn) : null,
    documents: documents.map(({ storageKey, ...d }) => ({ ...d, href: signedUrl(storageKey) })),
    leave: { year: year.name, balances: balances.get(staff.id) ?? [] },
    // Only for roles allowed to see pay.
    ...(pay ? { salary: pay.get(staff.id) ?? null } : {}),
  });
}));

router.post('/', can('staff.manage'), handler(async (req, res) => {
  const { login, joiningDate, dateOfBirth, ...body } = parseBody(staffBody, req);
  if (login && !hasPermission(me(req).role, 'users.manage')) throw new AppError('You cannot create logins', 403);
  const schoolId = currentSchoolId();

  const result = await transaction(async (tx) => {
    const account = login
      ? await createAccount(tx, me(req).role, { name: body.name, email: login.email, username: login.username, phone: body.phone, role: login.role, password: login.password })
      : undefined;
    const employeeNo = body.employeeNo ?? formatNumber('EMP', await nextNumber(tx, 'employee'), 4);
    const staff = await tx.staff.create({
      data: {
        ...body, schoolId, employeeNo, userId: account?.user.id,
        joiningDate: joiningDate ? toDate(joiningDate) : undefined,
        dateOfBirth: dateOfBirth ? toDate(dateOfBirth) : undefined,
      },
    });
    return { staff, login: account };
  });
  return sendSuccess(res, result, 'Staff member added', 201);
}));

const staffUpdate = patchOf(staffBody.omit({ login: true, isTeacher: true })).extend({
  isTeacher: z.boolean().optional(),
  status: z.enum(['ACTIVE', 'LEFT']).optional(),
}).strict();

router.patch('/:id', can('staff.manage'), handler(async (req, res) => {
  const { joiningDate, dateOfBirth, ...body } = parseBody(staffUpdate, req);
  const staff = await transaction(async (tx) => {
    const updated = await tx.staff.update({
      where: { id: req.params.id },
      data: {
        ...body,
        ...(joiningDate !== undefined ? { joiningDate: toDate(joiningDate) } : {}),
        ...(dateOfBirth !== undefined ? { dateOfBirth: dateOfBirth ? toDate(dateOfBirth) : null } : {}),
        // Keep the leaving date for the record; clear it when they rejoin.
        ...(body.status === 'LEFT' ? { leftOn: await schoolToday() } : body.status === 'ACTIVE' ? { leftOn: null } : {}),
      },
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

// ─── Documents (CNIC copy, degree, contract…): PDF/JPEG/PNG/WebP in field "file" ───

router.post('/:id/documents', can('staff.manage'), uploadOne, handler(async (req, res) => {
  const { title } = parseBody(z.object({ title: z.string().trim().min(1).max(120) }), req);
  if (!req.file) throw new AppError('Attach a file as "file"', 422);
  const staff = await prisma.staff.findFirst({ where: { id: req.params.id }, select: { id: true } });
  if (!staff) throw new AppError('Staff member not found', 404);
  const schoolId = currentSchoolId();
  const kind = assertKind(req.file.buffer, ['pdf', 'jpg', 'png', 'webp']);
  const storageKey = await saveFile(schoolId, 'documents', req.file.buffer, kind);
  try {
    const doc = await prisma.staffDocument.create({
      data: { schoolId, staffId: staff.id, title, storageKey, fileName: req.file.originalname.slice(0, 190), mimeType: MIME[kind], sizeBytes: req.file.size },
    });
    const { storageKey: _k, ...rest } = doc;
    return sendSuccess(res, { ...rest, href: signedUrl(storageKey) }, 'Document added', 201);
  } catch (e) {
    await deleteFile(storageKey);
    throw e;
  }
}));

router.delete('/:id/documents/:docId', can('staff.manage'), handler(async (req, res) => {
  const doc = await prisma.staffDocument.findFirst({ where: { id: req.params.docId, staffId: req.params.id } });
  if (!doc) throw new AppError('Document not found', 404);
  await prisma.staffDocument.delete({ where: { id: doc.id } });
  await deleteFile(doc.storageKey);
  return sendSuccess(res, null, 'Document removed');
}));

// Give an existing staff member app access.
router.post('/:id/login', can('users.manage'), handler(async (req, res) => {
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
