import { Router } from 'express';
import { z } from 'zod';
import { PromotionOutcome } from '@prisma/client';
import prisma, { transaction } from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { authenticate } from '../../middleware/auth';
import { can } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { handler, parseBody, parseQuery, id, me } from '../../utils/http';
import { toIso } from '../../utils/dates';
import { currentAcademicYear } from '../../utils/scope';
import { sectionResults } from '../exams/exams.service';

// Year-end promotion (spec §6 Students → Promote/Transfer; §16 Settings → Academic year).
// Preview: every active student moves to the next class by level (same section name when
// it exists), top class graduates, and — if a final exam is given — students who failed
// it are suggested to repeat. The office adjusts, then runs it once per student per year.

const router = Router();
router.use(authenticate, can('promotion.run'));

async function nextYear(toAcademicYearId: string) {
  const [from, to] = await Promise.all([
    currentAcademicYear(),
    prisma.academicYear.findFirst({ where: { id: toAcademicYearId } }),
  ]);
  if (!to) throw new AppError('Target academic year not found', 404);
  if (to.id === from.id) throw new AppError('Choose the new academic year, not the current one', 422);
  if (to.startDate <= from.startDate) throw new AppError('The new academic year must start after the current one', 422);
  return { from, to };
}

router.get('/preview', handler(async (req, res) => {
  const q = parseQuery(z.object({ toAcademicYearId: id, examId: id.optional() }), req);
  const { from, to } = await nextYear(q.toAcademicYearId);

  const [classes, students, done] = await Promise.all([
    prisma.class.findMany({ orderBy: { level: 'asc' }, include: { sections: { orderBy: { name: 'asc' }, select: { id: true, name: true } } } }),
    prisma.student.findMany({
      where: { status: 'ACTIVE', sectionId: { not: null } },
      select: { id: true, name: true, admissionNo: true, rollNo: true, sectionId: true },
      orderBy: [{ rollNo: 'asc' }, { name: 'asc' }],
    }),
    prisma.promotionRecord.findMany({ where: { toAcademicYearId: to.id }, select: { studentId: true } }),
  ]);
  const already = new Set(done.map((d) => d.studentId));

  // Optional: suggest repeating the class for students who failed the chosen exam.
  const failed = new Map<string, number | null>();
  if (q.examId) {
    const sectionIds = [...new Set(students.map((s) => s.sectionId!))];
    for (const sid of sectionIds) {
      try {
        const r = await sectionResults(q.examId, sid);
        for (const st of r.students) if (st.passed === false) failed.set(st.student.id, st.percent);
      } catch { /* section not in this exam */ }
    }
  }

  const sectionClass = new Map(classes.flatMap((c) => c.sections.map((s) => [s.id, c] as const)));
  const groups = classes.map((cls, i) => {
    const next = classes[i + 1] ?? null;
    const mine = students.filter((s) => sectionClass.get(s.sectionId!)?.id === cls.id && !already.has(s.id));
    return {
      class: { id: cls.id, name: cls.name },
      nextClass: next ? { id: next.id, name: next.name, sections: next.sections } : null,
      sections: cls.sections,
      students: mine.map((s) => {
        const fromSection = cls.sections.find((x) => x.id === s.sectionId)!;
        const sameName = next?.sections.find((x) => x.name === fromSection.name) ?? next?.sections[0] ?? null;
        const outcome: PromotionOutcome = failed.has(s.id) ? 'RETAINED' : next ? 'PROMOTED' : 'GRADUATED';
        return {
          id: s.id, name: s.name, admissionNo: s.admissionNo, rollNo: s.rollNo,
          section: fromSection.name, outcome,
          toSectionId: outcome === 'RETAINED' ? s.sectionId : outcome === 'PROMOTED' ? sameName?.id ?? null : null,
          failedPercent: failed.get(s.id) ?? null,
        };
      }),
    };
  }).filter((g) => g.students.length);

  return sendSuccess(res, {
    from: { id: from.id, name: from.name }, to: { id: to.id, name: to.name, startDate: toIso(to.startDate) },
    alreadyPromoted: already.size, classes: groups,
  });
}));

router.post('/run', handler(async (req, res) => {
  const b = parseBody(z.object({
    toAcademicYearId: id,
    makeCurrent: z.boolean().default(true),
    copyTeachers: z.boolean().default(true),
    copyFeeStructure: z.boolean().default(true),
    decisions: z.array(z.object({
      studentId: id,
      outcome: z.nativeEnum(PromotionOutcome),
      toSectionId: id.nullable().optional(),
    })).min(1).max(5000),
  }), req);
  const { from, to } = await nextYear(b.toAcademicYearId);
  const ids = b.decisions.map((d) => d.studentId);
  if (new Set(ids).size !== ids.length) throw new AppError('A student appears twice', 422);

  const [students, sections, done] = await Promise.all([
    prisma.student.findMany({ where: { id: { in: ids }, status: 'ACTIVE' }, select: { id: true, sectionId: true } }),
    prisma.section.findMany({ select: { id: true } }),
    prisma.promotionRecord.findMany({ where: { toAcademicYearId: to.id, studentId: { in: ids } }, select: { studentId: true } }),
  ]);
  if (students.length !== ids.length) throw new AppError('Some students are not active', 422);
  if (done.length) throw new AppError(`${done.length} student(s) were already promoted into ${to.name}`, 409);
  const validSection = new Set(sections.map((s) => s.id));
  for (const d of b.decisions) {
    if ((d.outcome === 'PROMOTED' || d.outcome === 'RETAINED') && !(d.toSectionId ?? (d.outcome === 'RETAINED' && students.find((s) => s.id === d.studentId)?.sectionId))) {
      throw new AppError('Every promoted student needs a class/section for next year', 422);
    }
    if (d.toSectionId && !validSection.has(d.toSectionId)) throw new AppError('Unknown section', 422);
  }

  const schoolId = currentSchoolId();
  const user = me(req);
  const before = new Map(students.map((s) => [s.id, s.sectionId]));
  const counts: Record<string, number> = {};
  // Chunks keep each transaction short on large schools.
  for (let i = 0; i < b.decisions.length; i += 100) {
    const chunk = b.decisions.slice(i, i + 100);
    await transaction(async (tx) => {
      for (const d of chunk) {
        const fromSectionId = before.get(d.studentId) ?? null;
        const toSectionId = d.outcome === 'RETAINED' ? d.toSectionId ?? fromSectionId : d.outcome === 'PROMOTED' ? d.toSectionId! : null;
        if (d.outcome === 'PROMOTED' || d.outcome === 'RETAINED') {
          await tx.student.update({ where: { id: d.studentId }, data: { sectionId: toSectionId } });
        } else {
          await tx.student.update({
            where: { id: d.studentId },
            data: { status: d.outcome === 'GRADUATED' ? 'GRADUATED' : 'LEFT', leftOn: to.startDate, leftReason: d.outcome === 'GRADUATED' ? `Graduated ${from.name}` : null },
          });
        }
        await tx.promotionRecord.create({
          data: { schoolId, studentId: d.studentId, fromAcademicYearId: from.id, toAcademicYearId: to.id, fromSectionId, toSectionId, outcome: d.outcome, createdById: user.id },
        });
        counts[d.outcome] = (counts[d.outcome] ?? 0) + 1;
      }
    });
  }

  // Carry this year's set-up into the new one (only where the new year is still empty).
  let teachersCopied = 0;
  let feesCopied = 0;
  if (b.copyTeachers && !(await prisma.subjectAssignment.count({ where: { academicYearId: to.id } }))) {
    const rows = await prisma.subjectAssignment.findMany({ where: { academicYearId: from.id } });
    if (rows.length) {
      teachersCopied = (await prisma.subjectAssignment.createMany({
        data: rows.map((r) => ({ schoolId, academicYearId: to.id, sectionId: r.sectionId, subjectId: r.subjectId, teacherId: r.teacherId })),
      })).count;
    }
  }
  if (b.copyFeeStructure && !(await prisma.feeStructure.count({ where: { academicYearId: to.id } }))) {
    const rows = await prisma.feeStructure.findMany({ where: { academicYearId: from.id } });
    if (rows.length) {
      feesCopied = (await prisma.feeStructure.createMany({
        data: rows.map((r) => ({ schoolId, academicYearId: to.id, classId: r.classId, feeHeadId: r.feeHeadId, amount: r.amount })),
      })).count;
    }
  }
  if (b.makeCurrent) {
    await transaction(async (tx) => {
      await tx.academicYear.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
      await tx.academicYear.update({ where: { id: to.id }, data: { isCurrent: true } });
    });
  }
  return sendSuccess(res, {
    to: to.name, counts, teachersCopied, feesCopied, currentYear: b.makeCurrent ? to.name : from.name,
  }, `Promotion done: ${Object.entries(counts).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ')}`);
}));

router.get('/history', handler(async (req, res) => {
  const q = parseQuery(z.object({ toAcademicYearId: id.optional() }), req);
  const rows = await prisma.promotionRecord.findMany({
    where: q.toAcademicYearId ? { toAcademicYearId: q.toAcademicYearId } : {},
    orderBy: { createdAt: 'desc' }, take: 500,
    include: { student: { select: { name: true, admissionNo: true } } },
  });
  return sendSuccess(res, rows);
}));

export default router;
