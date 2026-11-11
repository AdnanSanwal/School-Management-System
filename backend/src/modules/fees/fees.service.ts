import { Prisma, FeeFrequency } from '@prisma/client';
import prisma, { transaction } from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { AppError } from '../../middleware/errorHandler';
import { formatNumber, nextNumber } from '../../utils/counter';
import { addDays, periodRange, schoolTimezone, schoolToday, toDate, toIso, zonedDayStart } from '../../utils/dates';
import { guardiansOf, notifyEach } from '../../utils/notify';
import { messageFamilies } from '../../utils/messaging';
import { currentAcademicYear } from '../../utils/scope';
import { accountForMethod } from '../../utils/finance';
import { allocate, applyConcessions, outstanding, totals, D } from './fees.calc';

export interface GenerateOptions {
  period: string; // YYYY-MM
  classIds?: string[];
  studentIds?: string[];
  dueDay: number;
  frequencies: FeeFrequency[]; // which heads to bill this run
}

/**
 * Creates one invoice per active student for the period, from the class fee
 * structure and the student's approved concessions. Students that already have
 * an invoice for the period are skipped, so re-running is safe.
 */
/** Fee head for students' own monthly fee; created on first use, hidden from the class grid. */
export const STUDENT_MONTHLY_FEE_HEAD = 'Monthly Fee';
export async function studentMonthlyFeeHead() {
  const existing = await prisma.feeHead.findFirst({ where: { name: STUDENT_MONTHLY_FEE_HEAD } });
  return existing ?? prisma.feeHead.create({ data: { schoolId: currentSchoolId(), name: STUDENT_MONTHLY_FEE_HEAD, frequency: 'MONTHLY' } });
}

export async function generateInvoices(opts: GenerateOptions) {
  const schoolId = currentSchoolId();
  const year = await currentAcademicYear();
  const { start, end } = periodRange(opts.period);
  if (end < year.startDate || start > year.endDate) {
    throw new AppError(`${opts.period} is outside the current academic year ${year.name}`, 422);
  }
  const dueDate = toDate(`${opts.period}-${String(Math.min(opts.dueDay, end.getUTCDate())).padStart(2, '0')}`);

  const students = await prisma.student.findMany({
    where: {
      status: 'ACTIVE',
      sectionId: { not: null },
      ...(opts.classIds?.length ? { section: { classId: { in: opts.classIds } } } : {}),
      ...(opts.studentIds?.length ? { id: { in: opts.studentIds } } : {}),
      invoices: { none: { period: opts.period } },
    },
    select: { id: true, monthlyFee: true, section: { select: { classId: true } }, transport: { select: { route: { select: { monthlyFee: true, isActive: true } } } } },
  });
  const skipped = await prisma.feeInvoice.count({
    where: {
      period: opts.period,
      ...(opts.classIds?.length ? { student: { section: { classId: { in: opts.classIds } } } } : {}),
      ...(opts.studentIds?.length ? { studentId: { in: opts.studentIds } } : {}),
    },
  });

  // Monthly runs also bill transport for students on a school route.
  const transportHeadId = opts.frequencies.includes('MONTHLY')
    ? (await prisma.feeHead.findFirst({ where: { name: 'Transport' }, select: { id: true } }))?.id ?? null
    : null;
  const [structures, concessions] = await Promise.all([
    prisma.feeStructure.findMany({
      where: { academicYearId: year.id, feeHead: { isActive: true, frequency: { in: opts.frequencies } } },
      orderBy: { feeHead: { name: 'asc' } },
      include: { feeHead: { select: { frequency: true } } },
    }),
    prisma.concession.findMany({
      where: {
        studentId: { in: students.map((s) => s.id) },
        status: 'APPROVED',
        validFrom: { lte: end },
        OR: [{ validTo: null }, { validTo: { gte: start } }],
      },
    }),
  ]);

  // Students with their own monthly fee (CR-04) are billed it under one "Monthly Fee" head.
  const monthlyRun = opts.frequencies.includes('MONTHLY');
  const ownFeeHeadId = monthlyRun && students.some((s) => s.monthlyFee !== null) ? (await studentMonthlyFeeHead()).id : null;

  const today = await schoolToday();
  let created = 0;
  let billed = D(0);
  const noStructure = new Set<string>();
  for (const s of students) {
    const classId = s.section!.classId;
    // Transport is billed from the student's route, never from the class structure.
    const ownFee = s.monthlyFee !== null && ownFeeHeadId ? s.monthlyFee : null;
    const lines = structures
      .filter((f) => f.classId === classId && f.feeHeadId !== transportHeadId && f.feeHeadId !== ownFeeHeadId)
      // The student's own monthly fee replaces every monthly head of their class.
      .filter((f) => ownFee === null || f.feeHead.frequency !== 'MONTHLY')
      .map((f) => ({ feeHeadId: f.feeHeadId, amount: f.amount }));
    if (ownFee !== null && D(ownFee).gt(0)) lines.unshift({ feeHeadId: ownFeeHeadId!, amount: ownFee });
    const route = s.transport?.route;
    if (transportHeadId && route?.isActive && D(route.monthlyFee).gt(0)) lines.push({ feeHeadId: transportHeadId, amount: route.monthlyFee });
    if (!lines.length) { noStructure.add(classId); continue; }
    const items = applyConcessions(lines, concessions.filter((c) => c.studentId === s.id));
    const t = totals(items);
    await transaction(async (tx) => {
      const n = await nextNumber(tx, 'invoice');
      const inv = await tx.feeInvoice.create({
        data: {
          schoolId, studentId: s.id, academicYearId: year.id, invoiceNo: formatNumber('INV', n),
          period: opts.period, issueDate: today, dueDate,
          grossAmount: t.gross, discountAmount: t.discount, netAmount: t.net,
          status: t.net.lte(0) ? 'PAID' : 'UNPAID',
        },
      });
      await tx.feeInvoiceItem.createMany({
        data: items.map((i) => ({ schoolId, invoiceId: inv.id, feeHeadId: i.feeHeadId, amount: i.amount, discount: i.discount })),
      });
    });
    created++;
    billed = billed.plus(t.net);
  }
  return { period: opts.period, created, skipped, totalBilled: billed, classesWithoutFeeStructure: [...noStructure] };
}

export interface CollectInput {
  studentId: string;
  amount: number;
  method: Prisma.PaymentCreateInput['method'];
  reference?: string;
  remarks?: string;
  invoiceIds?: string[];
  collectedById?: string; // null for online/gateway payments
}

/**
 * Records a payment and settles open invoices oldest-due first (or only the
 * chosen ones). Uses optimistic checks on each invoice's paidAmount so two
 * cashiers collecting for the same student at once cannot double-settle.
 */
export async function collectPayment(input: CollectInput) {
  const schoolId = currentSchoolId();
  return transaction(async (tx) => {
    const student = await tx.student.findFirst({ where: { id: input.studentId }, select: { id: true } });
    if (!student) throw new AppError('Student not found', 404);

    const open = await tx.feeInvoice.findMany({
      where: {
        studentId: input.studentId,
        status: { in: ['UNPAID', 'PARTIAL'] },
        ...(input.invoiceIds?.length ? { id: { in: input.invoiceIds } } : {}),
      },
      orderBy: [{ dueDate: 'asc' }, { invoiceNo: 'asc' }],
    });
    if (input.invoiceIds?.length && open.length !== input.invoiceIds.length) {
      throw new AppError('Some selected invoices are not open for this student', 422);
    }
    if (!open.length) throw new AppError('This student has no pending fee', 422);

    let parts;
    try {
      parts = allocate(input.amount, open);
    } catch (e) {
      throw new AppError((e as Error).message, 422);
    }

    const receiptNo = formatNumber('RCP', await nextNumber(tx, 'receipt'));
    const payment = await tx.payment.create({
      data: {
        schoolId, studentId: input.studentId, receiptNo, amount: D(input.amount), method: input.method,
        reference: input.reference, remarks: input.remarks, collectedById: input.collectedById,
        accountId: await accountForMethod(tx, input.method),
      },
    });
    for (const p of parts) {
      const inv = open.find((i) => i.id === p.invoiceId)!;
      const newPaid = D(inv.paidAmount).plus(p.amount);
      const { count } = await tx.feeInvoice.updateMany({
        where: { id: inv.id, paidAmount: inv.paidAmount }, // optimistic lock
        data: { paidAmount: newPaid, status: p.settles ? 'PAID' : 'PARTIAL' },
      });
      if (!count) throw new AppError('This fee was updated by someone else just now; please retry', 409);
      await tx.paymentAllocation.create({ data: { schoolId, paymentId: payment.id, invoiceId: inv.id, amount: p.amount } });
    }
    return { payment, allocations: parts.map((p) => ({ ...p, period: open.find((i) => i.id === p.invoiceId)!.period })) };
  });
}

export async function receipt(paymentId: string, where: Prisma.StudentWhereInput) {
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, student: where },
    include: {
      student: { select: { id: true, name: true, admissionNo: true, section: { select: { name: true, class: { select: { name: true } } } } } },
      allocations: {
        include: {
          invoice: {
            select: {
              invoiceNo: true, period: true, netAmount: true, paidAmount: true, status: true,
              items: { select: { amount: true, discount: true, feeHead: { select: { name: true } } } },
            },
          },
        },
      },
    },
  });
  if (!payment) throw new AppError('Receipt not found', 404);
  const school = await prisma.school.findUniqueOrThrow({
    where: { id: currentSchoolId() },
    select: { name: true, address: true, phone: true, logoUrl: true, currency: true },
  });
  const collector = payment.collectedById
    ? await prisma.user.findFirst({ where: { id: payment.collectedById }, select: { name: true } })
    : null;
  const balance = await prisma.feeInvoice.findMany({
    where: { studentId: payment.studentId, status: { in: ['UNPAID', 'PARTIAL'] } },
    select: { id: true, netAmount: true, fineAmount: true, paidAmount: true },
  });
  return {
    school, ...payment, collectedBy: collector?.name ?? null,
    remainingBalance: balance.reduce((s, i) => s.plus(outstanding(i)), D(0)),
  };
}

export async function defaulters(opts: { classId?: string; minDaysOverdue: number }) {
  const today = await schoolToday();
  const cutoff = new Date(today.getTime() - opts.minDaysOverdue * 86_400_000);
  const invoices = await prisma.feeInvoice.findMany({
    where: {
      status: { in: ['UNPAID', 'PARTIAL'] },
      dueDate: { lt: cutoff },
      student: { status: 'ACTIVE', ...(opts.classId ? { section: { classId: opts.classId } } : {}) },
    },
    select: {
      id: true, netAmount: true, fineAmount: true, paidAmount: true, dueDate: true, period: true,
      student: {
        select: {
          id: true, name: true, admissionNo: true,
          section: { select: { name: true, class: { select: { name: true, level: true } } } },
          guardians: { where: { isPrimary: true }, select: { guardian: { select: { name: true, phone: true } } } },
        },
      },
    },
  });
  const byStudent = new Map<string, {
    student: (typeof invoices)[number]['student']; pending: Prisma.Decimal; months: string[]; oldestDue: Date;
  }>();
  for (const inv of invoices) {
    const row = byStudent.get(inv.student.id) ?? { student: inv.student, pending: D(0), months: [], oldestDue: inv.dueDate };
    row.pending = row.pending.plus(outstanding(inv));
    row.months.push(inv.period);
    if (inv.dueDate < row.oldestDue) row.oldestDue = inv.dueDate;
    byStudent.set(inv.student.id, row);
  }
  return [...byStudent.values()]
    .map(({ student, pending, months, oldestDue }) => ({
      studentId: student.id, name: student.name, admissionNo: student.admissionNo,
      section: student.section ? `${student.section.class.name}-${student.section.name}` : null,
      guardian: student.guardians[0]?.guardian ?? null,
      pending, months: months.sort(), oldestDue,
      daysOverdue: Math.floor((today.getTime() - oldestDue.getTime()) / 86_400_000),
    }))
    .sort((a, b) => b.pending.comparedTo(a.pending));
}

/** Fee due / overdue reminders — at most one per parent per child per school day. */
export async function sendFeeReminders(body: { daysAhead: number; classId?: string }) {
  const today = await schoolToday();
  const invoices = await prisma.feeInvoice.findMany({
    where: {
      status: { in: ['UNPAID', 'PARTIAL'] },
      dueDate: { lte: addDays(today, body.daysAhead) },
      student: { status: 'ACTIVE', ...(body.classId ? { section: { classId: body.classId } } : {}) },
    },
    select: { studentId: true, netAmount: true, fineAmount: true, paidAmount: true, dueDate: true },
  });
  const byStudent = new Map<string, { due: Prisma.Decimal; earliest: Date }>();
  for (const i of invoices) {
    const row = byStudent.get(i.studentId) ?? { due: D(0), earliest: i.dueDate };
    row.due = row.due.plus(D(i.netAmount).plus(i.fineAmount).minus(i.paidAmount));
    if (i.dueDate < row.earliest) row.earliest = i.dueDate;
    byStudent.set(i.studentId, row);
  }
  const parents = await guardiansOf([...byStudent.keys()]);

  // At most one reminder per parent per child per day.
  const tz = await schoolTimezone();
  const already = await prisma.notification.findMany({
    where: { type: 'FEE_DUE', userId: { in: parents.map((p) => p.userId) }, createdAt: { gte: zonedDayStart(toIso(today), tz) } },
    select: { userId: true, data: true },
  });
  const sent = new Set(already.map((n) => `${n.userId}:${(n.data as { studentId?: string } | null)?.studentId}`));
  const school = await prisma.school.findUniqueOrThrow({ where: { id: currentSchoolId() }, select: { currency: true } });
  const fresh = parents.filter((p) => !sent.has(`${p.userId}:${p.studentId}`));

  const notified = await notifyEach(fresh.map((p) => {
    const r = byStudent.get(p.studentId)!;
    const overdue = r.earliest < today;
    return {
      userId: p.userId, type: 'FEE_DUE' as const,
      title: overdue ? `Fee overdue for ${p.studentName}` : `Fee due for ${p.studentName}`,
      body: `${school.currency} ${r.due.toFixed(0)} ${overdue ? 'was due on' : 'is due by'} ${toIso(r.earliest)}.`,
      data: { studentId: p.studentId },
    };
  }));
  // WhatsApp/SMS reaches families without the app too (at most once a day per phone).
  const names = await prisma.student.findMany({ where: { id: { in: [...byStudent.keys()] } }, select: { id: true, name: true } });
  const texted = await messageFamilies('FEE_DUE', names.map((n) => {
    const r = byStudent.get(n.id)!;
    return { studentId: n.id, body: `Fee of ${school.currency} ${r.due.toFixed(0)} for ${n.name} ${r.earliest < today ? 'was due on' : 'is due by'} ${toIso(r.earliest)}.` };
  }), { oncePerDays: 1 });
  return { students: byStudent.size, parentsReminded: notified, skippedAlreadyRemindedToday: parents.length - fresh.length, texted };
}

/**
 * Adds the school's late fee once to every open invoice more than `lateFeeGraceDays`
 * past due. Idempotent: `fineAppliedAt` marks invoices already fined (or waived).
 */
export async function applyLateFines() {
  const school = await prisma.school.findUniqueOrThrow({ where: { id: currentSchoolId() }, select: { lateFeeAmount: true, lateFeeGraceDays: true } });
  if (D(school.lateFeeAmount).lte(0)) return { fined: 0, amount: '0', enabled: false };
  const today = await schoolToday();
  const cutoff = new Date(today.getTime() - school.lateFeeGraceDays * 86_400_000);
  const { count } = await prisma.feeInvoice.updateMany({
    where: { status: { in: ['UNPAID', 'PARTIAL'] }, fineAppliedAt: null, dueDate: { lt: cutoff }, student: { status: 'ACTIVE' } },
    data: { fineAmount: school.lateFeeAmount, fineAppliedAt: new Date() },
  });
  return { fined: count, amount: D(school.lateFeeAmount).toString(), enabled: true };
}
