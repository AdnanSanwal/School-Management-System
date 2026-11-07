import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { authenticate } from '../../middleware/auth';
import { authorize, hasPermission } from '../../middleware/rbac';
import { sendSuccess } from '../../utils/apiResponse';
import { handler, parseQuery, id, me } from '../../utils/http';
import { addDays, schoolToday, toIso } from '../../utils/dates';
import { assertStudentAccess, studentScope } from '../../utils/scope';
import { attendanceSummary } from '../../utils/attendanceStats';
import { signedUrl } from '../../utils/storage';
import { outstanding, D } from '../fees/fees.calc';
import { sectionResults } from '../exams/exams.service';

// Parent / student app home (spec §10 Parents Home Screen, §11 Student View).

const router = Router();
router.use(authenticate, authorize('PARENT', 'STUDENT'));

router.get('/children', handler(async (req, res) => {
  const kids = await prisma.student.findMany({
    where: { AND: [await studentScope(me(req)), { status: 'ACTIVE' }] },
    orderBy: { name: 'asc' },
    select: {
      id: true, name: true, admissionNo: true, rollNo: true, photoKey: true,
      section: { select: { id: true, name: true, class: { select: { name: true } }, classTeacher: { select: { name: true, phone: true } } } },
    },
  });
  return sendSuccess(res, kids.map(({ photoKey, ...k }) => ({ ...k, photo: signedUrl(photoKey) })));
}));

router.get('/home', handler(async (req, res) => {
  const { studentId } = parseQuery(z.object({ studentId: id }), req);
  const user = me(req);
  await assertStudentAccess(user, studentId);
  const today = await schoolToday();
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));

  const student = await prisma.student.findFirstOrThrow({
    where: { id: studentId },
    select: {
      id: true, name: true, admissionNo: true, photoKey: true, sectionId: true,
      section: { select: { name: true, class: { select: { name: true } }, classTeacher: { select: { name: true, phone: true } } } },
    },
  });

  const [todayMark, month, holidayToday, upcoming, latestDiary, openInvoices, lastPaid] = await Promise.all([
    prisma.studentAttendance.findUnique({ where: { studentId_date: { studentId, date: today } }, select: { status: true, remarks: true, createdAt: true } }),
    prisma.studentAttendance.groupBy({ by: ['status'], where: { studentId, date: { gte: monthStart } }, _count: true }),
    prisma.calendarEvent.findFirst({ where: { type: 'HOLIDAY', startDate: { lte: today }, endDate: { gte: today } }, select: { title: true } }),
    prisma.calendarEvent.findMany({
      where: { endDate: { gte: today }, startDate: { lte: addDays(today, 60) } },
      orderBy: { startDate: 'asc' }, take: 3, select: { id: true, title: true, type: true, startDate: true, endDate: true },
    }),
    student.sectionId
      ? prisma.diaryEntry.findFirst({
          where: { sectionId: student.sectionId }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          select: { id: true, date: true, title: true, content: true, isHomework: true, dueDate: true, createdAt: true, subject: { select: { name: true } }, teacher: { select: { name: true } } },
        })
      : null,
    hasPermission(user.role, 'fee.view')
      ? prisma.feeInvoice.findMany({ where: { studentId, status: { in: ['UNPAID', 'PARTIAL'] } }, orderBy: { dueDate: 'asc' } })
      : null,
    hasPermission(user.role, 'fee.view')
      ? prisma.feeInvoice.findFirst({ where: { studentId, status: 'PAID' }, orderBy: { period: 'desc' }, select: { period: true } })
      : null,
  ]);

  const unreadNotices = await prisma.notice.count({
    where: {
      publishedAt: { not: null },
      reads: { none: { userId: user.id } },
      OR: [
        { audience: { in: user.role === 'PARENT' ? ['ALL', 'PARENTS'] : ['ALL', 'STUDENTS'] } },
        ...(student.sectionId ? [{ audience: 'SECTIONS' as const, targets: { some: { sectionId: student.sectionId } } }] : []),
      ],
    },
  });

  let fees: Prisma.JsonObject | null = null;
  if (openInvoices) {
    const next = openInvoices[0];
    fees = {
      pending: openInvoices.reduce((s, i) => s.plus(outstanding(i)), D(0)).toString(),
      paidTill: lastPaid?.period ?? null,
      nextDue: next ? { period: next.period, amount: outstanding(next).toString(), dueDate: toIso(next.dueDate), overdue: next.dueDate < today } : null,
    };
  }

  return sendSuccess(res, {
    date: toIso(today),
    student: { ...student, photoKey: undefined, photo: signedUrl(student.photoKey) },
    today: {
      status: todayMark?.status ?? null,
      markedAt: todayMark?.createdAt ?? null,
      remarks: todayMark?.remarks ?? null,
      holiday: holidayToday?.title ?? null,
    },
    attendanceThisMonth: attendanceSummary(month),
    fees,
    latestDiary: latestDiary ? { ...latestDiary, date: toIso(latestDiary.date), dueDate: latestDiary.dueDate ? toIso(latestDiary.dueDate) : null } : null,
    upcoming: upcoming.map((e) => ({ ...e, startDate: toIso(e.startDate), endDate: toIso(e.endDate) })),
    unreadNotices,
  });
}));

// Spec §10 Exam Schedule + Progress Report: upcoming papers for the child's class and published results.
router.get('/exams', handler(async (req, res) => {
  const { studentId } = parseQuery(z.object({ studentId: id }), req);
  await assertStudentAccess(me(req), studentId);
  const student = await prisma.student.findFirstOrThrow({ where: { id: studentId }, select: { sectionId: true, section: { select: { classId: true } } } });
  if (!student.section) return sendSuccess(res, []);
  const exams = await prisma.exam.findMany({
    where: { status: { in: ['SCHEDULED', 'PUBLISHED'] }, subjects: { some: { classId: student.section.classId } } },
    orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    include: {
      subjects: {
        where: { classId: student.section.classId },
        orderBy: { date: 'asc' },
        select: { id: true, date: true, totalMarks: true, syllabus: true, subject: { select: { name: true } } },
      },
    },
  });
  const published = await Promise.all(exams.filter((e) => e.status === 'PUBLISHED')
    .map(async (e) => [e.id, (await sectionResults(e.id, student.sectionId!)).students.find((s) => s.student.id === studentId)] as const));
  const resultOf = new Map(published);
  return sendSuccess(res, exams.map((e) => {
    const r = resultOf.get(e.id);
    return {
      id: e.id, name: e.name, status: e.status,
      startDate: e.startDate ? toIso(e.startDate) : null, endDate: e.endDate ? toIso(e.endDate) : null,
      papers: e.subjects.map((p) => ({ id: p.id, subject: p.subject.name, date: p.date ? toIso(p.date) : null, totalMarks: Number(p.totalMarks), syllabus: p.syllabus })),
      result: r ? {
        percent: r.percent, grade: r.grade, passed: r.passed, position: r.position, obtained: r.obtained, maxMarks: r.maxMarks,
        subjects: r.subjects.map((s) => ({ subject: s.subject, obtained: s.obtained, totalMarks: s.totalMarks, isAbsent: s.isAbsent, grade: s.grade, passed: s.passed })),
      } : null,
    };
  }));
}));

export default router;
