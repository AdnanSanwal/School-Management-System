import { Response, NextFunction } from 'express';
import type { Role } from '@prisma/client';
import { AuthRequest } from './auth';
import { sendError } from '../utils/apiResponse';
import { tenantStorage, RoleOverrides } from '../config/tenancy';

export type { Role };

/**
 * Permission catalogue. Mirrors the role tables in the ERP spec
 * (School_ERP_Complete_Feature_Report, sections 4–11).
 *
 * Holding a permission is not the whole check: TEACHER, PARENT and STUDENT also
 * get their data narrowed by the scope helpers in src/utils/scope.ts
 * (own sections / linked children / self).
 */
export const PERMISSIONS = [
  'school.view', 'school.manage', 'users.manage',
  'dashboard.owner', 'dashboard.principal', 'dashboard.admin', 'dashboard.accountant',
  'student.view', 'student.manage', 'student.admit', 'student.fee.set', 'student.status.request', 'student.status.approve',
  'staff.view', 'staff.manage',
  // HR: lists and leave policy; who may see and set salaries.
  'hr.manage', 'salary.view', 'salary.manage',
  'finance.view', 'finance.manage', 'expense.approve',
  'payroll.view', 'payroll.manage', 'payroll.approve',
  'books.reopen', 'roles.manage',
  'class.view', 'class.manage',
  'attendance.student.mark', 'attendance.student.view', 'attendance.student.correct',
  'attendance.staff.mark', 'attendance.staff.view',
  'leave.apply', 'leave.view', 'leave.approve',
  'fee.view', 'fee.structure.view', 'fee.structure.manage', 'fee.invoice.generate', 'fee.collect',
  'fee.concession.request', 'fee.concession.approve', 'fee.pay',
  'exam.view', 'exam.manage', 'exam.approve', 'marks.enter', 'marks.view', 'reportcard.generate',
  'diary.view', 'diary.post',
  'timetable.view', 'timetable.manage', 'timetable.approve',
  'calendar.view', 'calendar.manage',
  'notice.view', 'notice.publish', 'message.broadcast',
  'reports.finance', 'reports.attendance', 'reports.academic',
  'promotion.run',
  'transport.view', 'transport.manage',
  'library.view', 'library.manage',
  'homework.mark',
  'audit.view',
  'platform.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const OWNER_EXCLUDED: Permission[] = ['platform.manage', 'diary.post', 'leave.apply', 'fee.pay', 'homework.mark'];

const EVERYONE_IN_SCHOOL: Permission[] = ['notice.view', 'calendar.view', 'timetable.view', 'exam.view'];

const READ_ALL: Permission[] = [
  'school.view', 'student.view', 'staff.view', 'class.view', 'attendance.student.view',
  'attendance.staff.view', 'leave.view', 'fee.view', 'fee.structure.view', 'marks.view', 'diary.view',
];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  SUPER_ADMIN: new Set<Permission>(['platform.manage']),

  // Business owner: full rights over everything in the school — every permission a staff
  // role can hold, plus the owner's own (roles, approvals, closed months). Left out are only
  // personal actions that belong to a person, not a rank: posting to the diary as the
  // teacher, applying for one's own leave, and a parent's online payment / homework ticks.
  OWNER: new Set<Permission>(PERMISSIONS.filter((p) => !OWNER_EXCLUDED.includes(p))),

  // Academic + administrative head; approvals. No fee collection or fee-structure edits.
  PRINCIPAL: new Set<Permission>([
    ...EVERYONE_IN_SCHOOL, ...READ_ALL, 'audit.view', 'salary.view', 'finance.view', 'payroll.view',
    'users.manage', 'dashboard.principal',
    'student.manage', 'student.admit', 'student.status.request', 'student.status.approve',
    'staff.manage', 'class.manage',
    'attendance.student.correct', 'attendance.staff.mark',
    'leave.apply', 'leave.approve',
    'fee.concession.approve',
    'exam.manage', 'exam.approve', 'reportcard.generate',
    'timetable.manage', 'timetable.approve', 'calendar.manage',
    'notice.publish', 'message.broadcast',
    'reports.finance', 'reports.attendance', 'reports.academic',
    'promotion.run', 'transport.view', 'transport.manage', 'library.view', 'library.manage',
  ]),

  // Office staff: admissions, records, fee entry, notices.
  ADMIN: new Set<Permission>([
    ...EVERYONE_IN_SCHOOL,
    'school.view', 'school.manage', 'users.manage', 'dashboard.admin',
    'student.view', 'student.manage', 'student.admit', 'student.fee.set', 'student.status.request',
    'staff.view', 'staff.manage', 'class.view', 'class.manage',
    'hr.manage', 'salary.view', 'salary.manage', 'leave.view',
    'attendance.student.view', 'attendance.student.correct',
    'attendance.staff.mark', 'attendance.staff.view',
    'fee.view', 'fee.structure.view', 'fee.structure.manage', 'fee.invoice.generate', 'fee.collect',
    'fee.concession.request',
    'exam.manage', 'timetable.manage', 'calendar.manage', 'notice.publish',
    'reports.finance', 'reports.attendance', 'leave.apply',
    'promotion.run', 'transport.view', 'transport.manage', 'library.view', 'library.manage',
  ]),

  // Finance only.
  ACCOUNTANT: new Set<Permission>([
    ...EVERYONE_IN_SCHOOL,
    'school.view', 'dashboard.accountant', 'student.view', 'class.view',
    // CR-04: accountants may admit students (and set their monthly fee), not edit them.
    'student.admit', 'student.fee.set',
    'fee.view', 'fee.structure.view', 'fee.invoice.generate', 'fee.collect', 'fee.concession.request',
    'reports.finance', 'leave.apply', 'transport.view',
    // Prepares payroll: needs staff records, pay and leave (read only).
    'staff.view', 'salary.view', 'leave.view',
    // Money accounts, expenses and other income.
    'finance.view', 'finance.manage',
    'payroll.view', 'payroll.manage',
  ]),

  // Class-level; scoped to own sections.
  TEACHER: new Set<Permission>([
    ...EVERYONE_IN_SCHOOL,
    'school.view', 'student.view', 'class.view',
    'attendance.student.mark', 'attendance.student.view',
    'marks.enter', 'marks.view', 'diary.post', 'diary.view', 'leave.apply',
  ]),

  // Scoped to linked children.
  PARENT: new Set<Permission>([
    ...EVERYONE_IN_SCHOOL,
    'school.view', 'student.view', 'attendance.student.view', 'fee.view', 'fee.pay', 'marks.view', 'diary.view',
    'transport.view', 'library.view', 'homework.mark',
  ]),

  // Scoped to self.
  STUDENT: new Set<Permission>([
    ...EVERYONE_IN_SCHOOL,
    'school.view', 'student.view', 'attendance.student.view', 'marks.view', 'diary.view',
    'transport.view', 'library.view', 'homework.mark',
  ]),
};

/** The role's standard permissions with the school's own changes applied. */
export function effectivePermissions(role: string, overrides?: RoleOverrides): Permission[] {
  const base = ROLE_PERMISSIONS[role as Role];
  if (!base) return [];
  const o = overrides?.[role];
  if (!o) return [...base];
  return PERMISSIONS.filter((p) => (base.has(p) && !o.revoke.has(p)) || o.grant.has(p));
}

/**
 * Does this role hold the permission in the current school? Inside a school request the
 * school's own role settings apply (loaded by `authenticate`); elsewhere the standard set.
 */
export function hasPermission(role: string, permission: Permission): boolean {
  const ctx = tenantStorage.getStore();
  // A custom role replaces its base role's list for the user who holds it.
  if (ctx?.kind === 'tenant' && ctx.custom && ctx.custom.role === role) return ctx.custom.perms.has(permission);
  const standard = ROLE_PERMISSIONS[role as Role]?.has(permission) ?? false;
  const o = ctx?.kind === 'tenant' ? ctx.roles?.[role] : undefined;
  if (!o) return standard;
  return (standard && !o.revoke.has(permission)) || o.grant.has(permission);
}

/** Allows the request if the user's role holds ANY of the listed permissions. */
export function can(...permissions: Permission[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return sendError(res, 'Unauthorized', 401);
    if (!permissions.some((p) => hasPermission(req.user!.role, p))) {
      return sendError(res, 'Forbidden: insufficient permissions', 403);
    }
    next();
  };
}

/** Role check, kept for the few places where a role (not a capability) matters. */
export function authorize(...roles: Role[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return sendError(res, 'Unauthorized', 401);
    if (!roles.includes(req.user.role as Role)) {
      return sendError(res, 'Forbidden: insufficient permissions', 403);
    }
    next();
  };
}
