import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma, { transaction } from '../../config/database';
import { currentSchoolId, runWithTenant } from '../../config/tenancy';
import { authenticate } from '../../middleware/auth';
import { can, hasPermission } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { handler, parseBody, parseQuery, dateOnly, id, me } from '../../utils/http';
import { toDate, toIso } from '../../utils/dates';
import { assertSectionAccess, assertStudentAccess, currentAcademicYear, ensureInSchool, isSchoolWide, staffForUser } from '../../utils/scope';
import { signedLink, verifySignature } from '../../utils/storage';
import { familiesOfSections, notify } from '../../utils/notify';
import { messageFamilies } from '../../utils/messaging';
import { validateScale } from './exams.calc';
import { assertCanEnterMarks, loadExam, reportCard, sectionResults } from './exams.service';
import { audit } from '../../utils/audit';
import { assertSheetWritable, loadSheet, retakeMaxSubjects, sheetAccess, writeEntries } from './exams.sheet';
import type { AuthRequest } from '../../middleware/auth';
import { renderReportCard } from './exams.pdf';

// Exams, marks entry, grade scale, results, report cards (spec §6 Academics, §8 Marks Entry, §10 Progress Report).
// Lifecycle: DRAFT (office builds the schedule) → SCHEDULED (principal approves; visible to
// parents; marks entry open) → PUBLISHED (principal publishes; results visible; marks locked).

const router = Router();
router.use(authenticate);

const STATUS_LABEL = { DRAFT: 'draft', SCHEDULED: 'scheduled', PUBLISHED: 'published' };

// ─── Grade scale ───

router.get('/grade-scale', can('exam.view'), handler(async (_req, res) => {
  return sendSuccess(res, await prisma.gradeScale.findMany({ orderBy: { minPercent: 'desc' } }));
}));

router.put('/grade-scale', can('exam.manage'), handler(async (req, res) => {
  const { grades } = parseBody(z.object({
    grades: z.array(z.object({
      grade: z.string().min(1).max(8), minPercent: z.coerce.number().min(0).max(100), maxPercent: z.coerce.number().min(0).max(100),
      remark: z.string().max(60).optional(),
    })).min(1).max(15),
  }), req);
  const problem = validateScale(grades);
  if (problem) throw new AppError(problem, 422);
  const schoolId = currentSchoolId();
  await transaction(async (tx) => {
    await tx.gradeScale.deleteMany({});
    await tx.gradeScale.createMany({ data: grades.map((g) => ({ schoolId, ...g })) });
  });
  return sendSuccess(res, null, 'Grade scale saved');
}));

// ─── Exams ───

router.get('/options', can('exam.view'), handler(async (_req,res)=>sendSuccess(res,{years:await prisma.academicYear.findMany({select:{id:true,name:true,isCurrent:true},orderBy:{startDate:'desc'}})})));

router.get('/', can('exam.view'), handler(async (req, res) => {
  const user = me(req);
  const q=parseQuery(z.object({academicYearId:id.optional()}),req);
  const year=q.academicYearId?await prisma.academicYear.findFirst({where:{id:q.academicYearId}}):await currentAcademicYear();
  if(!year)throw new AppError('Academic year not found',404);
  // Parents/students/teachers never see drafts.
  const where: Prisma.ExamWhereInput = {
    academicYearId: year.id,
    ...(hasPermission(user.role, 'exam.manage') || user.role === 'OWNER' ? {} : { status: { not: 'DRAFT' } }),
  };
  const exams = await prisma.exam.findMany({
    where, orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    include: { subjects: { select: { classId: true, class: { select: { name: true, level: true } }, _count: { select: { marks: true } } } } },
  });
  const strength = await prisma.section.findMany({ select: { classId: true, _count: { select: { students: { where: { status: 'ACTIVE' } } } } } });
  return sendSuccess(res, exams.map(({ subjects, ...e }) => ({
    ...e,
    startDate: e.startDate ? toIso(e.startDate) : null,
    endDate: e.endDate ? toIso(e.endDate) : null,
    classes: [...new Map(subjects.map((s) => [s.classId, s.class])).values()].sort((a, b) => a.level - b.level).map((c) => c.name),
    papers: subjects.length,
    marksExpected: subjects.reduce((n, s) => n + strength.filter(sec => sec.classId === s.classId).reduce((total, sec) => total + sec._count.students, 0), 0),
    marksEntered: subjects.reduce((n, s) => n + s._count.marks, 0),
  })));
}));

const examBody = z.object({ name: z.string().min(2).max(80), startDate: dateOnly.optional(), endDate: dateOnly.optional() })
  .refine((e) => !e.startDate || !e.endDate || e.endDate >= e.startDate, { message: 'End date is before start date', path: ['endDate'] });

router.post('/', can('exam.manage'), handler(async (req, res) => {
  const b = parseBody(examBody, req);
  const year = await currentAcademicYear();
  const exam = await prisma.exam.create({
    data: {
      schoolId: currentSchoolId(), academicYearId: year.id, name: b.name,
      startDate: b.startDate ? toDate(b.startDate) : null, endDate: b.endDate ? toDate(b.endDate) : null,
    },
  });
  return sendSuccess(res, exam, 'Exam created as draft', 201);
}));

router.get('/:id', can('exam.view'), handler(async (req, res) => {
  const user = me(req);
  const exam = await loadExam(req.params.id);
  if (exam.status === 'DRAFT' && !hasPermission(user.role, 'exam.manage') && user.role !== 'OWNER') throw new AppError('Exam not found', 404);
  const subjects = await prisma.examSubject.findMany({
    where: { examId: exam.id },
    include: { class: { select: { id: true, name: true, level: true } }, subject: { select: { id: true, name: true } }, _count: { select: { marks: true } } },
    orderBy: [{ class: { level: 'asc' } }, { date: 'asc' }],
  });
  const strength = await prisma.student.groupBy({
    by: ['sectionId'], where: { status: 'ACTIVE', section: { classId: { in: [...new Set(subjects.map((s) => s.classId))] } } }, _count: true,
  });
  const sections = await prisma.section.findMany({ where: { id: { in: strength.map((s) => s.sectionId!).filter(Boolean) } }, select: { id: true, classId: true } });
  const classStrength = new Map<string, number>();
  for (const s of strength) {
    const cls = sections.find((x) => x.id === s.sectionId)?.classId;
    if (cls) classStrength.set(cls, (classStrength.get(cls) ?? 0) + s._count);
  }
  const byClass = new Map<string, { classId: string; name: string; level: number; students: number; subjects: unknown[] }>();
  for (const s of subjects) {
    const c = byClass.get(s.classId) ?? { classId: s.classId, name: s.class.name, level: s.class.level, students: classStrength.get(s.classId) ?? 0, subjects: [] };
    c.subjects.push({
      id: s.id, subjectId: s.subjectId, name: s.subject.name, date: s.date ? toIso(s.date) : null,
      totalMarks: Number(s.totalMarks), passingMarks: Number(s.passingMarks), syllabus: s.syllabus, marksEntered: s._count.marks,
    });
    byClass.set(s.classId, c);
  }
  return sendSuccess(res, {
    ...exam,
    startDate: exam.startDate ? toIso(exam.startDate) : null,
    endDate: exam.endDate ? toIso(exam.endDate) : null,
    classes: [...byClass.values()].sort((a, b) => a.level - b.level),
  });
}));

async function editableExam(examId: string) {
  const exam = await loadExam(examId);
  if (exam.status === 'PUBLISHED') throw new AppError('Results are published; unpublish the exam to change it', 409);
  return exam;
}

router.patch('/:id', can('exam.manage'), handler(async (req, res) => {
  const b = parseBody(examBody, req);
  await editableExam(req.params.id);
  const exam = await prisma.exam.update({
    where: { id: req.params.id },
    data: { name: b.name, startDate: b.startDate ? toDate(b.startDate) : null, endDate: b.endDate ? toDate(b.endDate) : null },
  });
  return sendSuccess(res, exam, 'Exam updated');
}));

router.delete('/:id', can('exam.manage'), handler(async (req, res) => {
  const exam = await loadExam(req.params.id);
  if (exam.status !== 'DRAFT') throw new AppError('Only draft exams can be deleted', 409);
  await prisma.markSheet.deleteMany({ where: { examId: exam.id } });
  await prisma.exam.delete({ where: { id: exam.id } });
  return sendSuccess(res, null, 'Exam deleted');
}));

// Date sheet for one class: which subjects, when, out of how many marks.
router.put('/:id/classes/:classId/subjects', can('exam.manage'), handler(async (req, res) => {
  const { subjects } = parseBody(z.object({
    subjects: z.array(z.object({
      subjectId: id,
      date: dateOnly.optional().nullable(),
      totalMarks: z.coerce.number().positive().max(1000),
      passingMarks: z.coerce.number().min(0).max(1000),
      syllabus: z.string().max(2000).optional().nullable(),
    }).refine((s) => s.passingMarks <= s.totalMarks, { message: 'Passing marks exceed total', path: ['passingMarks'] })).max(20),
  }), req);
  const exam = await editableExam(req.params.id);
  const classId = req.params.classId;
  await ensureInSchool(prisma.class, classId, 'Class');
  const subjectIds = subjects.map((s) => s.subjectId);
  if (new Set(subjectIds).size !== subjectIds.length) throw new AppError('Each subject can appear only once', 422);
  if ((await prisma.subject.count({ where: { id: { in: subjectIds } } })) !== subjectIds.length) throw new AppError('Unknown subject', 422);

  const schoolId = currentSchoolId();
  await transaction(async (tx) => {
    const existing = await tx.examSubject.findMany({ where: { examId: exam.id, classId }, include: { _count: { select: { marks: true } } } });
    const removed = existing.filter((e) => !subjectIds.includes(e.subjectId));
    if (removed.some((r) => r._count.marks > 0)) throw new AppError('Cannot remove a subject that already has marks', 409);
    await tx.examSubject.deleteMany({ where: { id: { in: removed.map((r) => r.id) } } });
    for (const s of subjects) {
      const data = {
        date: s.date ? toDate(s.date) : null, totalMarks: s.totalMarks, passingMarks: s.passingMarks, syllabus: s.syllabus ?? null,
      };
      const cur = existing.find((e) => e.subjectId === s.subjectId);
      if (cur) await tx.examSubject.update({ where: { id: cur.id }, data });
      else await tx.examSubject.create({ data: { schoolId, examId: exam.id, classId, subjectId: s.subjectId, ...data } });
    }
  });
  return sendSuccess(res, null, 'Date sheet saved');
}));

// ─── Workflow ───

router.post('/:id/approve', can('exam.approve'), handler(async (req, res) => {
  const exam = await loadExam(req.params.id);
  if (exam.status !== 'DRAFT') throw new AppError(`Exam is already ${STATUS_LABEL[exam.status]}`, 409);
  if (!(await prisma.examSubject.count({ where: { examId: exam.id } }))) throw new AppError('Add the date sheet before approving', 422);
  await prisma.exam.update({ where: { id: exam.id }, data: { status: 'SCHEDULED', approvedById: me(req).id } });
  return sendSuccess(res, null, 'Schedule approved — parents can now see it and teachers can enter marks');
}));

router.post('/:id/publish', can('exam.approve'), handler(async (req, res) => {
  const exam = await loadExam(req.params.id);
  if (exam.status !== 'SCHEDULED') throw new AppError(exam.status === 'DRAFT' ? 'Approve the schedule first' : 'Already published', 409);
  const papers = await prisma.examSubject.findMany({ where: { examId: exam.id }, select: { classId: true } });
  const classIds = [...new Set(papers.map((p) => p.classId))];
  const sections = await prisma.section.findMany({ where: { classId: { in: classIds } }, select: { id: true } });
  await prisma.exam.update({ where: { id: exam.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
  // Spec: "Result / Report card published → Parent + Student".
  const notified = await notify(await familiesOfSections(sections.map((s) => s.id)), {
    type: 'RESULT_PUBLISHED', title: `${exam.name} results are out`, body: 'Open the app to see marks and download the report card.',
    data: { examId: exam.id },
  });
  const students = await prisma.student.findMany({ where: { status: 'ACTIVE', sectionId: { in: sections.map((s) => s.id) } }, select: { id: true, name: true } });
  await messageFamilies('RESULT_PUBLISHED', students.map((s) => ({ studentId: s.id, body: `${exam.name} results for ${s.name} are out. See the school app or ask the office for the report card.` })));
  return sendSuccess(res, { notified }, `Results published — ${notified} families notified`);
}));

router.post('/:id/unpublish', can('exam.approve'), handler(async (req, res) => {
  const exam = await loadExam(req.params.id);
  if (exam.status !== 'PUBLISHED') throw new AppError('Exam is not published', 409);
  await prisma.exam.update({ where: { id: exam.id }, data: { status: 'SCHEDULED', publishedAt: null } });
  return sendSuccess(res, null, 'Results hidden again; marks can be corrected');
}));

// ─── Marks entry ───

/** Teacher's to-do list: papers they can enter marks for in scheduled exams. */
router.get('/marks/assignments', can('marks.enter', 'exam.manage'), handler(async (req, res) => {
  const user = me(req);
  const year = await currentAcademicYear();
  const staff = await staffForUser(user.id);
  const teaching = hasPermission(user.role, 'exam.manage') ? null
    : await prisma.subjectAssignment.findMany({ where: { teacherId: staff?.id ?? '-', academicYearId: year.id }, select: { sectionId: true, subjectId: true } });
  const papers = await prisma.examSubject.findMany({
    where: { exam: { status: 'SCHEDULED', academicYearId: year.id } },
    include: { exam: { select: { id: true, name: true } }, subject: { select: { name: true } }, class: { select: { id: true, name: true, level: true, sections: { select: { id: true, name: true } } } } },
    orderBy: [{ class: { level: 'asc' } }, { date: 'asc' }],
  });
  const tasks = papers.flatMap((p) => p.class.sections
    .filter((sec) => !teaching || teaching.some((t) => t.sectionId === sec.id && t.subjectId === p.subjectId))
    .map((sec) => ({ examId: p.exam.id, exam: p.exam.name, examSubjectId: p.id, subjectId: p.subjectId, subject: p.subject.name, sectionId: sec.id, section: `${p.class.name}-${sec.name}`, date: p.date ? toIso(p.date) : null, totalMarks: Number(p.totalMarks) })));
  // Entered counts are per section, so look at each mark's student.
  const entered = await prisma.mark.findMany({
    where: { examSubjectId: { in: tasks.map((t) => t.examSubjectId) } }, select: { examSubjectId: true, student: { select: { sectionId: true } } },
  });
  const strength = await prisma.student.groupBy({ by: ['sectionId'], where: { status: 'ACTIVE', sectionId: { in: tasks.map((t) => t.sectionId) } }, _count: true });
  return sendSuccess(res, tasks.map((t) => ({
    ...t,
    students: strength.find((s) => s.sectionId === t.sectionId)?._count ?? 0,
    entered: entered.filter((e) => e.examSubjectId === t.examSubjectId && e.student.sectionId === t.sectionId).length,
  })));
}));

async function paperFor(examId: string, sectionId: string, subjectId: string) {
  const section = await prisma.section.findFirst({ where: { id: sectionId }, select: { classId: true } });
  if (!section) throw new AppError('Section not found', 404);
  const paper = await prisma.examSubject.findFirst({ where: { examId, classId: section.classId, subjectId }, include: { subject: { select: { name: true } } } });
  if (!paper) throw new AppError('This subject is not in the exam for this class', 404);
  return paper;
}

router.get('/:id/marks', can('marks.enter', 'exam.manage', 'marks.view'), handler(async (req, res) => {
  const q = parseQuery(z.object({ sectionId: id, subjectId: id }), req);
  const user = me(req);
  const exam = await loadExam(req.params.id);
  await assertCanEnterMarks(user, q.sectionId, q.subjectId, exam.academicYearId);
  const paper = await paperFor(exam.id, q.sectionId, q.subjectId);
  const [students, marks] = await Promise.all([
    prisma.student.findMany({ where: { sectionId: q.sectionId, status: 'ACTIVE' }, select: { id: true, name: true, admissionNo: true, rollNo: true }, orderBy: [{ rollNo: 'asc' }, { name: 'asc' }] }),
    prisma.mark.findMany({ where: { examSubjectId: paper.id } }),
  ]);
  const byStudent = new Map(marks.map((m) => [m.studentId, m]));
  return sendSuccess(res, {
    exam: { id: exam.id, name: exam.name, status: exam.status },
    paper: { id: paper.id, subject: paper.subject.name, totalMarks: Number(paper.totalMarks), passingMarks: Number(paper.passingMarks), date: paper.date ? toIso(paper.date) : null },
    locked: exam.status !== 'SCHEDULED',
    students: students.map((s) => {
      const m = byStudent.get(s.id);
      return { ...s, obtained: m?.obtained != null ? Number(m.obtained) : null, isAbsent: m?.isAbsent ?? false, remarks: m?.remarks ?? null };
    }),
  });
}));

router.put('/:id/marks', can('marks.enter', 'exam.manage'), handler(async (req, res) => {
  const body = parseBody(z.object({
    sectionId: id,
    subjectId: id,
    records: z.array(z.object({
      studentId: id,
      obtained: z.coerce.number().min(0).max(1000).multipleOf(0.25).nullable().optional(),
      isAbsent: z.boolean().default(false),
      remarks: z.string().max(200).optional().nullable(),
    })).min(1).max(200),
  }), req);
  const user = me(req);
  const exam = await loadExam(req.params.id);
  if (exam.status !== 'SCHEDULED') throw new AppError(exam.status === 'DRAFT' ? 'The schedule is not approved yet' : 'Results are published; marks are locked', 409);
  await assertCanEnterMarks(user, body.sectionId, body.subjectId, exam.academicYearId);
  // A submitted marks sheet (CR-07) is read-only until an exam manager reopens it.
  await assertSheetWritable(exam, body.sectionId);
  const paper = await paperFor(exam.id, body.sectionId, body.subjectId);
  const total = Number(paper.totalMarks);

  const ids = body.records.map((r) => r.studentId);
  if (new Set(ids).size !== ids.length) throw new AppError('Duplicate student in records', 422);
  if ((await prisma.student.count({ where: { id: { in: ids }, sectionId: body.sectionId, status: 'ACTIVE' } })) !== ids.length) {
    throw new AppError('Some students are not active in this section', 422);
  }
  const over = body.records.find((r) => !r.isAbsent && r.obtained != null && r.obtained > total);
  if (over) throw new AppError(`Marks cannot be more than ${total}`, 422);

  const schoolId = currentSchoolId();
  const toSave = body.records.filter((r) => r.isAbsent || r.obtained != null);
  const toClear = body.records.filter((r) => !r.isAbsent && r.obtained == null).map((r) => r.studentId);
  await transaction(async (tx) => {
    for (const r of toSave) {
      const data = { obtained: r.isAbsent ? null : r.obtained!, isAbsent: r.isAbsent, remarks: r.remarks ?? null, enteredById: user.id };
      await tx.mark.upsert({
        where: { examSubjectId_studentId: { examSubjectId: paper.id, studentId: r.studentId } },
        create: { schoolId, examSubjectId: paper.id, studentId: r.studentId, ...data },
        update: data,
      });
    }
    if (toClear.length) await tx.mark.deleteMany({ where: { examSubjectId: paper.id, studentId: { in: toClear } } });
  });
  return sendSuccess(res, { saved: toSave.length, cleared: toClear.length }, 'Marks saved');
}));

// ─── Marks entry dashboard (CR-07): whole section sheet, draft → submit → reopen ───

/**
 * Filters for the dashboard: academic years, that year's exams, and per exam the classes and
 * sections this user may load (teachers: sections where they teach a subject of the exam).
 */
router.get('/marks/options', can('marks.enter', 'exam.manage'), handler(async (req, res) => {
  const q = parseQuery(z.object({ academicYearId: id.optional() }), req);
  const user = me(req);
  const manager = hasPermission(user.role, 'exam.manage');
  const years = await prisma.academicYear.findMany({ orderBy: { startDate: 'desc' }, select: { id: true, name: true, isCurrent: true } });
  const year = q.academicYearId ? years.find((y) => y.id === q.academicYearId) : years.find((y) => y.isCurrent) ?? years[0];
  if (q.academicYearId && !year) throw new AppError('Academic year not found', 404);
  const retakeMax = await retakeMaxSubjects();
  if (!year) return sendSuccess(res, { years, academicYearId: null, exams: [], retakeMaxSubjects: retakeMax, canManage: manager });

  const exams = await prisma.exam.findMany({
    where: { academicYearId: year.id, ...(manager ? {} : { status: { not: 'DRAFT' } }) },
    orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true, name: true, status: true,
      subjects: { select: { subjectId: true, class: { select: { id: true, name: true, level: true, archivedAt: true, sections: { select: { id: true, name: true } } } } } },
    },
  });
  const staff = manager ? null : await staffForUser(user.id);
  const teaching = manager ? null : await prisma.subjectAssignment.findMany({
    where: { teacherId: staff?.id ?? '-', academicYearId: year.id }, select: { sectionId: true, subjectId: true },
  });
  const sheets = await prisma.markSheet.findMany({ where: { examId: { in: exams.map((e) => e.id) } }, select: { examId: true, sectionId: true, status: true } });
  const sheetStatus = new Map(sheets.map((s) => [`${s.examId}:${s.sectionId}`, s.status]));

  type SectionOpt = { id: string; name: string; sheetStatus: string | null };
  const out = exams.map((e) => {
    const classes = new Map<string, { id: string; name: string; level: number; sections: SectionOpt[] }>();
    for (const p of e.subjects) {
      if (p.class.archivedAt) continue;
      const allowed = p.class.sections.filter((sec) => !teaching || teaching.some((t) => t.sectionId === sec.id && t.subjectId === p.subjectId));
      if (!allowed.length) continue;
      const c = classes.get(p.class.id) ?? { id: p.class.id, name: p.class.name, level: p.class.level, sections: [] };
      for (const sec of allowed) {
        if (!c.sections.some((x) => x.id === sec.id)) c.sections.push({ id: sec.id, name: sec.name, sheetStatus: sheetStatus.get(`${e.id}:${sec.id}`) ?? null });
      }
      c.sections.sort((a, b) => a.name.localeCompare(b.name));
      classes.set(p.class.id, c);
    }
    return { id: e.id, name: e.name, status: e.status, classes: [...classes.values()].sort((a, b) => a.level - b.level) };
  }).filter((e) => manager || e.classes.length);
  return sendSuccess(res, { years, academicYearId: year.id, exams: out, retakeMaxSubjects: retakeMax, canManage: manager });
}));

/** School-wide "Keep for Retake" limit: failing up to N subjects = retake, more = fail. */
router.patch('/marks/settings', can('exam.manage'), handler(async (req, res) => {
  const b = parseBody(z.object({
    retakeMaxSubjects: z.coerce.number({ error: 'Enter a number' }).int({ error: 'Enter a whole number' })
      .min(0, { error: 'Cannot be negative' }).max(20, { error: 'Cannot be more than 20' }),
  }), req);
  const before = await retakeMaxSubjects();
  await prisma.school.update({ where: { id: currentSchoolId() }, data: { retakeMaxSubjects: b.retakeMaxSubjects } });
  await audit(req, { action: 'Retake rule changed', entity: 'marks-settings', entityId: currentSchoolId(), meta: { retakeMaxSubjects: { from: before, to: b.retakeMaxSubjects } } });
  return sendSuccess(res, { retakeMaxSubjects: b.retakeMaxSubjects }, 'Retake rule saved');
}));

router.get('/:id/sheet', can('marks.enter', 'exam.manage'), handler(async (req, res) => {
  const { sectionId } = parseQuery(z.object({ sectionId: id }), req);
  return sendSuccess(res, await loadSheet(me(req), req.params.id, sectionId));
}));

const sheetBody = z.object({
  sectionId: id,
  remarks: z.string().max(2000, { error: 'Remarks can be at most 2000 characters' }).optional().nullable(),
  entries: z.array(z.object({
    studentId: id,
    examSubjectId: id,
    obtained: z.number({ error: 'Marks must be a number' }).min(0, { error: 'Marks cannot be negative' }).max(1000, { error: 'Marks are too large' })
      .multipleOf(0.25, { error: 'Marks can only be in steps of 0.25' }).nullable().optional(),
    isAbsent: z.boolean().default(false),
  })).max(3_000).default([]), // one section × its papers is far below this (API-3)
});

/** Saves marks (and sheet remarks); with submit, also checks completeness and locks the sheet. */
async function saveSheet(req: AuthRequest, submit: boolean) {
  const body = parseBody(sheetBody, req);
  const user = me(req);
  const exam = await loadExam(req.params.id);
  const { editable } = await sheetAccess(user, exam, body.sectionId);
  const schoolId = currentSchoolId();
  return transaction(async (tx) => {
    await assertSheetWritable(exam, body.sectionId, tx);
    const result = await writeEntries(tx, user, exam, body.sectionId, editable, body.entries);
    if (submit) {
      // Every active student must have every subject entered (or marked absent).
      const section = await tx.section.findFirstOrThrow({ where: { id: body.sectionId }, select: { classId: true } });
      const papers = await tx.examSubject.count({ where: { examId: exam.id, classId: section.classId } });
      const students = await tx.student.findMany({ where: { sectionId: body.sectionId, status: 'ACTIVE' }, select: { id: true } });
      if (!students.length) throw new AppError('There are no active students in this section', 422);
      const entered = await tx.mark.count({
        where: {
          examSubject: { examId: exam.id, classId: section.classId }, studentId: { in: students.map((s) => s.id) },
          OR: [{ isAbsent: true }, { obtained: { not: null } }],
        },
      });
      const missing = papers * students.length - entered;
      if (missing > 0) throw new AppError(`${missing} mark${missing === 1 ? ' is' : 's are'} still missing. Enter every subject (or mark the student absent) before submitting.`, 422);
    }
    const remarks = body.remarks === undefined ? undefined : body.remarks?.trim() || null;
    const data = submit
      ? { status: 'SUBMITTED' as const, submittedById: user.id, submittedAt: new Date(), ...(remarks !== undefined ? { remarks } : {}) }
      : { status: 'DRAFT' as const, ...(remarks !== undefined ? { remarks } : {}) };
    const sheet = await tx.markSheet.upsert({
      where: { examId_sectionId: { examId: exam.id, sectionId: body.sectionId } },
      create: { schoolId, examId: exam.id, sectionId: body.sectionId, ...data },
      update: data,
    });
    return { ...result, sheetId: sheet.id, status: sheet.status, examId: exam.id, sectionId: body.sectionId };
  });
}

router.put('/:id/sheet', can('marks.enter', 'exam.manage'), handler(async (req, res) => {
  return sendSuccess(res, await saveSheet(req, false), 'Draft saved');
}));

router.post('/:id/sheet/submit', can('marks.enter', 'exam.manage'), handler(async (req, res) => {
  const r = await saveSheet(req, true);
  await audit(req, { action: 'Marks submitted', entity: 'mark-sheet', entityId: r.sheetId, meta: { examId: r.examId, sectionId: r.sectionId, saved: r.saved, cleared: r.cleared } });
  return sendSuccess(res, r, 'Marks submitted');
}));

router.post('/:id/sheet/reopen', can('exam.manage'), handler(async (req, res) => {
  const { sectionId } = parseBody(z.object({ sectionId: id }), req);
  const exam = await loadExam(req.params.id);
  if (exam.status === 'PUBLISHED') throw new AppError('Results are published; unpublish them before reopening marks', 409);
  const sheet = await prisma.markSheet.findUnique({ where: { examId_sectionId: { examId: exam.id, sectionId } } });
  if (!sheet || sheet.status !== 'SUBMITTED') throw new AppError('These marks are not submitted', 409);
  await prisma.markSheet.update({ where: { id: sheet.id }, data: { status: 'DRAFT', submittedAt: null, submittedById: null } });
  await audit(req, { action: 'Marks reopened', entity: 'mark-sheet', entityId: sheet.id, meta: { examId: exam.id, sectionId, from: 'SUBMITTED', to: 'DRAFT', submittedById: sheet.submittedById, submittedAt: sheet.submittedAt } });
  return sendSuccess(res, { status: 'DRAFT' }, 'Marks reopened for editing');
}));

// ─── Results & analysis ───

router.get('/:id/results', can('marks.view', 'exam.manage', 'marks.enter'), handler(async (req, res) => {
  const { sectionId } = parseQuery(z.object({ sectionId: id }), req);
  const user = me(req);
  if (!isSchoolWide(user) && user.role !== 'TEACHER') throw new AppError('Forbidden: insufficient permissions', 403);
  await assertSectionAccess(user, sectionId);
  const exam = await loadExam(req.params.id);
  const results = await sectionResults(exam.id, sectionId);
  const remarks = await prisma.examRemark.findMany({ where: { examId: exam.id, studentId: { in: results.students.map((s) => s.student.id) } } });
  return sendSuccess(res, {
    exam: { id: exam.id, name: exam.name, status: exam.status },
    ...results,
    students: results.students.map((s) => ({ ...s, remarks: remarks.find((r) => r.studentId === s.student.id)?.remarks ?? null })),
  });
}));

// Spec: "Exam Result Analysis — Principal, Teacher (PDF + charts)".
router.get('/:id/analysis', can('marks.view', 'exam.manage'), handler(async (req, res) => {
  const { classId } = parseQuery(z.object({ classId: id }), req);
  if (!isSchoolWide(me(req))) throw new AppError('Forbidden: insufficient permissions', 403);
  const exam = await loadExam(req.params.id);
  const sections = await prisma.section.findMany({ where: { classId }, select: { id: true }, orderBy: { name: 'asc' } });
  const all = await Promise.all(sections.map((s) => sectionResults(exam.id, s.id)));
  const students = all.flatMap((r) => r.students.map((s) => ({ ...s, section: r.section.name })));
  const complete = students.filter((s) => s.complete);
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);
  const subjects = all[0]?.subjects ?? [];

  return sendSuccess(res, {
    exam: { id: exam.id, name: exam.name, status: exam.status },
    students: students.length,
    resultsComplete: complete.length,
    passPercent: complete.length ? Math.round((complete.filter((s) => s.passed).length / complete.length) * 1000) / 10 : null,
    average: avg(complete.map((s) => s.percent!)),
    sections: all.map((r) => {
      const c = r.students.filter((s) => s.complete);
      return {
        sectionId: r.section.id, name: r.section.name, students: r.students.length, complete: c.length,
        average: avg(c.map((s) => s.percent!)),
        passPercent: c.length ? Math.round((c.filter((s) => s.passed).length / c.length) * 1000) / 10 : null,
      };
    }),
    subjects: subjects.map((sub) => {
      const scores = students.flatMap((s) => s.subjects.filter((x) => x.examSubjectId === sub.id && x.percent !== null));
      return {
        name: sub.name, totalMarks: sub.totalMarks, entered: scores.length,
        average: avg(scores.map((x) => x.percent!)),
        passPercent: scores.length ? Math.round((scores.filter((x) => x.passed).length / scores.length) * 1000) / 10 : null,
        highest: scores.length ? Math.max(...scores.map((x) => (x.isAbsent ? 0 : x.obtained ?? 0))) : null,
      };
    }),
    gradeDistribution: Object.entries(complete.reduce<Record<string, number>>((m, s) => ({ ...m, [s.grade ?? '—']: (m[s.grade ?? '—'] ?? 0) + 1 }), {}))
      .map(([grade, count]) => ({ grade, count })),
    toppers: [...complete].sort((a, b) => b.percent! - a.percent!).slice(0, 5)
      .map((s) => ({ name: s.student.name, section: s.section, percent: s.percent, grade: s.grade })),
  });
}));

// ─── Remarks (class teacher / principal) ───

router.put('/:id/remarks', can('marks.enter', 'exam.manage'), handler(async (req, res) => {
  const body = parseBody(z.object({
    sectionId: id,
    remarks: z.array(z.object({ studentId: id, remarks: z.string().max(500) })).min(1).max(200),
  }), req);
  const user = me(req);
  const exam = await loadExam(req.params.id);
  if (exam.status === 'PUBLISHED') throw new AppError('Results are published; remarks are locked', 409);
  if (!hasPermission(user.role, 'exam.manage')) {
    const staff = await staffForUser(user.id);
    const section = await prisma.section.findFirst({ where: { id: body.sectionId }, select: { classTeacherId: true } });
    if (!staff || section?.classTeacherId !== staff.id) throw new AppError('Only the class teacher writes report-card remarks', 403);
  }
  const ids = body.remarks.map((r) => r.studentId);
  if ((await prisma.student.count({ where: { id: { in: ids }, sectionId: body.sectionId } })) !== new Set(ids).size) throw new AppError('Some students are not in this section', 422);
  const schoolId = currentSchoolId();
  await transaction(async (tx) => {
    for (const r of body.remarks) {
      if (!r.remarks.trim()) { await tx.examRemark.deleteMany({ where: { examId: exam.id, studentId: r.studentId } }); continue; }
      await tx.examRemark.upsert({
        where: { examId_studentId: { examId: exam.id, studentId: r.studentId } },
        create: { schoolId, examId: exam.id, studentId: r.studentId, remarks: r.remarks.trim(), enteredById: user.id },
        update: { remarks: r.remarks.trim(), enteredById: user.id },
      });
    }
  });
  return sendSuccess(res, null, 'Remarks saved');
}));

// ─── Report cards ───

/** Parents and students only see published results; staff can preview. */
async function assertCanSeeReportCard(user: ReturnType<typeof me>, examId: string, studentId: string) {
  await assertStudentAccess(user, studentId);
  const exam = await loadExam(examId);
  if ((user.role === 'PARENT' || user.role === 'STUDENT') && exam.status !== 'PUBLISHED') throw new AppError('Results are not published yet', 404);
  if (user.role === 'ACCOUNTANT') throw new AppError('Forbidden: insufficient permissions', 403);
  return exam;
}

router.get('/:id/report-card/:studentId', can('marks.view', 'exam.manage', 'marks.enter'), handler(async (req, res) => {
  await assertCanSeeReportCard(me(req), req.params.id, req.params.studentId);
  return sendSuccess(res, await reportCard(req.params.id, req.params.studentId));
}));

// A 15-minute signed link the browser or phone can open/download without a token.
router.get('/:id/report-card/:studentId/pdf-link', can('marks.view', 'exam.manage', 'marks.enter'), handler(async (req, res) => {
  await assertCanSeeReportCard(me(req), req.params.id, req.params.studentId);
  const schoolId = currentSchoolId();
  const { id: examId, studentId } = req.params;
  const url = signedLink(`/report-cards/${schoolId}/${examId}/${studentId}.pdf`, `rc/${schoolId}/${examId}/${studentId}`);
  return sendSuccess(res, { url });
}));

export default router;

/** Public (signed-link) PDF download, mounted at /api/v1/report-cards. */
export const reportCardPdfRouter = Router();
reportCardPdfRouter.get('/:schoolId/:examId/:studentId.pdf', handler(async (req, res) => {
  const { schoolId, examId, studentId } = req.params;
  if (!verifySignature(`rc/${schoolId}/${examId}/${studentId}`, req.query.exp as string, req.query.sig as string)) {
    throw new AppError('Link expired or invalid', 403);
  }
  // The signature proves which school this is; run the queries scoped to it.
  const pdf = await runWithTenant(schoolId, async () => renderReportCard(await reportCard(examId, studentId)));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="report-card-${studentId.slice(0, 8)}.pdf"`);
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(pdf);
}));
