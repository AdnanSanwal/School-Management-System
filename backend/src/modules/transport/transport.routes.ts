import { Router } from 'express';
import { z } from 'zod';
import prisma, { ScopedTx, transaction } from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { authenticate } from '../../middleware/auth';
import { can, hasPermission } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { handler, parseBody, id, money, me, patchOf } from '../../utils/http';
import { schoolToday, toIso } from '../../utils/dates';
import { assertStudentAccess, ensureInSchool, isSchoolWide } from '../../utils/scope';

// Transport (spec module 14): routes, vehicles, drivers, stops, student allocation.
// A route's monthly fee is added to each rider's monthly invoice as a "Transport" line.

const router = Router();
router.use(authenticate);

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');

/** The fee head transport is billed under; created on first use. */
export async function transportFeeHead(tx: Pick<ScopedTx, 'feeHead'> = prisma) {
  const existing = await tx.feeHead.findFirst({ where: { name: 'Transport' } });
  return existing ?? tx.feeHead.create({ data: { schoolId: currentSchoolId(), name: 'Transport', frequency: 'MONTHLY' } });
}

router.get('/routes', can('transport.view'), handler(async (req, res) => {
  if (!isSchoolWide(me(req))) throw new AppError('Forbidden: insufficient permissions', 403);
  const routes = await prisma.transportRoute.findMany({
    orderBy: { name: 'asc' },
    include: { stops: { orderBy: { sortOrder: 'asc' } }, _count: { select: { students: true } } },
  });
  return sendSuccess(res, routes.map(({ _count, ...r }) => ({ ...r, riders: _count.students })));
}));

const routeBody = z.object({
  name: z.string().min(2).max(80),
  vehicleNo: z.string().max(30).optional().nullable(),
  driverName: z.string().max(80).optional().nullable(),
  driverPhone: z.string().max(32).optional().nullable(),
  capacity: z.coerce.number().int().positive().max(200).optional().nullable(),
  monthlyFee: money.default(0),
  isActive: z.boolean().optional(),
});

router.post('/routes', can('transport.manage'), handler(async (req, res) => {
  const b = parseBody(routeBody, req);
  if (b.monthlyFee > 0) await transportFeeHead();
  const route = await prisma.transportRoute.create({ data: { schoolId: currentSchoolId(), ...b } });
  return sendSuccess(res, route, 'Route added', 201);
}));

router.patch('/routes/:id', can('transport.manage'), handler(async (req, res) => {
  const b = parseBody(patchOf(routeBody).strict(), req);
  if (b.monthlyFee && b.monthlyFee > 0) await transportFeeHead();
  const route = await prisma.transportRoute.update({ where: { id: req.params.id }, data: b });
  return sendSuccess(res, route, 'Route updated. New fees apply to invoices generated from now on.');
}));

router.delete('/routes/:id', can('transport.manage'), handler(async (req, res) => {
  const riders = await prisma.studentTransport.count({ where: { routeId: req.params.id } });
  if (riders) throw new AppError(`${riders} student(s) still use this route; move them first`, 409);
  const { count } = await prisma.transportRoute.deleteMany({ where: { id: req.params.id } });
  if (!count) throw new AppError('Route not found', 404);
  return sendSuccess(res, null, 'Route removed');
}));

// Replaces a route's stops (in order). Riders keep their stop when its id is kept.
router.put('/routes/:id/stops', can('transport.manage'), handler(async (req, res) => {
  const { stops } = parseBody(z.object({
    stops: z.array(z.object({ id: id.optional(), name: z.string().min(1).max(80), pickupTime: time.optional().nullable(), dropTime: time.optional().nullable() })).max(60),
  }), req);
  const routeId = req.params.id;
  await ensureInSchool(prisma.transportRoute, routeId, 'Route');
  const schoolId = currentSchoolId();
  await transaction(async (tx) => {
    const keep = stops.filter((s) => s.id).map((s) => s.id!);
    await tx.transportStop.deleteMany({ where: { routeId, id: { notIn: keep } } });
    for (const [i, s] of stops.entries()) {
      const data = { name: s.name, pickupTime: s.pickupTime ?? null, dropTime: s.dropTime ?? null, sortOrder: i };
      if (s.id) {
        const { count } = await tx.transportStop.updateMany({ where: { id: s.id, routeId }, data });
        if (!count) throw new AppError('Unknown stop', 422);
      } else {
        await tx.transportStop.create({ data: { schoolId, routeId, ...data } });
      }
    }
  });
  return sendSuccess(res, null, 'Stops saved');
}));

router.get('/routes/:id/students', can('transport.view'), handler(async (req, res) => {
  if (!isSchoolWide(me(req))) throw new AppError('Forbidden: insufficient permissions', 403);
  const rows = await prisma.studentTransport.findMany({
    where: { routeId: req.params.id },
    include: {
      stop: { select: { name: true, sortOrder: true, pickupTime: true } },
      student: { select: { id: true, name: true, admissionNo: true, section: { select: { name: true, class: { select: { name: true } } } }, guardians: { where: { isPrimary: true }, select: { guardian: { select: { name: true, phone: true } } } } } },
    },
  });
  rows.sort((a, b) => (a.stop?.sortOrder ?? 999) - (b.stop?.sortOrder ?? 999) || a.student.name.localeCompare(b.student.name));
  return sendSuccess(res, rows.map((r) => ({
    studentId: r.student.id, name: r.student.name, admissionNo: r.student.admissionNo,
    section: r.student.section ? `${r.student.section.class.name}-${r.student.section.name}` : null,
    stop: r.stop?.name ?? null, pickupTime: r.stop?.pickupTime ?? null,
    guardian: r.student.guardians[0]?.guardian ?? null, since: toIso(r.since),
  })));
}));

// Assign / move a student (manage). Capacity is enforced.
router.put('/students/:studentId', can('transport.manage'), handler(async (req, res) => {
  const b = parseBody(z.object({ routeId: id, stopId: id.nullable().optional() }), req);
  const studentId = req.params.studentId;
  const student = await prisma.student.findFirst({ where: { id: studentId, status: 'ACTIVE' }, select: { id: true } });
  if (!student) throw new AppError('Student not found', 404);
  const route = await prisma.transportRoute.findFirst({ where: { id: b.routeId, isActive: true }, include: { _count: { select: { students: true } } } });
  if (!route) throw new AppError('Route not found or inactive', 404);
  if (b.stopId && !(await prisma.transportStop.findFirst({ where: { id: b.stopId, routeId: route.id }, select: { id: true } }))) {
    throw new AppError('That stop is not on this route', 422);
  }
  const current = await prisma.studentTransport.findUnique({ where: { studentId } });
  if (route.capacity && route._count.students >= route.capacity && current?.routeId !== route.id) {
    throw new AppError(`${route.name} is full (${route.capacity} seats)`, 409);
  }
  if (Number(route.monthlyFee) > 0) await transportFeeHead();
  const row = await prisma.studentTransport.upsert({
    where: { studentId },
    create: { schoolId: currentSchoolId(), studentId, routeId: route.id, stopId: b.stopId ?? null, since: await schoolToday() },
    update: { routeId: route.id, stopId: b.stopId ?? null },
  });
  return sendSuccess(res, row, `Assigned to ${route.name}`);
}));

router.delete('/students/:studentId', can('transport.manage'), handler(async (req, res) => {
  const { count } = await prisma.studentTransport.deleteMany({ where: { studentId: req.params.studentId } });
  if (!count) throw new AppError('Student does not use school transport', 404);
  return sendSuccess(res, null, 'Removed from transport. Transport fee stops from the next invoice.');
}));

// A student's transport (parents: their own child; office: any).
router.get('/students/:studentId', can('transport.view'), handler(async (req, res) => {
  await assertStudentAccess(me(req), req.params.studentId);
  const row = await prisma.studentTransport.findUnique({
    where: { studentId: req.params.studentId },
    include: { route: { include: { stops: { orderBy: { sortOrder: 'asc' } } } }, stop: true },
  });
  if (!row) return sendSuccess(res, null);
  const r = row.route;
  return sendSuccess(res, {
    route: {
      id: r.id, name: r.name, vehicleNo: r.vehicleNo, driverName: r.driverName,
      // Office and the child's own family may call the driver.
      driverPhone: hasPermission(me(req).role, 'transport.view') ? r.driverPhone : null,
      monthlyFee: r.monthlyFee, stops: r.stops.map((s) => ({ name: s.name, pickupTime: s.pickupTime, dropTime: s.dropTime })),
    },
    stop: row.stop ? { name: row.stop.name, pickupTime: row.stop.pickupTime, dropTime: row.stop.dropTime } : null,
    since: toIso(row.since),
  });
}));

export default router;
