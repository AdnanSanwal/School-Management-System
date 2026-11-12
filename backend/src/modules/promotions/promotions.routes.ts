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
import { basePrisma } from '../../config/database';
import { audit } from '../../utils/audit';

// Year-end promotion (spec §6; client change request 05).
// The office picks the current and the next academic year and a destination for each class
// (by default the next class by level; the top class graduates). Preview lists the eligible
// students class by class — same section name when it exists, and students who failed a chosen
// exam are suggested to repeat. They can be promoted all at once or a class / a few at a time;
// a student is promoted only once into a year (PromotionRecord), and every move is logged.

const router = Router();
router.use(authenticate, can('promotion.run'));

async function nextYear(toAcademicYearId: string, fromAcademicYearId?: string) {
  const [from, to] = await Promise.all([
    fromAcademicYearId ? prisma.academicYear.findFirst({ where: { id: fromAcademicYearId } }) : currentAcademicYear(),
    prisma.academicYear.findFirst({ where: { id: toAcademicYearId } }),
  ]);
  if (!from) throw new AppError('Current academic year not found', 404);
  if (!to) throw new AppError('Next academic year not found', 404);
  if (to.id === from.id) throw new AppError('Choose a new academic year to promote into, not the same one', 422);
  if (to.startDate <= from.startDate) throw new AppError('The next academic year must start after the current one', 422);
  return { from, to };
}

const GRADUATE = 'GRADUATE';
/** Class → destination class id (or GRADUATE). Missing classes use the next class by level. */
const mappingParam = z.string().max(20_000).optional().transform((v, ctx) => {
  if (!v) return {} as Record<string, string>;
  try {
    const o = JSON.parse(v);
    if (o && typeof o === 'object' && !Array.isArray(o) && Object.values(o).every((x) => typeof x === 'string')) return o as Record<string, string>;
  } catch { /* fall through */ }
  ctx.addIssue({ code: 'custom', message: 'Invalid class mapping' });
  return z.NEVER;
});

router.get('/preview', handler(async (req, res) => {
  const q = parseQuery(z.object({ toAcademicYearId: id, fromAcademicYearId: id.optional(), examId: id.optional(), mapping: mappingParam }), req);
  const { from, to } = await nextYear(q.toAcademicYearId, q.fromAcademicYearId);

  const [classes, students, done] = await Promise.all([
    prisma.class.findMany({ where: { archivedAt: null }, orderBy: { level: 'asc' }, include: { sections: { orderBy: { name: 'asc' }, select: { id: true, name: true } } } }),
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
  const byId = new Map(classes.map((c) => [c.id, c]));
  // The class-to-class mapping in force: the office's choice, else the next class by level.
  const mapping: Record<string, string> = {};
  classes.forEach((cls, i) => {
    const chosen = q.mapping[cls.id];
    if (chosen && chosen !== GRADUATE && !byId.has(chosen)) throw new AppError(`Unknown destination class for ${cls.name}`, 422);
    mapping[cls.id] = chosen ?? classes[i + 1]?.id ?? GRADUATE;
  });
  const groups = classes.map((cls) => {
    const next = mapping[cls.id] === GRADUATE ? null : byId.get(mapping[cls.id]) ?? null;
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
    alreadyPromoted: already.size, classes: groups, mapping,
    // Every class, for the mapping table (with how many students wait in each).
    allClasses: classes.map((c) => ({ id: c.id, name: c.name, level: c.level, waiting: groups.find((g) => g.class.id === c.id)?.students.length ?? 0 })),
  });
}));

router.post('/run', handler(async (req, res) => {
  const b = parseBody(z.object({
    toAcademicYearId: id,
    fromAcademicYearId: id.optional(),
    makeCurrent: z.boolean().default(true),
    copyTeachers: z.boolean().default(true),
    copyFeeStructure: z.boolean().default(true),
    decisions: z.array(z.object({
      studentId: id,
      outcome: z.nativeEnum(PromotionOutcome),
      toSectionId: id.nullable().optional(),
    })).min(1).max(5000),
  }), req);
  const { from, to } = await nextYear(b.toAcademicYearId, b.fromAcademicYearId);
  const ids = b.decisions.map((d) => d.studentId);
  if (new Set(ids).size !== ids.length) throw new AppError('A student appears twice', 422);

  const [students, sections, done] = await Promise.all([
    prisma.student.findMany({ where: { id: { in: ids }, status: 'ACTIVE' }, select: { id: true, sectionId: true } }),
    prisma.section.findMany({ where: { class: { archivedAt: null } }, select: { id: true, name: true, class: { select: { name: true } } } }),
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
  const label = new Map(sections.map((s) => [s.id, `${s.class.name}-${s.name}`]));
  const OUTCOME_ACTION: Record<string, string> = { PROMOTED: 'Promoted', RETAINED: 'Kept in class', GRADUATED: 'Graduated', LEFT: 'Left at year end' };
  const logRows: { action: string; studentId: string; meta: Record<string, unknown> }[] = [];
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
        logRows.push({
          action: OUTCOME_ACTION[d.outcome], studentId: d.studentId,
          meta: { fromClass: fromSectionId ? label.get(fromSectionId) ?? null : null, toClass: toSectionId ? label.get(toSectionId) ?? null : null, fromYear: from.name, toYear: to.name, outcome: d.outcome },
        });
      }
    });
  }
  // Activity log: one entry per student (shown on their profile), plus the run itself.
  await basePrisma.auditLog.createMany({
    data: logRows.map((r) => ({ schoolId, userId: user.id, action: r.action, entity: 'students', entityId: r.studentId, meta: r.meta as object, ipAddress: req.ip ?? null })),
  });
  await audit(req, { action: 'Year-end promotion run', entity: 'promotions', meta: { fromYear: from.name, toYear: to.name, counts, students: logRows.length } });

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
