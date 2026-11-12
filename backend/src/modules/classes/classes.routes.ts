import { Router } from 'express';
import { z } from 'zod';
import prisma, { transaction } from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { authenticate } from '../../middleware/auth';
import { can } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { handler, parseBody, id, me, patchOf } from '../../utils/http';
import { currentAcademicYear, ensureInSchool, isSchoolWide, teacherSectionIds } from '../../utils/scope';
import { onRoll } from '../../utils/staffStatus';

// Classes, sections, subjects and who teaches what (spec: Class & Section).

const router = Router();
router.use(authenticate);

// ─── Classes & sections ───

router.get('/classes', can('class.view'), handler(async (req, res) => {
  // Teachers only see the sections they teach.
  const sectionFilter = isSchoolWide(me(req)) ? {} : { id: { in: await teacherSectionIds(me(req).id) } };
  // Archived classes are hidden everywhere; the Classes screen asks for them explicitly.
  const archived = req.query.archived === 'true' && isSchoolWide(me(req));
  const classes = await prisma.class.findMany({
    where: { archivedAt: archived ? { not: null } : null },
    orderBy: { level: 'asc' },
    include: {
      sections: {
        where: sectionFilter,
        orderBy: { name: 'asc' },
        include: {
          classTeacher: { select: { id: true, name: true } },
          _count: { select: { students: { where: { status: 'ACTIVE' } } } },
        },
      },
    },
  });
  const visible = isSchoolWide(me(req)) ? classes : classes.filter((c) => c.sections.length);
  return sendSuccess(res, visible.map((c) => ({
    ...c,
    sections: c.sections.map(({ _count, ...s }) => ({ ...s, strength: _count.students })),
    strength: c.sections.reduce((n, s) => n + s._count.students, 0),
  })));
}));

const classBody = z.object({ name: z.string().min(1).max(50), level: z.coerce.number().int().min(-5).max(20) });

router.post('/classes', can('class.manage'), handler(async (req, res) => {
  const body = parseBody(classBody.extend({ sections: z.array(z.string().min(1).max(10)).max(20).default(['A']) }), req);
  const schoolId = currentSchoolId();
  const clash = await prisma.class.findFirst({ where: { name: body.name }, select: { archivedAt: true } });
  if (clash) throw new AppError(clash.archivedAt ? `An archived class is already called “${body.name}”. Restore it instead.` : `“${body.name}” already exists`, 409);
  const created = await transaction(async (tx) => {
    const cls = await tx.class.create({ data: { schoolId, name: body.name, level: body.level } });
    for (const name of new Set(body.sections)) await tx.section.create({ data: { schoolId, classId: cls.id, name } });
    return tx.class.findUniqueOrThrow({ where: { id: cls.id }, include: { sections: true } });
  });
  return sendSuccess(res, created, 'Class created', 201);
}));

router.patch('/classes/:id', can('class.manage'), handler(async (req, res) => {
  const body = parseBody(patchOf(classBody).strict(), req);
  const cls = await prisma.class.update({ where: { id: req.params.id }, data: body });
  return sendSuccess(res, cls, 'Class updated');
}));

/**
 * CR-03: "Delete class" archives it: hidden from every list and dropdown, but its sections,
 * past students, invoices, exams and fee structure stay for history and reports. Refused
 * while active students are still in it, so nobody ends up in a hidden class.
 */
router.post('/classes/:id/archive', can('class.manage'), handler(async (req, res) => {
  const cls = await prisma.class.findFirst({ where: { id: req.params.id }, select: { id: true, name: true, archivedAt: true } });
  if (!cls) throw new AppError('Class not found', 404);
  if (cls.archivedAt) throw new AppError('Class is already archived', 409);
  const active = await prisma.student.count({ where: { status: 'ACTIVE', section: { classId: cls.id } } });
  if (active) throw new AppError(`${cls.name} still has ${active} active student(s). Move them to another class (or promote them) first.`, 409);
  await transaction(async (tx) => {
    await tx.class.update({ where: { id: cls.id }, data: { archivedAt: new Date() } });
    // Nothing should be scheduled for a class that no longer runs.
    const sections = await tx.section.findMany({ where: { classId: cls.id }, select: { id: true } });
    await tx.timetableSlot.deleteMany({ where: { sectionId: { in: sections.map((s) => s.id) } } });
    await tx.section.updateMany({ where: { classId: cls.id }, data: { classTeacherId: null } });
  });
  return sendSuccess(res, null, `${cls.name} archived. You can restore it from “Archived classes”.`);
}));

router.post('/classes/:id/restore', can('class.manage'), handler(async (req, res) => {
  const cls = await prisma.class.findFirst({ where: { id: req.params.id }, select: { id: true, name: true, archivedAt: true } });
  if (!cls) throw new AppError('Class not found', 404);
  if (!cls.archivedAt) throw new AppError('Class is not archived', 409);
  await prisma.class.update({ where: { id: cls.id }, data: { archivedAt: null } });
  return sendSuccess(res, null, `${cls.name} restored`);
}));

router.post('/classes/:id/sections', can('class.manage'), handler(async (req, res) => {
  const body = parseBody(z.object({ name: z.string().min(1).max(10), capacity: z.coerce.number().int().positive().optional() }), req);
  const cls = await prisma.class.findFirst({ where: { id: req.params.id }, select: { archivedAt: true } });
  if (!cls) throw new AppError('Class not found', 404);
  if (cls.archivedAt) throw new AppError('Restore the class before adding sections', 409);
  const section = await prisma.section.create({ data: { schoolId: currentSchoolId(), classId: req.params.id, ...body } });
  return sendSuccess(res, section, 'Section created', 201);
}));

const sectionUpdate = z.object({
  name: z.string().min(1).max(10).optional(),
  capacity: z.coerce.number().int().positive().nullable().optional(),
  classTeacherId: id.nullable().optional(),
}).strict();

router.patch('/sections/:id', can('class.manage'), handler(async (req, res) => {
  const body = parseBody(sectionUpdate, req);
  if (body.classTeacherId) {
    const t = await prisma.staff.findFirst({ where: { id: body.classTeacherId, isTeacher: true, status: onRoll } });
    if (!t) throw new AppError('Class teacher must be an active teacher', 422);
  }
  const section = await prisma.section.update({
    where: { id: req.params.id }, data: body, include: { classTeacher: { select: { id: true, name: true } } },
  });
  return sendSuccess(res, section, 'Section updated');
}));

router.delete('/sections/:id', can('class.manage'), handler(async (req, res) => {
  if (await prisma.student.count({ where: { sectionId: req.params.id } })) {
    throw new AppError('Section still has students; move them first', 409);
  }
  await transaction(async (tx) => {
    await tx.subjectAssignment.deleteMany({ where: { sectionId: req.params.id } });
    await tx.timetableSlot.deleteMany({ where: { sectionId: req.params.id } });
    await tx.section.delete({ where: { id: req.params.id } });
  });
  return sendSuccess(res, null, 'Section deleted');
}));

// ─── Subjects ───

router.get('/subjects', can('class.view'), handler(async (_req, res) => {
  return sendSuccess(res, await prisma.subject.findMany({ orderBy: { name: 'asc' } }));
}));

const subjectBody = z.object({ name: z.string().min(1).max(80), code: z.string().min(1).max(20).transform((s) => s.toUpperCase()) });

router.post('/subjects', can('class.manage'), handler(async (req, res) => {
  const body = parseBody(subjectBody, req);
  return sendSuccess(res, await prisma.subject.create({ data: { schoolId: currentSchoolId(), ...body } }), 'Subject created', 201);
}));

router.patch('/subjects/:id', can('class.manage'), handler(async (req, res) => {
  const body = parseBody(patchOf(subjectBody).strict(), req);
  return sendSuccess(res, await prisma.subject.update({ where: { id: req.params.id }, data: body }), 'Subject updated');
}));

// ─── Subject teachers per section (current year) ───

router.get('/sections/:id/subjects', can('class.view'), handler(async (req, res) => {
  const year = await currentAcademicYear();
  const rows = await prisma.subjectAssignment.findMany({
    where: { sectionId: req.params.id, academicYearId: year.id },
    include: { subject: true, teacher: { select: { id: true, name: true } } },
    orderBy: { subject: { name: 'asc' } },
  });
  return sendSuccess(res, rows);
}));

const assignmentsBody = z.object({
  assignments: z.array(z.object({ subjectId: id, teacherId: id })).max(30),
});

// Replaces the section's subject/teacher list for the current year.
router.put('/sections/:id/subjects', can('class.manage'), handler(async (req, res) => {
  const { assignments } = parseBody(assignmentsBody, req);
  const sectionId = req.params.id;
  await ensureInSchool(prisma.section, sectionId, 'Section');
  const subjectIds = [...new Set(assignments.map((a) => a.subjectId))];
  const teacherIds = [...new Set(assignments.map((a) => a.teacherId))];
  if (subjectIds.length !== assignments.length) throw new AppError('Each subject can appear only once', 422);
  const [subjects, teachers] = await Promise.all([
    prisma.subject.count({ where: { id: { in: subjectIds } } }),
    prisma.staff.count({ where: { id: { in: teacherIds }, isTeacher: true, status: onRoll } }),
  ]);
  if (subjects !== subjectIds.length || teachers !== teacherIds.length) throw new AppError('Unknown subject or teacher', 422);

  const year = await currentAcademicYear();
  const schoolId = currentSchoolId();
  await transaction(async (tx) => {
    await tx.subjectAssignment.deleteMany({ where: { sectionId, academicYearId: year.id } });
    await tx.subjectAssignment.createMany({
      data: assignments.map((a) => ({ schoolId, academicYearId: year.id, sectionId, ...a })),
    });
  });
  return sendSuccess(res, null, 'Subject teachers saved');
}));

export default router;
