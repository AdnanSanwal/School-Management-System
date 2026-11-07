import type { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import type { JwtPayload } from './jwt';

/**
 * Row-level scoping on top of tenant scoping. Tenant scoping keeps a user inside
 * their school; these helpers narrow TEACHER / PARENT / STUDENT further:
 *   TEACHER → students of sections they class-teach or teach a subject in
 *   PARENT  → their linked children only (spec: "never another student's data")
 *   STUDENT → themselves
 * Every other school role sees the whole school.
 */

const SCHOOL_WIDE_ROLES = new Set(['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT']);

export function isSchoolWide(user: Pick<JwtPayload, 'role'>) {
  return SCHOOL_WIDE_ROLES.has(user.role);
}

export async function currentAcademicYear() {
  const year = await prisma.academicYear.findFirst({ where: { isCurrent: true } });
  if (!year) throw new AppError('No current academic year configured for this school', 409);
  return year;
}

export async function staffForUser(userId: string) {
  return prisma.staff.findUnique({ where: { userId } });
}

/** Sections a teacher is responsible for in the current academic year. */
export async function teacherSectionIds(userId: string): Promise<string[]> {
  const staff = await staffForUser(userId);
  if (!staff) return [];
  const year = await prisma.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
  const [classTeacher, subjects] = await Promise.all([
    prisma.section.findMany({ where: { classTeacherId: staff.id }, select: { id: true } }),
    year
      ? prisma.subjectAssignment.findMany({
          where: { teacherId: staff.id, academicYearId: year.id },
          select: { sectionId: true },
        })
      : Promise.resolve([] as { sectionId: string }[]),
  ]);
  return [...new Set([...classTeacher.map((s) => s.id), ...subjects.map((s) => s.sectionId)])];
}

export async function guardianStudentIds(userId: string): Promise<string[]> {
  const links = await prisma.studentGuardian.findMany({
    where: { guardian: { userId } },
    select: { studentId: true },
  });
  return links.map((l) => l.studentId);
}

/** Prisma `where` that limits Student queries to what this user may see. */
export async function studentScope(user: JwtPayload): Promise<Prisma.StudentWhereInput> {
  if (isSchoolWide(user)) return {};
  switch (user.role) {
    case 'TEACHER':
      return { sectionId: { in: await teacherSectionIds(user.id) } };
    case 'PARENT':
      return { id: { in: await guardianStudentIds(user.id) } };
    case 'STUDENT':
      return { userId: user.id };
    default:
      return { id: { in: [] } };
  }
}

/** 404 (not 403) so callers can't probe which student IDs exist. */
export async function assertStudentAccess(user: JwtPayload, studentId: string) {
  const student = await prisma.student.findFirst({
    where: { AND: [{ id: studentId }, await studentScope(user)] },
    select: { id: true },
  });
  if (!student) throw new AppError('Student not found', 404);
}

export async function assertSectionAccess(user: JwtPayload, sectionId: string) {
  const section = await prisma.section.findFirst({ where: { id: sectionId }, select: { id: true } });
  if (!section) throw new AppError('Section not found', 404);
  if (isSchoolWide(user)) return;
  if (user.role === 'TEACHER' && (await teacherSectionIds(user.id)).includes(sectionId)) return;
  throw new AppError('Section not found', 404);
}

type FindById = { findFirst(args: { where: { id: string }; select: { id: true } }): Promise<unknown> };

/**
 * Checks that an ID from request input belongs to the current school before it
 * is used as a foreign key. Tenant scoping filters queries, but it cannot stop a
 * row in school A from *pointing at* a record of school B.
 */
export async function ensureInSchool(delegate: FindById, id: string | null | undefined, label: string) {
  if (!id) return;
  const found = await delegate.findFirst({ where: { id }, select: { id: true } });
  if (!found) throw new AppError(`${label} not found`, 404);
}
