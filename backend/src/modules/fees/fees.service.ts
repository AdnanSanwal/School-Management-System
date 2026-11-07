import { Prisma, FeeFrequency } from '@prisma/client';
import prisma from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { AppError } from '../../middleware/errorHandler';
import { formatNumber, nextNumber } from '../../utils/counter';
import { periodRange, schoolToday, toDate } from '../../utils/dates';
import { currentAcademicYear } from '../../utils/scope';
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
    select: { id: true, section: { select: { classId: true } } },
  });
  const skipped = await prisma.feeInvoice.count({
    where: {
      period: opts.period,
      ...(opts.classIds?.length ? { student: { section: { classId: { in: opts.classIds } } } } : {}),
      ...(opts.studentIds?.length ? { studentId: { in: opts.studentIds } } : {}),
    },
  });

  const [structures, concessions] = await Promise.all([
    prisma.feeStructure.findMany({
      where: { academicYearId: year.id, feeHead: { isActive: true, frequency: { in: opts.frequencies } } },
      orderBy: { feeHead: { name: 'asc' } },
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

  const today = await schoolToday();
  let created = 0;
  let billed = D(0);
  const noStructure = new Set<string>();
  for (const s of students) {
    const classId = s.section!.classId;
    const lines = structures.filter((f) => f.classId === classId).map((f) => ({ feeHeadId: f.feeHeadId, amount: f.amount }));
    if (!lines.length) { noStructure.add(classId); continue; }
    const items = applyConcessions(lines, concessions.filter((c) => c.studentId === s.id));
    const t = totals(items);
    await prisma.$transaction(async (tx) => {
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
  collectedById: string;
}

/**
 * Records a payment and settles open invoices oldest-due first (or only the
 * chosen ones). Uses optimistic checks on each invoice's paidAmount so two
 * cashiers collecting for the same student at once cannot double-settle.
 */
export async function collectPayment(input: CollectInput) {
  const schoolId = currentSchoolId();
  return prisma.$transaction(async (tx) => {
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
