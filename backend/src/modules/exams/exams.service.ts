import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { hasPermission } from '../../middleware/rbac';
import { attendanceSummary } from '../../utils/attendanceStats';
import { staffForUser } from '../../utils/scope';
import { signedUrl } from '../../utils/storage';
import type { JwtPayload } from '../../utils/jwt';
import { GradeBand, rank, studentResult } from './exams.calc';

export async function gradeScale(): Promise<GradeBand[]> {
  const rows = await prisma.gradeScale.findMany({ orderBy: { minPercent: 'desc' } });
  return rows.map((r) => ({ grade: r.grade, minPercent: Number(r.minPercent), maxPercent: Number(r.maxPercent), remark: r.remark }));
}

export async function loadExam(examId: string) {
  const exam = await prisma.exam.findFirst({ where: { id: examId }, include: { academicYear: { select: { id: true, name: true, startDate: true } } } });
  if (!exam) throw new AppError('Exam not found', 404);
  return exam;
}

/**
 * Who may enter marks for one subject in one section:
 * exam managers (principal/office) always; a teacher only for a subject they
 * are assigned to teach in that section this year.
 */
export async function assertCanEnterMarks(user: JwtPayload, sectionId: string, subjectId: string, academicYearId: string) {
  if (hasPermission(user.role, 'exam.manage')) return;
  if (!hasPermission(user.role, 'marks.enter')) throw new AppError('Forbidden: insufficient permissions', 403);
  const staff = await staffForUser(user.id);
  const assigned = staff && await prisma.subjectAssignment.findFirst({
    where: { sectionId, subjectId, teacherId: staff.id, academicYearId }, select: { id: true },
  });
  if (!assigned) throw new AppError('You do not teach this subject in this section', 403);
}

/** Results for every active student of a section, with positions. */
export async function sectionResults(examId: string, sectionId: string) {
  const section = await prisma.section.findFirst({
    where: { id: sectionId },
    select: { id: true, name: true, classId: true, class: { select: { name: true } }, classTeacher: { select: { name: true } } },
  });
  if (!section) throw new AppError('Section not found', 404);
  const [subjects, students, scale] = await Promise.all([
    prisma.examSubject.findMany({
      where: { examId, classId: section.classId },
      include: { subject: { select: { id: true, name: true } } },
      orderBy: [{ date: 'asc' }, { subject: { name: 'asc' } }],
    }),
    prisma.student.findMany({
      where: { sectionId, status: 'ACTIVE' },
      select: { id: true, name: true, admissionNo: true, rollNo: true },
      orderBy: [{ rollNo: 'asc' }, { name: 'asc' }],
    }),
    gradeScale(),
  ]);
  const marks = await prisma.mark.findMany({
    where: { examSubjectId: { in: subjects.map((s) => s.id) }, studentId: { in: students.map((s) => s.id) } },
  });
  const byKey = new Map(marks.map((m) => [`${m.studentId}:${m.examSubjectId}`, m]));

  const rows = students.map((st) => {
    const r = studentResult(subjects.map((es) => {
      const m = byKey.get(`${st.id}:${es.id}`);
      return {
        examSubjectId: es.id, subject: es.subject.name,
        totalMarks: Number(es.totalMarks), passingMarks: Number(es.passingMarks),
        obtained: m?.obtained != null ? Number(m.obtained) : null, isAbsent: m?.isAbsent ?? false,
      };
    }), scale);
    return { student: st, ...r };
  });
  return {
    section: { id: section.id, name: `${section.class.name}-${section.name}`, classTeacher: section.classTeacher?.name ?? null },
    subjects: subjects.map((s) => ({ id: s.id, subjectId: s.subjectId, name: s.subject.name, totalMarks: Number(s.totalMarks), passingMarks: Number(s.passingMarks), date: s.date })),
    students: rank(rows),
    scale,
  };
}

export async function reportCard(examId: string, studentId: string) {
  const exam = await loadExam(examId);
  const student = await prisma.student.findFirst({
    where: { id: studentId },
    select: {
      id: true, name: true, admissionNo: true, rollNo: true, dateOfBirth: true, photoKey: true, sectionId: true,
      guardians: { where: { isPrimary: true }, select: { guardian: { select: { name: true } } } },
    },
  });
  if (!student) throw new AppError('Student not found', 404);
  if (!student.sectionId) throw new AppError('Student has no class', 409);

  const results = await sectionResults(examId, student.sectionId);
  const me = results.students.find((r) => r.student.id === studentId);
  if (!me) throw new AppError('Student is not active in a section for this exam', 409);

  const [remark, attendance, school] = await Promise.all([
    prisma.examRemark.findUnique({ where: { examId_studentId: { examId, studentId } }, select: { remarks: true } }),
    prisma.studentAttendance.groupBy({
      by: ['status'],
      where: { studentId, date: { gte: exam.academicYear.startDate, ...(exam.endDate ? { lte: exam.endDate } : {}) } },
      _count: true,
    }),
    prisma.school.findUniqueOrThrow({ where: { id: exam.schoolId }, select: { name: true, address: true, phone: true } }),
  ]);
  const ranked = results.students.filter((r) => r.position !== null);

  return {
    school,
    exam: { id: exam.id, name: exam.name, academicYear: exam.academicYear.name, status: exam.status, publishedAt: exam.publishedAt },
    student: {
      id: student.id, name: student.name, admissionNo: student.admissionNo, rollNo: student.rollNo,
      dateOfBirth: student.dateOfBirth, guardian: student.guardians[0]?.guardian.name ?? null, photo: signedUrl(student.photoKey),
    },
    section: results.section,
    result: me,
    classSize: results.students.length,
    rankedCount: ranked.length,
    classAverage: ranked.length ? Math.round((ranked.reduce((n, r) => n + r.percent!, 0) / ranked.length) * 100) / 100 : null,
    remarks: remark?.remarks ?? null,
    attendance: attendanceSummary(attendance),
    scale: results.scale,
  };
}

export type ReportCard = Awaited<ReturnType<typeof reportCard>>;
