import { Router } from 'express';
import { z } from 'zod';
import { LeaveType } from '@prisma/client';
import prisma, { transaction } from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { authenticate } from '../../middleware/auth';
import { can, hasPermission } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { handler, parseBody, dateOnly, money, me } from '../../utils/http';
import { schoolToday, toDate, toIso } from '../../utils/dates';
import { currentAcademicYear, ensureInSchool, staffForUser } from '../../utils/scope';
import { LEAVE_TYPES, leaveBalances, leavePolicy, salariesOn, salaryHistory } from '../../utils/hr';
import { D } from '../fees/fees.calc';
import { onRoll } from '../../utils/staffStatus';

// HR records: department/designation lists, leave policy and balances, salary structures.
// Staff profiles and documents live in modules/staff; payroll comes in the next step.

const router = Router();
router.use(authenticate);

// ─── Departments & designations (managed lists for the staff forms) ───

const nameBody = z.object({ name: z.string().trim().min(2).max(60) });

function listRoutes(path: 'departments' | 'designations', column: 'department' | 'designation') {
  const model = (path === 'departments' ? prisma.department : prisma.designation) as typeof prisma.department;
  const label = path === 'departments' ? 'Department' : 'Designation';

  router.post(`/${path}`, can('hr.manage'), handler(async (req, res) => {
    const { name } = parseBody(nameBody, req);
    if (await model.findFirst({ where: { name } })) throw new AppError(`${label} “${name}” already exists`, 409);
    return sendSuccess(res, await model.create({ data: { schoolId: currentSchoolId(), name } }), `${label} added`, 201);
  }));

  // Renaming also renames it on every staff member who has it.
  router.patch(`/${path}/:id`, can('hr.manage'), handler(async (req, res) => {
    const { name } = parseBody(nameBody, req);
    const row = await model.findFirst({ where: { id: req.params.id } });
    if (!row) throw new AppError(`${label} not found`, 404);
    if (name !== row.name && await model.findFirst({ where: { name } })) throw new AppError(`${label} “${name}” already exists`, 409);
    await transaction(async (tx) => {
      await (path === 'departments' ? tx.department : tx.designation as unknown as typeof tx.department).update({ where: { id: row.id }, data: { name } });
      await tx.staff.updateMany({ where: { [column]: row.name }, data: { [column]: name } });
    });
    return sendSuccess(res, { id: row.id, name }, `${label} renamed`);
  }));

  router.delete(`/${path}/:id`, can('hr.manage'), handler(async (req, res) => {
    const row = await model.findFirst({ where: { id: req.params.id } });
    if (!row) throw new AppError(`${label} not found`, 404);
    const inUse = await prisma.staff.count({ where: { [column]: row.name, status: onRoll } });
    if (inUse) throw new AppError(`${inUse} active staff member(s) are in “${row.name}”. Move them first.`, 409);
    await model.deleteMany({ where: { id: row.id } });
    return sendSuccess(res, null, `${label} removed`);
  }));
}
listRoutes('departments', 'department');
listRoutes('designations', 'designation');

/** Lists for the staff forms, with how many active staff use each entry. */
router.get('/options', can('staff.view'), handler(async (_req, res) => {
  const [departments, designations, staff] = await Promise.all([
    prisma.department.findMany({ orderBy: { name: 'asc' } }),
    prisma.designation.findMany({ orderBy: { name: 'asc' } }),
    prisma.staff.findMany({ where: { status: onRoll }, select: { department: true, designation: true } }),
  ]);
  const count = (col: 'department' | 'designation', name: string) => staff.filter((s) => s[col] === name).length;
  return sendSuccess(res, {
    departments: departments.map((d) => ({ id: d.id, name: d.name, staff: count('department', d.name) })),
    designations: designations.map((d) => ({ id: d.id, name: d.name, staff: count('designation', d.name) })),
  });
}));

// ─── Leave policy & balances ───

router.get('/leave-policy', can('leave.apply', 'leave.view', 'staff.view'), handler(async (_req, res) => {
  return sendSuccess(res, await leavePolicy());
}));

router.put('/leave-policy', can('hr.manage'), handler(async (req, res) => {
  const { items } = parseBody(z.object({
    items: z.array(z.object({
      type: z.nativeEnum(LeaveType),
      daysPerYear: z.coerce.number().int().min(0).max(365),
      isPaid: z.boolean(),
    })).min(1).max(LEAVE_TYPES.length),
  }), req);
  if (new Set(items.map((i) => i.type)).size !== items.length) throw new AppError('A leave type appears twice', 422);
  const schoolId = currentSchoolId();
  await transaction(async (tx) => {
    for (const i of items) {
      // Unpaid types have no allowance: every day is unpaid.
      const data = { daysPerYear: i.isPaid ? i.daysPerYear : 0, isPaid: i.isPaid };
      const existing = await tx.leavePolicy.findFirst({ where: { type: i.type } });
      if (existing) await tx.leavePolicy.update({ where: { id: existing.id }, data });
      else await tx.leavePolicy.create({ data: { schoolId, type: i.type, ...data } });
    }
  });
  return sendSuccess(res, await leavePolicy(), 'Leave policy saved. Balances use it straight away.');
}));

/** Everyone's leave balance for the current academic year. */
router.get('/leave-balances', can('leave.view', 'leave.approve', 'staff.manage'), handler(async (_req, res) => {
  const year = await currentAcademicYear();
  const staff = await prisma.staff.findMany({ where: { status: onRoll }, orderBy: { name: 'asc' }, select: { id: true, name: true, employeeNo: true, designation: true } });
  const balances = await leaveBalances(staff.map((s) => s.id), year);
  return sendSuccess(res, { year: year.name, staff: staff.map((s) => ({ ...s, balances: balances.get(s.id) ?? [] })) });
}));

// ─── Salary structures ───

const componentBody = z.object({
  kind: z.enum(['ALLOWANCE', 'DEDUCTION']),
  name: z.string().trim().min(2).max(60),
  amount: money.refine((v) => v > 0, 'must be more than 0'),
});

const structureBody = z.object({
  effectiveFrom: dateOnly,
  basic: money,
  note: z.string().trim().max(300).optional(),
  components: z.array(componentBody).max(20).default([]),
});

/** Salary sheet: every active staff member's pay today, with totals. */
router.get('/salaries', can('salary.view'), handler(async (_req, res) => {
  const today = await schoolToday();
  const staff = await prisma.staff.findMany({
    where: { status: onRoll }, orderBy: { name: 'asc' },
    select: { id: true, name: true, employeeNo: true, designation: true, department: true, contractType: true, bankName: true, bankAccountNo: true },
  });
  const pay = await salariesOn(staff.map((s) => s.id), today);
  const rows = staff.map((s) => ({ ...s, salary: pay.get(s.id) ?? null }));
  const withPay = rows.filter((r) => r.salary);
  const sum = (k: 'basic' | 'allowances' | 'deductions' | 'gross' | 'net') => withPay.reduce((t, r) => t.plus(r.salary![k]), D(0));
  return sendSuccess(res, {
    asOf: toIso(today), rows,
    totals: { staff: rows.length, withSalary: withPay.length, basic: sum('basic'), allowances: sum('allowances'), deductions: sum('deductions'), gross: sum('gross'), net: sum('net') },
  });
}));

router.get('/staff/:id/salary', can('salary.view'), handler(async (req, res) => {
  await ensureInSchool(prisma.staff, req.params.id, 'Staff member');
  const today = await schoolToday();
  const history = await salaryHistory(req.params.id);
  return sendSuccess(res, { current: history.find((h) => h.effectiveFrom <= toIso(today)) ?? null, history });
}));

/** A new structure from a date (first salary, or a raise). Same date again replaces that entry. */
router.post('/staff/:id/salary', can('salary.manage'), handler(async (req, res) => {
  const b = parseBody(structureBody, req);
  const staffId = req.params.id;
  await ensureInSchool(prisma.staff, staffId, 'Staff member');
  const names = b.components.map((c) => `${c.kind}:${c.name.toLowerCase()}`);
  if (new Set(names).size !== names.length) throw new AppError('The same allowance or deduction is listed twice', 422);
  const deductions = b.components.filter((c) => c.kind === 'DEDUCTION').reduce((t, c) => t + c.amount, 0);
  const gross = b.basic + b.components.filter((c) => c.kind === 'ALLOWANCE').reduce((t, c) => t + c.amount, 0);
  if (deductions > gross) throw new AppError('Deductions are more than the gross salary', 422);

  const schoolId = currentSchoolId();
  const effectiveFrom = toDate(b.effectiveFrom);
  await transaction(async (tx) => {
    const same = await tx.salaryStructure.findFirst({ where: { staffId, effectiveFrom } });
    if (same) await tx.salaryStructure.deleteMany({ where: { id: same.id } });
    const s = await tx.salaryStructure.create({
      data: { schoolId, staffId, effectiveFrom, basic: b.basic, note: b.note || null, createdById: me(req).id },
    });
    if (b.components.length) {
      await tx.salaryComponent.createMany({ data: b.components.map((c) => ({ schoolId, structureId: s.id, kind: c.kind, name: c.name, amount: c.amount })) });
    }
  });
  const today = toIso(await schoolToday());
  const history = await salaryHistory(staffId);
  return sendSuccess(res, { current: history.find((h) => h.effectiveFrom <= today) ?? null, history },
    b.effectiveFrom > today ? `Saved. It takes effect on ${b.effectiveFrom}.` : 'Salary saved', 201);
}));

/** Removes a salary entry (a mistake). Earlier entries apply again from their own dates. */
router.delete('/salary/:structureId', can('salary.manage'), handler(async (req, res) => {
  const { count } = await prisma.salaryStructure.deleteMany({ where: { id: req.params.structureId } });
  if (!count) throw new AppError('Salary entry not found', 404);
  return sendSuccess(res, null, 'Salary entry removed');
}));

// ─── Self service ───

/** The signed-in staff member's own HR summary: profile, current pay, leave balance. */
router.get('/me', handler(async (req, res) => {
  const link = await staffForUser(me(req).id);
  if (!link) throw new AppError('Your login is not linked to a staff record', 404);
  const [staff, year, today] = await Promise.all([
    prisma.staff.findFirstOrThrow({ where: { id: link.id } }),
    currentAcademicYear(),
    schoolToday(),
  ]);
  const [balances, pay] = await Promise.all([leaveBalances([staff.id], year), salariesOn([staff.id], today)]);
  return sendSuccess(res, {
    staff: { ...staff, joiningDate: staff.joiningDate ? toIso(staff.joiningDate) : null, dateOfBirth: staff.dateOfBirth ? toIso(staff.dateOfBirth) : null },
    salary: pay.get(staff.id) ?? null,
    leave: { year: year.name, balances: balances.get(staff.id) ?? [] },
    canSeeAllSalaries: hasPermission(me(req).role, 'salary.view'),
  });
}));

export default router;
