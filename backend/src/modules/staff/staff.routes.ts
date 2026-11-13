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
import { currentAcademicYear, staffForUser, staffLogin } from '../../utils/scope';
import { leaveBalances, salariesOn } from '../../utils/hr';
import { assertKind, deleteFile, MIME, saveFile, signedUrl } from '../../utils/storage';
import { uploadOne } from '../files/files.routes';
import { createAccount } from '../../utils/accounts';
import { formatNumber, nextNumber } from '../../utils/counter';
import type { StaffStatus } from '@prisma/client';
import type { AuthRequest } from '../../middleware/auth';
import { activityFor, audit } from '../../utils/audit';
import { isOnRoll, onRoll, STAFF_STATUS_LABEL } from '../../utils/staffStatus';
import { canManageRole } from '../../utils/accounts';

// Teachers and other staff (spec: Teacher / Staff Management).

const router = Router();
router.use(authenticate);

const loginRoles = z.enum(['PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER']);

/** Sign-in for a staff member (CR-05): admin-chosen username + password, email optional. */
const loginBody = z.object({
  username: z.string().min(3).max(40).optional(),
  email: z.string().email().optional(),
  role: loginRoles.default('TEACHER'),
  customRoleId: z.string().uuid().optional().nullable(),
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
    search: z.string().trim().max(100).optional(),
    // CURRENT = on roll (active or on temporary leave); ALL = everyone ever employed.
    status: z.enum(['CURRENT', 'ALL', 'ACTIVE', 'INACTIVE', 'TEMPORARY_LEAVE', 'LEFT', 'TERMINATED']).default('CURRENT'),
    teachers: z.enum(['true', 'false']).optional(),
    designation: z.string().trim().max(60).optional(),
  }), req);
  const words = q.search ? q.search.split(/\s+/).filter(Boolean).slice(0, 5) : [];
  const where = {
    ...(q.status === 'ALL' ? {} : { status: q.status === 'CURRENT' ? onRoll : q.status }),
    ...(q.teachers ? { isTeacher: q.teachers === 'true' } : {}),
    ...(q.designation ? { designation: q.designation } : {}),
    // Every word must match one of: name, employee ID, role / designation, department, phone, CNIC, email, login.
    ...(words.length ? {
      AND: words.map((w) => ({
        OR: [
          { name: { contains: w } }, { employeeNo: { contains: w } }, { designation: { contains: w } }, { department: { contains: w } },
          { phone: { contains: w } }, { cnic: { contains: w } }, { email: { contains: w } },
          { user: { is: { OR: [{ username: { contains: w } }, { email: { contains: w } }] } } },
        ],
      })),
    } : {}),
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
  const [balances, pay, activity] = await Promise.all([
    leaveBalances([staff.id], year),
    hasPermission(me(req).role, 'salary.view') ? salariesOn([staff.id], today) : null,
    activityFor('staff', staff.id),
  ]);
  const { documents, ...rest } = staff;
  return sendSuccess(res, {
    ...rest,
    joiningDate: staff.joiningDate ? toIso(staff.joiningDate) : null,
    dateOfBirth: staff.dateOfBirth ? toIso(staff.dateOfBirth) : null,
    leftOn: staff.leftOn ? toIso(staff.leftOn) : null,
    documents: documents.map(({ storageKey, ...d }) => ({ ...d, href: signedUrl(storageKey) })),
    leave: { year: year.name, balances: balances.get(staff.id) ?? [] },
    activity,
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
      ? await createAccount(tx, me(req).role, { name: body.name, email: login.email, username: login.username, phone: body.phone, role: login.role, customRoleId: login.customRoleId, password: login.password })
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

const staffStatus = z.enum(['ACTIVE', 'INACTIVE', 'TEMPORARY_LEAVE', 'LEFT', 'TERMINATED']);
const staffUpdate = patchOf(staffBody.omit({ login: true, isTeacher: true })).extend({
  isTeacher: z.boolean().optional(),
  status: staffStatus.optional(),
}).strict();

/**
 * Moves a staff member to a new status. Nothing is deleted: off-roll statuses (inactive,
 * left, terminated) stop pay from that date and disable the login; Active / Temporary leave
 * bring the login back. Left and Terminated also free their class-teacher slots.
 * Records the change (with the previous status) in the activity log.
 */
async function changeStaffStatus(req: AuthRequest, staffId: string, status: StaffStatus, opts: { date?: string; reason?: string } = {}) {
  const before = await prisma.staff.findFirst({ where: { id: staffId }, select: { id: true, name: true, status: true, userId: true, leftOn: true, user: { select: { role: true } } } });
  if (!before) throw new AppError('Staff member not found', 404);
  // The status switches their login on or off, so it needs the right to manage that login (AUTHZ-2).
  const login = await staffLogin(staffId);
  if (login && !canManageRole(me(req).role, login.role)) {
    throw new AppError(`You cannot change the status of a ${login.role.toLowerCase()} — ask the owner`, 403);
  }
  if (login?.id === me(req).id) throw new AppError('You cannot change your own status', 403);
  if (before.status === status) throw new AppError(`${before.name} is already ${STAFF_STATUS_LABEL[status].toLowerCase()}`, 409);
  const on = isOnRoll(status);
  const effective = opts.date ? toDate(opts.date) : await schoolToday();
  const updated = await transaction(async (tx) => {
    const row = await tx.staff.update({
      where: { id: before.id },
      // Off roll: keep the date they stopped (payroll pays up to it). Back on roll: clear it.
      data: { status, leftOn: on ? null : (isOnRoll(before.status) || !before.leftOn ? effective : before.leftOn) },
    });
    if (before.userId) await tx.user.update({ where: { id: before.userId }, data: { isActive: on } });
    if (status === 'LEFT' || status === 'TERMINATED') {
      await tx.section.updateMany({ where: { classTeacherId: before.id }, data: { classTeacherId: null } });
    }
    return row;
  });
  if (!on && login) await endAllSessions(login.id); // signed out on every device now
  await audit(req, {
    action: 'Status changed', entity: 'staff', entityId: before.id,
    meta: { name: before.name, from: before.status, to: status, fromLabel: STAFF_STATUS_LABEL[before.status], toLabel: STAFF_STATUS_LABEL[status], effective: toIso(effective), reason: opts.reason ?? null },
  });
  return updated;
}

router.post('/:id/status', can('staff.manage'), handler(async (req, res) => {
  const b = parseBody(z.object({ status: staffStatus, date: dateOnly.optional(), reason: z.string().trim().max(300).optional() }), req);
  const staff = await changeStaffStatus(req, req.params.id, b.status, b);
  return sendSuccess(res, staff, `${staff.name} is now ${STAFF_STATUS_LABEL[b.status].toLowerCase()}`);
}));

router.patch('/:id', can('staff.manage'), handler(async (req, res) => {
  const { joiningDate, dateOfBirth, status, ...body } = parseBody(staffUpdate, req);
  // Salary goes to these bank details: only the owner may change their own, and every change is logged (AUTHZ-5).
  const bankChange = body.bankName !== undefined || body.bankAccountTitle !== undefined || body.bankAccountNo !== undefined;
  if (bankChange) {
    const target = await prisma.staff.findFirst({ where: { id: req.params.id }, select: { userId: true, name: true, bankName: true, bankAccountNo: true } });
    if (me(req).role !== 'OWNER' && (await staffForUser(me(req).id))?.id === req.params.id) throw new AppError('You cannot change your own bank details — ask the owner', 403);
    if (target) await audit(req, { action: 'Bank details changed', entity: 'staff', entityId: req.params.id, meta: { name: target.name, previousBank: target.bankName, previousAccountEnding: target.bankAccountNo?.slice(-4) ?? null, newAccountEnding: body.bankAccountNo?.slice(-4) ?? null } });
  }
  let staff = await prisma.staff.update({
    where: { id: req.params.id },
    data: {
      ...body,
      ...(joiningDate !== undefined ? { joiningDate: toDate(joiningDate) } : {}),
      ...(dateOfBirth !== undefined ? { dateOfBirth: dateOfBirth ? toDate(dateOfBirth) : null } : {}),
    },
  });
  if (status && status !== staff.status) staff = await changeStaffStatus(req, staff.id, status);
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
    if (await staffLogin(staff.id)) throw new AppError('This staff member already has a login or branch access assignment', 409);
    const account = await createAccount(tx, me(req).role, { name: staff.name, phone: staff.phone, ...login });
    await tx.staff.update({ where: { id: staff.id }, data: { userId: account.user.id } });
    return account;
  });
  return sendSuccess(res, result, 'Login created', 201);
}));

export default router;
