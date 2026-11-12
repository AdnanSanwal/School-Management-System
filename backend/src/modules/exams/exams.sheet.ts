import prisma, { type ScopedTx } from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { AppError } from '../../middleware/errorHandler';
import { hasPermission } from '../../middleware/rbac';
import { staffForUser } from '../../utils/scope';
import type { JwtPayload } from '../../utils/jwt';
import { sheetOutcome } from './exams.calc';
import { loadExam, sectionResults } from './exams.service';

// Marks entry dashboard (CR-07): one sheet = one exam × one section, every subject at once.
// A sheet is DRAFT while marks are being entered and SUBMITTED once handed in; a submitted
// sheet is read-only until someone with exam.manage reopens it.

type Exam = Awaited<ReturnType<typeof loadExam>>;

export interface SheetEntry {
  studentId: string;
  examSubjectId: string;
  obtained?: number | null;
  isAbsent: boolean;
}

export async function retakeMaxSubjects() {
  const school = await prisma.school.findUniqueOrThrow({ where: { id: currentSchoolId() }, select: { retakeMaxSubjects: true } });
  return school.retakeMaxSubjects;
}

/** Why marks in this exam can't be changed right now, or null when they can. */
export function examLockReason(exam: Pick<Exam, 'status'>) {
  if (exam.status === 'DRAFT') return 'The exam schedule is not approved yet, so marks cannot be entered.';
  if (exam.status === 'PUBLISHED') return 'Results are published; marks are locked.';
  return null;
}

/**
 * What this user may do with one section's sheet. Exam managers (principal/office) may load
 * and edit every subject; a teacher only loads a section where they teach at least one subject
 * of this exam, and only edits the subjects they teach (same rule as assertCanEnterMarks).
 */
export async function sheetAccess(user: JwtPayload, exam: Exam, sectionId: string) {
  const section = await prisma.section.findFirst({
    where: { id: sectionId },
    select: { id: true, name: true, classId: true, class: { select: { name: true } } },
  });
  if (!section) throw new AppError('Section not found', 404);
  const manager = hasPermission(user.role, 'exam.manage');
  if (exam.status === 'DRAFT' && !manager) throw new AppError('Exam not found', 404);
  const papers = await prisma.examSubject.findMany({ where: { examId: exam.id, classId: section.classId }, select: { id: true, subjectId: true } });
  if (!papers.length) throw new AppError(`${section.class.name} is not part of this exam`, 404);

  let editable: Set<string>; // examSubjectIds
  if (manager) editable = new Set(papers.map((p) => p.id));
  else {
    if (!hasPermission(user.role, 'marks.enter')) throw new AppError('Forbidden: insufficient permissions', 403);
    const staff = await staffForUser(user.id);
    const taught = staff ? await prisma.subjectAssignment.findMany({
      where: { teacherId: staff.id, sectionId, academicYearId: exam.academicYearId }, select: { subjectId: true },
    }) : [];
    const subjectIds = new Set(taught.map((t) => t.subjectId));
    editable = new Set(papers.filter((p) => subjectIds.has(p.subjectId)).map((p) => p.id));
    if (!editable.size) throw new AppError('You do not teach any subject of this exam in this section', 403);
  }
  return { section, manager, editable };
}

/** The whole sheet: subjects, students with marks, totals, grades and Pass / Retake / Fail. */
export async function loadSheet(user: JwtPayload, examId: string, sectionId: string) {
  const exam = await loadExam(examId);
  const access = await sheetAccess(user, exam, sectionId);
  const [results, sheet, maxRetake] = await Promise.all([
    sectionResults(exam.id, sectionId),
    prisma.markSheet.findUnique({ where: { examId_sectionId: { examId: exam.id, sectionId } } }),
    retakeMaxSubjects(),
  ]);
  const submittedBy = sheet?.submittedById
    ? await prisma.user.findFirst({ where: { id: sheet.submittedById }, select: { name: true } })
    : null;

  const students = results.students.map((s) => ({
    id: s.student.id, name: s.student.name, admissionNo: s.student.admissionNo, rollNo: s.student.rollNo,
    marks: Object.fromEntries(s.subjects.map((x) => [x.examSubjectId, { obtained: x.isAbsent ? null : x.obtained, isAbsent: x.isAbsent }])),
    total: s.obtained, maxMarks: s.maxMarks, percent: s.percent, grade: s.grade, complete: s.complete,
    failedSubjects: s.failedSubjects, outcome: sheetOutcome(s, maxRetake), position: s.position,
  }));
  const status = sheet?.status ?? 'DRAFT';
  const lockReason = examLockReason(exam)
    ?? (status === 'SUBMITTED' ? 'These marks were submitted and are read-only. An exam manager can reopen them.' : null);

  return {
    exam: { id: exam.id, name: exam.name, status: exam.status, academicYear: exam.academicYear.name },
    section: { id: access.section.id, name: access.section.name, classId: access.section.classId, className: access.section.class.name },
    sheet: {
      id: sheet?.id ?? null, status, remarks: sheet?.remarks ?? '',
      submittedAt: sheet?.submittedAt ?? null, submittedBy: submittedBy?.name ?? null, updatedAt: sheet?.updatedAt ?? null,
    },
    subjects: results.subjects.map((s) => ({ ...s, editable: access.editable.has(s.id) })),
    students,
    scale: results.scale,
    retakeMaxSubjects: maxRetake,
    summary: {
      students: students.length,
      passed: students.filter((s) => s.outcome === 'PASS').length,
      failed: students.filter((s) => s.outcome === 'FAIL').length,
      retake: students.filter((s) => s.outcome === 'RETAKE').length,
      pending: students.filter((s) => s.outcome === null).length,
    },
    permissions: {
      canEdit: !lockReason,
      canSubmit: !lockReason,
      canReopen: status === 'SUBMITTED' && access.manager && exam.status !== 'PUBLISHED',
      lockReason,
    },
  };
}

/** Throws when this section's marks may not be changed (exam closed or sheet submitted). */
export async function assertSheetWritable(exam: Exam, sectionId: string, db: Pick<ScopedTx, 'markSheet'> = prisma) {
  const reason = examLockReason(exam);
  if (reason) throw new AppError(reason, 409);
  const sheet = await db.markSheet.findUnique({ where: { examId_sectionId: { examId: exam.id, sectionId } }, select: { status: true } });
  if (sheet?.status === 'SUBMITTED') throw new AppError('Marks for this section were submitted. Ask an exam manager to reopen them before making changes.', 409);
}

/**
 * Validates and writes a batch of sheet entries (only cells that actually changed are written).
 * Every entry must be a subject of this exam for the section's class that the user may edit,
 * for an active student of the section, with marks between 0 and the subject's total.
 */
export async function writeEntries(tx: ScopedTx, user: JwtPayload, exam: Exam, sectionId: string, editable: Set<string>, entries: SheetEntry[]) {
  if (!entries.length) return { saved: 0, cleared: 0 };
  const seen = new Set<string>();
  for (const e of entries) {
    const key = `${e.studentId}:${e.examSubjectId}`;
    if (seen.has(key)) throw new AppError('The same mark appears twice in the request', 422);
    seen.add(key);
  }
  const section = await tx.section.findFirst({ where: { id: sectionId }, select: { classId: true } });
  if (!section) throw new AppError('Section not found', 404);
  const paperIds = [...new Set(entries.map((e) => e.examSubjectId))];
  const papers = await tx.examSubject.findMany({
    where: { id: { in: paperIds }, examId: exam.id, classId: section.classId }, include: { subject: { select: { name: true } } },
  });
  if (papers.length !== paperIds.length) throw new AppError('Some subjects are not part of this exam for this class', 422);
  const locked = papers.find((p) => !editable.has(p.id));
  if (locked) throw new AppError(`You cannot enter ${locked.subject.name} marks for this section`, 403);
  const byPaper = new Map(papers.map((p) => [p.id, p]));

  const studentIds = [...new Set(entries.map((e) => e.studentId))];
  if ((await tx.student.count({ where: { id: { in: studentIds }, sectionId, status: 'ACTIVE' } })) !== studentIds.length) {
    throw new AppError('Some students are not active in this section', 422);
  }
  for (const e of entries) {
    const p = byPaper.get(e.examSubjectId)!;
    const total = Number(p.totalMarks);
    if (!e.isAbsent && e.obtained != null && (e.obtained < 0 || e.obtained > total)) {
      throw new AppError(`${p.subject.name} marks must be between 0 and ${total}`, 422);
    }
  }

  const existing = await tx.mark.findMany({ where: { examSubjectId: { in: paperIds }, studentId: { in: studentIds } } });
  const current = new Map(existing.map((m) => [`${m.studentId}:${m.examSubjectId}`, m]));
  const schoolId = currentSchoolId();
  let saved = 0;
  const toClear: { studentId: string; examSubjectId: string }[] = [];
  for (const e of entries) {
    const m = current.get(`${e.studentId}:${e.examSubjectId}`);
    const obtained = e.isAbsent ? null : e.obtained ?? null;
    if (!e.isAbsent && obtained === null) { if (m) toClear.push(e); continue; }
    if (m && m.isAbsent === e.isAbsent && (m.obtained === null ? null : Number(m.obtained)) === obtained) continue;
    const data = { obtained, isAbsent: e.isAbsent, enteredById: user.id };
    await tx.mark.upsert({
      where: { examSubjectId_studentId: { examSubjectId: e.examSubjectId, studentId: e.studentId } },
      create: { schoolId, examSubjectId: e.examSubjectId, studentId: e.studentId, ...data },
      update: data,
    });
    saved++;
  }
  if (toClear.length) {
    await tx.mark.deleteMany({ where: { OR: toClear.map((c) => ({ examSubjectId: c.examSubjectId, studentId: c.studentId })) } });
  }
  return { saved, cleared: toClear.length };
}
