import { licenceStatus } from '../../utils/licence';
import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma, { ScopedTx, transaction } from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { authenticate } from '../../middleware/auth';
import { can, hasPermission } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';
import { sendSuccess, sendPaginated } from '../../utils/apiResponse';
import { handler, parseBody, parseQuery, paginationSchema, paging, dateOnly, id, me } from '../../utils/http';
import { toDate, schoolToday } from '../../utils/dates';
import { createAccount } from '../../utils/accounts';
import { formatNumber, nextNumber } from '../../utils/counter';
import { attendanceSummary } from '../../utils/attendanceStats';
import { assertStudentAccess, ensureInSchool, isSchoolWide, studentScope, currentAcademicYear } from '../../utils/scope';
import { assertKind, deleteFile, MIME, saveFile, signedUrl } from '../../utils/storage';
import { uploadOne } from '../files/files.routes';

// Students, admission, guardians/siblings and documents (spec: Student Management).

const router = Router();
router.use(authenticate);

type Tx = ScopedTx;

// ─── List & profile ───

router.get('/', can('student.view'), handler(async (req, res) => {
  const q = parseQuery(paginationSchema.extend({
    search: z.string().max(100).optional(),
    sectionId: id.optional(),
    classId: id.optional(),
    status: z.enum(['ACTIVE', 'LEFT', 'TRANSFERRED', 'GRADUATED', 'ALL']).default('ACTIVE'),
  }), req);
  const where: Prisma.StudentWhereInput = {
    AND: [
      await studentScope(me(req)),
      q.status === 'ALL' ? {} : { status: q.status },
      q.sectionId ? { sectionId: q.sectionId } : {},
      q.classId ? { section: { classId: q.classId } } : {},
      q.search
        ? { OR: [
            { name: { contains: q.search } },
            { admissionNo: { contains: q.search } },
            { guardians: { some: { guardian: { phone: { contains: q.search } } } } },
          ] }
        : {},
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.student.findMany({
      where, ...paging(q),
      orderBy: [{ section: { class: { level: 'asc' } } }, { section: { name: 'asc' } }, { name: 'asc' }],
      include: {
        section: { select: { id: true, name: true, class: { select: { id: true, name: true } } } },
        guardians: { where: { isPrimary: true }, include: { guardian: { select: { name: true, phone: true } } } },
      },
    }),
    prisma.student.count({ where }),
  ]);
  return sendPaginated(res, rows.map(({ guardians, ...s }) => ({ ...s, primaryGuardian: guardians[0]?.guardian ?? null })), total, q.page, q.limit);
}));

router.get('/:id', can('student.view'), handler(async (req, res) => {
  const user = me(req);
  await assertStudentAccess(user, req.params.id);
  const student = await prisma.student.findFirstOrThrow({
    where: { id: req.params.id },
    include: {
      section: { include: { class: true, classTeacher: { select: { id: true, name: true, phone: true } } } },
      guardians: { include: { guardian: { include: { user: { select: { id: true, email: true, username: true, isActive: true } } } } } },
      documents: { orderBy: { uploadedAt: 'desc' } },
      user: { select: { id: true, email: true, username: true, isActive: true, lastLoginAt: true } },
    },
  });

  const extras: Record<string, unknown> = {};
  if (hasPermission(user.role, 'attendance.student.view')) {
    const year = await currentAcademicYear();
    const today = await schoolToday();
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const [month, yearRows] = await Promise.all([
      prisma.studentAttendance.groupBy({ by: ['status'], where: { studentId: student.id, date: { gte: monthStart } }, _count: true }),
      prisma.studentAttendance.groupBy({ by: ['status'], where: { studentId: student.id, date: { gte: year.startDate } }, _count: true }),
    ]);
    extras.attendance = { thisMonth: attendanceSummary(month), thisYear: attendanceSummary(yearRows) };
  }
  if (hasPermission(user.role, 'fee.view')) {
    const open = await prisma.feeInvoice.aggregate({
      where: { studentId: student.id, status: { in: ['UNPAID', 'PARTIAL'] } },
      _sum: { netAmount: true, fineAmount: true, paidAmount: true },
      _min: { dueDate: true },
    });
    // Same as the fee ledger: net + late fee − paid.
    const pending = (open._sum.netAmount ?? new Prisma.Decimal(0)).plus(open._sum.fineAmount ?? 0).minus(open._sum.paidAmount ?? 0);
    extras.fees = { pending, oldestDueDate: open._min.dueDate };
  }
  // Guardian contact details are office data: the school-wide roles and the family see them, teachers see names only.
  const fullContacts = isSchoolWide(user) || hasPermission(user.role, 'student.manage') || user.role === 'PARENT';
  const guardians = student.guardians.map((g) => ({
    relation: g.relation, isPrimary: g.isPrimary,
    guardian: fullContacts ? g.guardian : { id: g.guardian.id, name: g.guardian.name },
  }));
  const { photoKey, documents, ...rest } = student;
  return sendSuccess(res, { ...rest, photo: signedUrl(photoKey) ?? student.photoUrl, documents: documents.map(withFileUrl), guardians, ...extras });
}));

// ─── Admission ───

const guardianInput = z.union([
  z.object({ guardianId: id, relation: z.enum(['FATHER', 'MOTHER', 'GUARDIAN', 'OTHER']), isPrimary: z.boolean().default(false) }),
  z.object({
    name: z.string().min(2).max(100),
    phone: z.string().min(7).max(32),
    email: z.string().email().optional(),
    cnic: z.string().max(32).optional(),
    occupation: z.string().max(80).optional(),
    address: z.string().max(500).optional(),
    relation: z.enum(['FATHER', 'MOTHER', 'GUARDIAN', 'OTHER']),
    isPrimary: z.boolean().default(false),
    loginEmail: z.string().email().optional(), // create a parent app login
  }),
]);

const studentFields = z.object({
  name: z.string().min(2).max(100),
  admissionNo: z.string().min(1).max(30).optional(),
  rollNo: z.string().max(20).optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  dateOfBirth: dateOnly.optional(),
  bloodGroup: z.string().max(8).optional(),
  address: z.string().max(500).optional(),
  photoUrl: z.string().url().max(1024).optional(),
  admissionDate: dateOnly.optional(),
  sectionId: id,
});

const monthlyFee = z.coerce.number().min(0, 'Monthly fee can’t be negative').max(10_000_000);

const admissionBody = studentFields.extend({
  guardians: z.array(guardianInput).min(1).max(4),
  // CR-04: the student's own monthly fee (prefilled in the form from the class fee).
  monthlyFee: monthlyFee.optional().nullable(),
});

async function linkGuardian(tx: Tx, actorRole: string, studentId: string, g: z.infer<typeof guardianInput>) {
  const schoolId = currentSchoolId();
  let guardianId: string;
  let login: Awaited<ReturnType<typeof createAccount>> | undefined;
  if ('guardianId' in g) {
    const existing = await tx.guardian.findFirst({ where: { id: g.guardianId } });
    if (!existing) throw new AppError('Guardian not found', 404);
    guardianId = existing.id;
  } else {
    const { loginEmail, relation: _r, isPrimary: _p, ...data } = g;
    if (loginEmail && !hasPermission(actorRole, 'users.manage')) throw new AppError('You cannot create logins', 403);
    login = loginEmail
      ? await createAccount(tx, actorRole, { name: data.name, email: loginEmail, phone: data.phone, role: 'PARENT' })
      : undefined;
    guardianId = (await tx.guardian.create({ data: { ...data, schoolId, userId: login?.user.id } })).id;
  }
  await tx.studentGuardian.create({ data: { schoolId, studentId, guardianId, relation: g.relation, isPrimary: g.isPrimary } });
  return login;
}

router.post('/', can('student.admit'), handler(async (req, res) => {
  const { guardians, dateOfBirth, admissionDate, monthlyFee: fee, ...body } = parseBody(admissionBody, req);
  if (fee !== undefined && fee !== null && !hasPermission(me(req).role, 'student.fee.set')) throw new AppError('You cannot set fees', 403);
  await ensureInSchool(prisma.section, body.sectionId, 'Section');
  if (guardians.filter((g) => g.isPrimary).length > 1) throw new AppError('Only one primary guardian', 422);
  const { maxStudents } = await licenceStatus(currentSchoolId());
  if (maxStudents !== null && await prisma.student.count({ where: { status: 'ACTIVE' } }) >= maxStudents) {
    throw new AppError(`Your plan allows ${maxStudents} active students and you have reached it. Ask your provider to raise the limit.`, 409);
  }
  if (!guardians.some((g) => g.isPrimary)) guardians[0].isPrimary = true;

  const schoolId = currentSchoolId();
  const today = await schoolToday();
  const result = await transaction(async (tx) => {
    const admissionNo = body.admissionNo ?? formatNumber('ADM', await nextNumber(tx, 'admission'), 5);
    const student = await tx.student.create({
      data: {
        ...body, schoolId, admissionNo,
        monthlyFee: fee ?? null,
        dateOfBirth: dateOfBirth ? toDate(dateOfBirth) : undefined,
        admissionDate: admissionDate ? toDate(admissionDate) : today,
      },
    });
    const logins = [];
    for (const g of guardians) {
      const login = await linkGuardian(tx, me(req).role, student.id, g);
      if (login) logins.push(login);
    }
    return { student, parentLogins: logins };
  });
  return sendSuccess(res, result, 'Student admitted', 201);
}));

// Sibling detection at admission: find existing guardians by phone/CNIC.
router.get('/guardians/search', can('student.manage', 'student.admit'), handler(async (req, res) => {
  const { q } = parseQuery(z.object({ q: z.string().min(4).max(32) }), req);
  const rows = await prisma.guardian.findMany({
    where: { OR: [{ phone: { contains: q } }, { cnic: { contains: q } }] },
    take: 10,
    include: { students: { include: { student: { select: { id: true, name: true, admissionNo: true, status: true } } } } },
  });
  return sendSuccess(res, rows.map(({ students, ...g }) => ({ ...g, children: students.map((s) => s.student) })));
}));

// ─── Updates ───

/** CR-04: change (or clear, to follow the class fee again) a student's own monthly fee. */
router.put('/:id/monthly-fee', can('student.fee.set'), handler(async (req, res) => {
  const { monthlyFee: fee } = parseBody(z.object({ monthlyFee: monthlyFee.nullable() }), req);
  await ensureInSchool(prisma.student, req.params.id, 'Student');
  const student = await prisma.student.update({ where: { id: req.params.id }, data: { monthlyFee: fee }, select: { id: true, monthlyFee: true } });
  return sendSuccess(res, student, fee === null ? 'Monthly fee now follows the class fee structure' : 'Monthly fee saved. It applies to invoices generated from now on.');
}));

router.patch('/:id', can('student.manage'), handler(async (req, res) => {
  const { dateOfBirth, admissionDate, ...body } = parseBody(studentFields.partial().strict(), req);
  if (body.sectionId) await ensureInSchool(prisma.section, body.sectionId, 'Section');
  const student = await prisma.student.update({
    where: { id: req.params.id },
    data: {
      ...body,
      ...(dateOfBirth ? { dateOfBirth: toDate(dateOfBirth) } : {}),
      ...(admissionDate ? { admissionDate: toDate(admissionDate) } : {}),
    },
  });
  return sendSuccess(res, student, 'Student updated');
}));

router.post('/:id/status', can('student.manage'), handler(async (req, res) => {
  const body = parseBody(z.object({
    status: z.enum(['ACTIVE', 'LEFT', 'TRANSFERRED', 'GRADUATED']),
    date: dateOnly.optional(),
    reason: z.string().max(300).optional(),
  }), req);
  const leaving = body.status !== 'ACTIVE';
  const student = await transaction(async (tx) => {
    const s = await tx.student.update({
      where: { id: req.params.id },
      data: {
        status: body.status,
        leftOn: leaving ? (body.date ? toDate(body.date) : await schoolToday()) : null,
        leftReason: leaving ? body.reason ?? null : null,
      },
    });
    if (s.userId) await tx.user.update({ where: { id: s.userId }, data: { isActive: !leaving } });
    return s;
  });
  return sendSuccess(res, student, leaving ? 'Student marked as left' : 'Student re-activated');
}));

// ─── Guardians ───

router.post('/:id/guardians', can('student.manage'), handler(async (req, res) => {
  const g = parseBody(guardianInput, req);
  await ensureInSchool(prisma.student, req.params.id, 'Student');
  const login = await transaction(async (tx) => {
    if (g.isPrimary) await tx.studentGuardian.updateMany({ where: { studentId: req.params.id }, data: { isPrimary: false } });
    return linkGuardian(tx, me(req).role, req.params.id, g);
  });
  return sendSuccess(res, { parentLogin: login }, 'Guardian linked', 201);
}));

router.delete('/:id/guardians/:guardianId', can('student.manage'), handler(async (req, res) => {
  const links = await prisma.studentGuardian.findMany({ where: { studentId: req.params.id } });
  if (!links.some((l) => l.guardianId === req.params.guardianId)) throw new AppError('Guardian not linked to this student', 404);
  if (links.length === 1) throw new AppError('A student must keep at least one guardian', 409);
  await prisma.studentGuardian.deleteMany({ where: { studentId: req.params.id, guardianId: req.params.guardianId } });
  return sendSuccess(res, null, 'Guardian unlinked');
}));

// Sign-in details for a parent or student login: a username or an email, and optionally a
// password (otherwise one is generated and shown once). They set their own at first sign-in.
const appLoginBody = z.object({
  username: z.string().trim().min(3).max(60).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).max(100).optional(),
}).refine((l) => l.username || l.email, { message: 'Give the login a username or an email', path: ['username'] });

// Give the student their own app login. They see only their own record.
router.post('/:id/login', can('users.manage'), handler(async (req, res) => {
  const login = parseBody(appLoginBody, req);
  const result = await transaction(async (tx) => {
    const student = await tx.student.findFirst({ where: { id: req.params.id } });
    if (!student) throw new AppError('Student not found', 404);
    if (student.userId) throw new AppError('This student already has a login', 409);
    if (student.status !== 'ACTIVE') throw new AppError('Only an active student can be given a login', 409);
    const account = await createAccount(tx, me(req).role, { name: student.name, ...login, role: 'STUDENT' });
    await tx.student.update({ where: { id: student.id }, data: { userId: account.user.id } });
    return account;
  });
  return sendSuccess(res, result, 'Student login created', 201);
}));

// Give a guardian parent-app access (covers all their children).
router.post('/guardians/:guardianId/login', can('users.manage'), handler(async (req, res) => {
  const login = parseBody(appLoginBody, req);
  const result = await transaction(async (tx) => {
    const g = await tx.guardian.findFirst({ where: { id: req.params.guardianId } });
    if (!g) throw new AppError('Guardian not found', 404);
    if (g.userId) throw new AppError('This guardian already has a login', 409);
    const account = await createAccount(tx, me(req).role, { name: g.name, phone: g.phone, ...login, role: 'PARENT' });
    await tx.guardian.update({ where: { id: g.id }, data: { userId: account.user.id } });
    return account;
  });
  return sendSuccess(res, result, 'Parent login created', 201);
}));

// ─── Documents & photo ───
// A document is either an uploaded file (multipart field "file", PDF/JPEG/PNG/WebP)
// or an external link (JSON { title, url }).

router.post('/:id/documents', can('student.manage'), uploadOne, handler(async (req, res) => {
  const { title } = parseBody(z.object({ title: z.string().min(1).max(120), url: z.any().optional() }), req);
  await ensureInSchool(prisma.student, req.params.id, 'Student');
  const schoolId = currentSchoolId();
  const base = { schoolId, studentId: req.params.id, title };

  let doc;
  if (req.file) {
    const kind = assertKind(req.file.buffer, ['pdf', 'jpg', 'png', 'webp']);
    const storageKey = await saveFile(schoolId, 'documents', req.file.buffer, kind);
    try {
      doc = await prisma.studentDocument.create({
        data: { ...base, storageKey, fileName: req.file.originalname.slice(0, 190), mimeType: MIME[kind], sizeBytes: req.file.size },
      });
    } catch (e) {
      await deleteFile(storageKey);
      throw e;
    }
  } else {
    const { url } = parseBody(z.object({ url: z.string().url().max(1024).refine((u) => /^https?:\/\//i.test(u), 'must be http(s)') }), req);
    doc = await prisma.studentDocument.create({ data: { ...base, url } });
  }
  return sendSuccess(res, withFileUrl(doc), 'Document added', 201);
}));

router.delete('/:id/documents/:docId', can('student.manage'), handler(async (req, res) => {
  const doc = await prisma.studentDocument.findFirst({ where: { id: req.params.docId, studentId: req.params.id } });
  if (!doc) throw new AppError('Document not found', 404);
  await prisma.studentDocument.delete({ where: { id: doc.id } });
  await deleteFile(doc.storageKey);
  return sendSuccess(res, null, 'Document removed');
}));

router.put('/:id/photo', can('student.manage'), uploadOne, handler(async (req, res) => {
  if (!req.file) throw new AppError('Attach an image as "file"', 422);
  const kind = assertKind(req.file.buffer, ['jpg', 'png', 'webp']);
  const student = await prisma.student.findFirst({ where: { id: req.params.id }, select: { id: true, photoKey: true } });
  if (!student) throw new AppError('Student not found', 404);
  const photoKey = await saveFile(currentSchoolId(), 'photos', req.file.buffer, kind);
  await prisma.student.update({ where: { id: student.id }, data: { photoKey } });
  await deleteFile(student.photoKey);
  return sendSuccess(res, { photo: signedUrl(photoKey) }, 'Photo updated');
}));

router.delete('/:id/photo', can('student.manage'), handler(async (req, res) => {
  const student = await prisma.student.findFirst({ where: { id: req.params.id }, select: { id: true, photoKey: true } });
  if (!student) throw new AppError('Student not found', 404);
  await prisma.student.update({ where: { id: student.id }, data: { photoKey: null } });
  await deleteFile(student.photoKey);
  return sendSuccess(res, null, 'Photo removed');
}));

/** Swaps the private storage key for a short-lived download link. */
function withFileUrl<T extends { storageKey: string | null; url: string | null }>(d: T) {
  const { storageKey, ...rest } = d;
  return { ...rest, uploaded: !!storageKey, href: storageKey ? signedUrl(storageKey) : d.url };
}

export default router;
