import { Router } from 'express';
import { z } from 'zod';
import { Prisma, PaymentMethod, FeeFrequency } from '@prisma/client';
import prisma, { transaction } from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { authenticate } from '../../middleware/auth';
import { can } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';
import { sendSuccess, sendPaginated } from '../../utils/apiResponse';
import { handler, parseBody, parseQuery, paginationSchema, paging, dateOnly, period, money, id, me, patchOf } from '../../utils/http';
import { toDate, toIso, addDays, schoolToday, schoolTimezone, zonedDayStart } from '../../utils/dates';
import { assertStudentAccess, currentAcademicYear, ensureInSchool, isSchoolWide, studentScope } from '../../utils/scope';
import { applyLateFines, collectPayment, defaulters, generateInvoices, receipt, sendFeeReminders, STUDENT_MONTHLY_FEE_HEAD } from './fees.service';
import { D } from './fees.calc';
import { guardiansOf, notifyEach } from '../../utils/notify';
import { messageFamilies } from '../../utils/messaging';

// Fee heads, class fee structure, monthly invoices, collection & receipts,
// concessions and defaulters (spec: Fee Management, Accountant).

const router = Router();
router.use(authenticate);

/** Finance screens beyond a parent's own children are for office roles only. */
function requireSchoolWide(req: Parameters<typeof me>[0]) {
  if (!isSchoolWide(me(req))) throw new AppError('Forbidden: insufficient permissions', 403);
}

// ─── Fee heads ───

router.get('/heads', can('fee.structure.view'), handler(async (_req, res) => {
  return sendSuccess(res, await prisma.feeHead.findMany({ orderBy: { name: 'asc' } }));
}));

const headBody = z.object({
  name: z.string().min(1).max(60),
  frequency: z.enum(['MONTHLY', 'ANNUAL', 'ONE_TIME']),
  isActive: z.boolean().optional(),
});

router.post('/heads', can('fee.structure.manage'), handler(async (req, res) => {
  const body = parseBody(headBody, req);
  return sendSuccess(res, await prisma.feeHead.create({ data: { schoolId: currentSchoolId(), ...body } }), 'Fee head created', 201);
}));

router.patch('/heads/:id', can('fee.structure.manage'), handler(async (req, res) => {
  const body = parseBody(patchOf(headBody).strict(), req);
  return sendSuccess(res, await prisma.feeHead.update({ where: { id: req.params.id }, data: body }), 'Fee head updated');
}));

// ─── Fee structure (class × head, current year) ───

router.get('/structure', can('fee.structure.view'), handler(async (_req, res) => {
  const year = await currentAcademicYear();
  const [classes, heads, rows] = await Promise.all([
    prisma.class.findMany({ where: { archivedAt: null }, orderBy: { level: 'asc' }, select: { id: true, name: true } }),
    // Transport is charged from each rider's route (modules/transport), so it isn't set per class.
    prisma.feeHead.findMany({ where: { isActive: true, name: { notIn: ['Transport', STUDENT_MONTHLY_FEE_HEAD] } }, orderBy: { name: 'asc' } }),
    prisma.feeStructure.findMany({ where: { academicYearId: year.id } }),
  ]);
  return sendSuccess(res, {
    academicYear: { id: year.id, name: year.name },
    heads,
    classes: classes.map((c) => {
      const amounts = Object.fromEntries(rows.filter((r) => r.classId === c.id).map((r) => [r.feeHeadId, r.amount]));
      const monthly = heads.filter((h) => h.frequency === 'MONTHLY').reduce((s, h) => s.plus(amounts[h.id] ?? 0), D(0));
      return { ...c, amounts, monthlyTotal: monthly };
    }),
  });
}));

router.put('/structure/:classId', can('fee.structure.manage'), handler(async (req, res) => {
  const { items } = parseBody(z.object({ items: z.array(z.object({ feeHeadId: id, amount: money })).max(30) }), req);
  const classId = req.params.classId;
  await ensureInSchool(prisma.class, classId, 'Class');
  const headIds = [...new Set(items.map((i) => i.feeHeadId))];
  if (headIds.length !== items.length) throw new AppError('Each fee head can appear only once', 422);
  if ((await prisma.feeHead.count({ where: { id: { in: headIds } } })) !== headIds.length) throw new AppError('Unknown fee head', 422);

  const year = await currentAcademicYear();
  const schoolId = currentSchoolId();
  await transaction(async (tx) => {
    await tx.feeStructure.deleteMany({ where: { academicYearId: year.id, classId } });
    await tx.feeStructure.createMany({
      data: items.filter((i) => i.amount > 0).map((i) => ({ schoolId, academicYearId: year.id, classId, feeHeadId: i.feeHeadId, amount: i.amount })),
    });
  });
  return sendSuccess(res, null, 'Fee structure saved. Already-issued invoices are not changed.');
}));

// ─── Invoices ───

router.post('/invoices/generate', can('fee.invoice.generate'), handler(async (req, res) => {
  const body = parseBody(z.object({
    period,
    classIds: z.array(id).max(50).optional(),
    studentIds: z.array(id).max(500).optional(),
    dueDay: z.coerce.number().int().min(1).max(31).default(10),
    includeAnnual: z.boolean().default(false),
    includeOneTime: z.boolean().default(false),
  }), req);
  const frequencies: FeeFrequency[] = ['MONTHLY'];
  if (body.includeAnnual) frequencies.push('ANNUAL');
  if (body.includeOneTime) frequencies.push('ONE_TIME');
  const result = await generateInvoices({ ...body, frequencies });
  return sendSuccess(res, result, `${result.created} invoices created for ${body.period}`, 201);
}));

router.get('/invoices', can('fee.view'), handler(async (req, res) => {
  const q = parseQuery(paginationSchema.extend({
    studentId: id.optional(),
    classId: id.optional(),
    period: period.optional(),
    status: z.enum(['UNPAID', 'PARTIAL', 'PAID', 'CANCELLED', 'OPEN']).optional(),
    search: z.string().trim().max(60).optional(),
  }), req);
  const where: Prisma.FeeInvoiceWhereInput = {
    student: { AND: [await studentScope(me(req)), q.classId ? { section: { classId: q.classId } } : {}] },
    // Invoice no., or the student's name / admission no.
    ...(q.search ? { OR: [{ invoiceNo: { contains: q.search } }, { student: { name: { contains: q.search } } }, { student: { admissionNo: { contains: q.search } } }] } : {}),
    ...(q.studentId ? { studentId: q.studentId } : {}),
    ...(q.period ? { period: q.period } : {}),
    ...(q.status === 'OPEN' ? { status: { in: ['UNPAID', 'PARTIAL'] } } : q.status ? { status: q.status } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.feeInvoice.findMany({
      where, ...paging(q), orderBy: [{ period: 'desc' }, { invoiceNo: 'desc' }],
      include: {
        student: { select: { id: true, name: true, admissionNo: true, section: { select: { name: true, class: { select: { name: true } } } } } },
        items: { include: { feeHead: { select: { name: true } } } },
      },
    }),
    prisma.feeInvoice.count({ where }),
  ]);
  return sendPaginated(res, rows, total, q.page, q.limit);
}));

router.post('/invoices/:id/cancel', can('fee.invoice.generate'), handler(async (req, res) => {
  const { count } = await prisma.feeInvoice.updateMany({
    where: { id: req.params.id, status: 'UNPAID', paidAmount: 0 },
    data: { status: 'CANCELLED' },
  });
  if (!count) throw new AppError('Only unpaid invoices with no payments can be cancelled', 409);
  return sendSuccess(res, null, 'Invoice cancelled');
}));

// Everything about one student's fees: open balance, invoices, payments (parent "Fee Details").
router.get('/students/:studentId', can('fee.view'), handler(async (req, res) => {
  await assertStudentAccess(me(req), req.params.studentId);
  const studentId = req.params.studentId;
  const [student, invoices, payments, concessions] = await Promise.all([
    prisma.student.findFirstOrThrow({
      where: { id: studentId },
      select: { id: true, name: true, admissionNo: true, status: true, section: { select: { name: true, class: { select: { name: true } } } } },
    }),
    prisma.feeInvoice.findMany({
      where: { studentId, status: { not: 'CANCELLED' } }, orderBy: { period: 'desc' },
      include: { items: { include: { feeHead: { select: { name: true } } } } },
    }),
    prisma.payment.findMany({
      where: { studentId, status: 'SUCCESS' }, orderBy: { paidAt: 'desc' },
      include: { allocations: { select: { amount: true, invoice: { select: { period: true } } } } },
    }),
    prisma.concession.findMany({ where: { studentId }, include: { feeHead: { select: { name: true } } }, orderBy: { createdAt: 'desc' } }),
  ]);
  const open = invoices.filter((i) => i.status === 'UNPAID' || i.status === 'PARTIAL');
  const pending = open.reduce((s, i) => s.plus(i.netAmount).plus(i.fineAmount).minus(i.paidAmount), D(0));
  const nextDue = open.map((i) => i.dueDate).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  const lastPaid = invoices.filter((i) => i.status === 'PAID').map((i) => i.period).sort().pop() ?? null;
  return sendSuccess(res, {
    student, pending, nextDueDate: nextDue ? toIso(nextDue) : null, paidTill: lastPaid,
    invoices, payments, concessions,
  });
}));

// ─── Collection & receipts ───

router.post('/payments', can('fee.collect'), handler(async (req, res) => {
  const body = parseBody(z.object({
    studentId: id,
    amount: money.refine((v) => v > 0, 'must be positive'),
    method: z.nativeEnum(PaymentMethod),
    reference: z.string().max(100).optional(),
    remarks: z.string().max(300).optional(),
    invoiceIds: z.array(id).max(24).optional(),
  }), req);
  if (body.method !== 'CASH' && !body.reference) throw new AppError('Transaction reference is required for non-cash payments', 422);
  const result = await collectPayment({ ...body, collectedById: me(req).id });

  // Spec: "Fee paid successfully → Parent + Accountant" (the accountant sees it on screen).
  const parents = await guardiansOf([body.studentId]);
  await notifyEach(parents.map((p) => ({
    userId: p.userId, type: 'FEE_PAID' as const, title: 'Fee received',
    body: `Payment of ${D(body.amount).toFixed(2)} received for ${p.studentName}. Receipt ${result.payment.receiptNo}.`,
    data: { paymentId: result.payment.id, studentId: p.studentId },
  })));
  await messageFamilies('FEE_PAID', [{ studentId: body.studentId, body: `Fee of ${D(body.amount).toFixed(0)} received. Receipt ${result.payment.receiptNo}. Thank you.` }]);
  return sendSuccess(res, result, `Payment recorded — receipt ${result.payment.receiptNo}`, 201);
}));

router.get('/payments', can('fee.view'), handler(async (req, res) => {
  requireSchoolWide(req);
  const q = parseQuery(paginationSchema.extend({
    from: dateOnly.optional(), to: dateOnly.optional(),
    method: z.nativeEnum(PaymentMethod).optional(),
    search: z.string().trim().max(60).optional(),
  }), req);
  const today = await schoolToday();
  const from = q.from ? toDate(q.from) : today;
  const to = addDays(q.to ? toDate(q.to) : from, 1); // inclusive end date
  const tz = await schoolTimezone();
  const where: Prisma.PaymentWhereInput = {
    status: 'SUCCESS',
    paidAt: { gte: zonedDayStart(toIso(from), tz), lt: zonedDayStart(toIso(to), tz) },
    ...(q.method ? { method: q.method } : {}),
    ...(q.search ? { OR: [{ receiptNo: { contains: q.search } }, { reference: { contains: q.search } }, { student: { name: { contains: q.search } } }, { student: { admissionNo: { contains: q.search } } }] } : {}),
  };
  const [rows, total, sums] = await Promise.all([
    prisma.payment.findMany({
      where, ...paging(q), orderBy: { paidAt: 'desc' },
      include: { student: { select: { id: true, name: true, admissionNo: true, section: { select: { name: true, class: { select: { name: true } } } } } } },
    }),
    prisma.payment.count({ where }),
    prisma.payment.groupBy({ by: ['method'], where, _sum: { amount: true }, _count: true }),
  ]);
  const byMethod = sums.map((s) => ({ method: s.method, count: s._count, amount: s._sum.amount ?? D(0) }));
  const grand = byMethod.reduce((s, m) => s.plus(m.amount), D(0));
  return res.json({
    success: true, message: 'Success', data: rows,
    totals: { amount: grand, byMethod, from: toIso(from), to: toIso(addDays(to, -1)) },
    pagination: { total, page: q.page, limit: q.limit, pages: Math.ceil(total / q.limit) },
  });
}));

router.get('/payments/:id/receipt', can('fee.view'), handler(async (req, res) => {
  return sendSuccess(res, await receipt(req.params.id, await studentScope(me(req))));
}));

// ─── Fee due reminders (spec §12: "Fee Due / Overdue → Parent") ───

router.post('/reminders', can('fee.collect', 'fee.invoice.generate'), handler(async (req, res) => {
  const body = parseBody(z.object({
    daysAhead: z.coerce.number().int().min(0).max(31).default(3),
    classId: id.optional(),
  }), req);
  const r = await sendFeeReminders(body);
  return sendSuccess(res, r, `Reminders sent to ${r.parentsReminded} parent(s)`);
}));

// ─── Late fines ───

router.post('/fines/apply', can('fee.invoice.generate'), handler(async (_req, res) => {
  const r = await applyLateFines();
  if (!r.enabled) throw new AppError('Set a late fee amount in school settings first', 422);
  return sendSuccess(res, r, `Late fee added to ${r.fined} invoice(s)`);
}));

// Principal can forgive a late fee; the invoice stays marked so it isn't fined again.
router.post('/invoices/:id/waive-fine', can('fee.concession.approve'), handler(async (req, res) => {
  const inv = await prisma.feeInvoice.findFirst({ where: { id: req.params.id } });
  if (!inv) throw new AppError('Invoice not found', 404);
  if (D(inv.fineAmount).lte(0)) throw new AppError('This invoice has no late fee', 409);
  const settled = D(inv.paidAmount).gte(inv.netAmount);
  await prisma.feeInvoice.update({
    where: { id: inv.id },
    data: { fineAmount: 0, fineAppliedAt: inv.fineAppliedAt ?? new Date(), ...(settled ? { status: 'PAID' } : {}) },
  });
  return sendSuccess(res, null, 'Late fee waived');
}));

// ─── Defaulters ───

router.get('/defaulters', can('fee.view'), handler(async (req, res) => {
  requireSchoolWide(req);
  const q = parseQuery(z.object({ classId: id.optional(), minDaysOverdue: z.coerce.number().int().min(0).max(365).default(0) }), req);
  const rows = await defaulters(q);
  return sendSuccess(res, {
    count: rows.length,
    totalPending: rows.reduce((s, r) => s.plus(r.pending), D(0)),
    students: rows.map((r) => ({ ...r, oldestDue: toIso(r.oldestDue) })),
  });
}));

// ─── Concessions ───

// Office roles with fee.view (incl. the owner) can see concessions read-only; parents cannot.
router.get('/concessions', can('fee.concession.request', 'fee.concession.approve', 'fee.view'), handler(async (req, res) => {
  requireSchoolWide(req);
  const q = parseQuery(z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(), studentId: id.optional() }), req);
  const rows = await prisma.concession.findMany({
    where: { ...(q.status ? { status: q.status } : {}), ...(q.studentId ? { studentId: q.studentId } : {}) },
    orderBy: { createdAt: 'desc' },
    include: {
      student: { select: { id: true, name: true, admissionNo: true, section: { select: { name: true, class: { select: { name: true } } } } } },
      feeHead: { select: { name: true } },
    },
  });
  return sendSuccess(res, rows);
}));

router.post('/concessions', can('fee.concession.request'), handler(async (req, res) => {
  const body = parseBody(z.object({
    studentId: id,
    feeHeadId: id.nullable().optional(),
    type: z.enum(['PERCENT', 'FIXED']),
    value: money.refine((v) => v > 0, 'must be positive'),
    reason: z.string().min(3).max(300),
    validFrom: dateOnly,
    validTo: dateOnly.optional(),
  }).refine((c) => c.type !== 'PERCENT' || c.value <= 100, { message: 'percent cannot exceed 100', path: ['value'] })
    .refine((c) => !c.validTo || c.validTo >= c.validFrom, { message: 'validTo must be after validFrom', path: ['validTo'] }), req);
  await ensureInSchool(prisma.student, body.studentId, 'Student');
  await ensureInSchool(prisma.feeHead, body.feeHeadId, 'Fee head');
  const concession = await prisma.concession.create({
    data: {
      schoolId: currentSchoolId(), studentId: body.studentId, feeHeadId: body.feeHeadId ?? null,
      type: body.type, value: body.value, reason: body.reason, requestedById: me(req).id,
      validFrom: toDate(body.validFrom), validTo: body.validTo ? toDate(body.validTo) : null,
    },
  });
  return sendSuccess(res, concession, 'Concession requested — waiting for principal approval', 201);
}));

router.post('/concessions/:id/decision', can('fee.concession.approve'), handler(async (req, res) => {
  const { approve } = parseBody(z.object({ approve: z.boolean() }), req);
  // Separation of duties (AUTHZ-5): the person who asked for it can't also approve it — except the owner, whose business it is.
  const own = await prisma.concession.findFirst({ where: { id: req.params.id }, select: { requestedById: true } });
  if (own?.requestedById === me(req).id && me(req).role !== 'OWNER') throw new AppError('You cannot decide a concession you asked for', 403);
  const { count } = await prisma.concession.updateMany({
    where: { id: req.params.id, status: 'PENDING' },
    data: { status: approve ? 'APPROVED' : 'REJECTED', decidedById: me(req).id, decidedAt: new Date() },
  });
  if (!count) throw new AppError('Concession not found or already decided', 409);
  return sendSuccess(res, null, approve ? 'Concession approved — applies to invoices generated from now on' : 'Concession rejected');
}));

export default router;
