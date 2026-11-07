import { Router } from 'express';
import { z } from 'zod';
import { LeaveType, Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { authenticate } from '../../middleware/auth';
import { can } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { handler, parseBody, parseQuery, dateOnly, me } from '../../utils/http';
import { addDays, schoolToday, toDate, toIso } from '../../utils/dates';
import { currentAcademicYear, staffForUser } from '../../utils/scope';
import { notify } from '../../utils/notify';

// Leave management (spec §6 Approvals, §8 Leave Apply, §12 "Leave Approved / Rejected → Teacher").

const router = Router();
router.use(authenticate);

const include = { staff: { select: { id: true, name: true, designation: true, employeeNo: true, userId: true } } } satisfies Prisma.LeaveRequestInclude;
type Row = Prisma.LeaveRequestGetPayload<{ include: typeof include }>;

export const leaveDays = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;

const present = (l: Row) => ({
  ...l, fromDate: toIso(l.fromDate), toDate: toIso(l.toDate), days: leaveDays(l.fromDate, l.toDate),
});

async function myStaff(userId: string) {
  const staff = await staffForUser(userId);
  if (!staff) throw new AppError('Your login is not linked to a staff record', 403);
  return staff;
}

router.post('/', can('leave.apply'), handler(async (req, res) => {
  const b = parseBody(z.object({
    type: z.nativeEnum(LeaveType).default('CASUAL'),
    fromDate: dateOnly,
    toDate: dateOnly,
    reason: z.string().min(3).max(1000),
  }).refine((x) => x.toDate >= x.fromDate, { message: 'End date is before start date', path: ['toDate'] }), req);
  const staff = await myStaff(me(req).id);
  const from = toDate(b.fromDate);
  const to = toDate(b.toDate);
  const today = await schoolToday();
  if (from < addDays(today, -30)) throw new AppError('Leave can be reported at most 30 days back', 422);
  if (leaveDays(from, to) > 60) throw new AppError('A single request can cover at most 60 days', 422);

  const overlap = await prisma.leaveRequest.findFirst({
    where: { staffId: staff.id, status: { in: ['PENDING', 'APPROVED'] }, fromDate: { lte: to }, toDate: { gte: from } },
  });
  if (overlap) throw new AppError(`You already have ${overlap.status.toLowerCase()} leave from ${toIso(overlap.fromDate)} to ${toIso(overlap.toDate)}`, 409);

  const leave = await prisma.leaveRequest.create({
    data: { schoolId: currentSchoolId(), staffId: staff.id, type: b.type, fromDate: from, toDate: to, reason: b.reason },
    include,
  });
  const principals = await prisma.user.findMany({ where: { role: 'PRINCIPAL', isActive: true }, select: { id: true } });
  await notify(principals.map((p) => p.id), {
    type: 'LEAVE_REQUESTED', title: `Leave request from ${staff.name}`,
    body: `${b.type.toLowerCase()} leave ${b.fromDate}${b.toDate !== b.fromDate ? ` to ${b.toDate}` : ''}: ${b.reason.slice(0, 100)}`,
    data: { leaveId: leave.id },
  });
  return sendSuccess(res, present(leave), 'Leave request sent to the principal', 201);
}));

router.get('/mine', can('leave.apply'), handler(async (req, res) => {
  const staff = await myStaff(me(req).id);
  const year = await currentAcademicYear();
  const rows = await prisma.leaveRequest.findMany({ where: { staffId: staff.id }, include, orderBy: { fromDate: 'desc' }, take: 50 });
  const used: Record<string, number> = {};
  for (const l of rows) {
    if (l.status === 'APPROVED' && l.fromDate >= year.startDate) used[l.type] = (used[l.type] ?? 0) + leaveDays(l.fromDate, l.toDate);
  }
  return sendSuccess(res, { requests: rows.map(present), usedThisYear: used });
}));

router.get('/', can('leave.view', 'leave.approve'), handler(async (req, res) => {
  const q = parseQuery(z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(), from: dateOnly.optional(), to: dateOnly.optional() }), req);
  const rows = await prisma.leaveRequest.findMany({
    where: {
      ...(q.status ? { status: q.status } : {}),
      ...(q.from ? { toDate: { gte: toDate(q.from) } } : {}),
      ...(q.to ? { fromDate: { lte: toDate(q.to) } } : {}),
    },
    include, orderBy: [{ status: 'asc' }, { fromDate: 'desc' }], take: 200,
  });
  return sendSuccess(res, rows.map(present));
}));

router.post('/:id/decision', can('leave.approve'), handler(async (req, res) => {
  const b = parseBody(z.object({ approve: z.boolean(), note: z.string().max(300).optional() }), req);
  const leave = await prisma.leaveRequest.findFirst({ where: { id: req.params.id }, include });
  if (!leave) throw new AppError('Leave request not found', 404);
  if (leave.staff.userId === me(req).id) throw new AppError('You cannot decide your own leave', 403);
  const { count } = await prisma.leaveRequest.updateMany({
    where: { id: leave.id, status: 'PENDING' },
    data: { status: b.approve ? 'APPROVED' : 'REJECTED', decidedById: me(req).id, decidedAt: new Date(), decisionNote: b.note ?? null },
  });
  if (!count) throw new AppError('This request was already decided', 409);
  // Spec: "Leave Approved / Rejected → Teacher".
  if (leave.staff.userId) {
    await notify([leave.staff.userId], {
      type: 'LEAVE_DECIDED',
      title: `Leave ${b.approve ? 'approved' : 'rejected'}`,
      body: `${toIso(leave.fromDate)}${leave.toDate.getTime() !== leave.fromDate.getTime() ? ` to ${toIso(leave.toDate)}` : ''}${b.note ? ` — ${b.note}` : ''}`,
      data: { leaveId: leave.id },
    });
  }
  return sendSuccess(res, null, b.approve ? 'Leave approved' : 'Leave rejected');
}));

router.post('/:id/cancel', can('leave.apply'), handler(async (req, res) => {
  const staff = await myStaff(me(req).id);
  const { count } = await prisma.leaveRequest.deleteMany({ where: { id: req.params.id, staffId: staff.id, status: 'PENDING' } });
  if (!count) throw new AppError('Only your own pending requests can be withdrawn', 409);
  return sendSuccess(res, null, 'Leave request withdrawn');
}));

export default router;
