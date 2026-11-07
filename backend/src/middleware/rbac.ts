import { Response, NextFunction } from 'express';
import type { Role } from '@prisma/client';
import { AuthRequest } from './auth';
import { sendError } from '../utils/apiResponse';

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
  'student.view', 'student.manage', 'student.status.request', 'student.status.approve',
  'staff.view', 'staff.manage',
  'class.view', 'class.manage',
  'attendance.student.mark', 'attendance.student.view', 'attendance.student.correct',
  'attendance.staff.mark', 'attendance.staff.view',
  'leave.apply', 'leave.view', 'leave.approve',
  'fee.view', 'fee.structure.view', 'fee.structure.manage', 'fee.invoice.generate', 'fee.collect',
  'fee.concession.request', 'fee.concession.approve',
  'exam.view', 'exam.manage', 'exam.approve', 'marks.enter', 'marks.view', 'reportcard.generate',
  'diary.view', 'diary.post',
  'timetable.view', 'timetable.manage', 'timetable.approve',
  'calendar.view', 'calendar.manage',
  'notice.view', 'notice.publish', 'message.broadcast',
  'reports.finance', 'reports.attendance', 'reports.academic',
  'platform.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const EVERYONE_IN_SCHOOL: Permission[] = ['notice.view', 'calendar.view', 'timetable.view', 'exam.view'];

const READ_ALL: Permission[] = [
  'school.view', 'student.view', 'staff.view', 'class.view', 'attendance.student.view',
  'attendance.staff.view', 'leave.view', 'fee.view', 'fee.structure.view', 'marks.view', 'diary.view',
];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  SUPER_ADMIN: new Set<Permission>(['platform.manage']),

  // Business owner: sees everything, reports; no day-to-day entry.
  OWNER: new Set<Permission>([
    ...EVERYONE_IN_SCHOOL, ...READ_ALL,
    'school.manage', 'users.manage', 'dashboard.owner',
    'reports.finance', 'reports.attendance', 'reports.academic',
  ]),

  // Academic + administrative head; approvals. No fee collection or fee-structure edits.
  PRINCIPAL: new Set<Permission>([
    ...EVERYONE_IN_SCHOOL, ...READ_ALL,
    'users.manage', 'dashboard.principal',
    'student.manage', 'student.status.request', 'student.status.approve',
    'staff.manage', 'class.manage',
    'attendance.student.correct', 'attendance.staff.mark',
    'leave.apply', 'leave.approve',
    'fee.concession.approve',
    'exam.manage', 'exam.approve', 'reportcard.generate',
    'timetable.manage', 'timetable.approve', 'calendar.manage',
    'notice.publish', 'message.broadcast',
    'reports.finance', 'reports.attendance', 'reports.academic',
  ]),

  // Office staff: admissions, records, fee entry, notices.
  ADMIN: new Set<Permission>([
    ...EVERYONE_IN_SCHOOL,
    'school.view', 'school.manage', 'users.manage', 'dashboard.admin',
    'student.view', 'student.manage', 'student.status.request',
    'staff.view', 'staff.manage', 'class.view', 'class.manage',
    'attendance.student.view', 'attendance.student.correct',
    'attendance.staff.mark', 'attendance.staff.view',
    'fee.view', 'fee.structure.view', 'fee.structure.manage', 'fee.invoice.generate', 'fee.collect',
    'fee.concession.request',
    'exam.manage', 'timetable.manage', 'calendar.manage', 'notice.publish',
    'reports.finance', 'reports.attendance',
  ]),

  // Finance only.
  ACCOUNTANT: new Set<Permission>([
    ...EVERYONE_IN_SCHOOL,
    'school.view', 'dashboard.accountant', 'student.view', 'class.view',
    'fee.view', 'fee.structure.view', 'fee.invoice.generate', 'fee.collect', 'fee.concession.request',
    'reports.finance', 'leave.apply',
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
    'school.view', 'student.view', 'attendance.student.view', 'fee.view', 'marks.view', 'diary.view',
  ]),

  // Scoped to self.
  STUDENT: new Set<Permission>([
    ...EVERYONE_IN_SCHOOL,
    'school.view', 'student.view', 'attendance.student.view', 'marks.view', 'diary.view',
  ]),
};

export function hasPermission(role: string, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role as Role]?.has(permission) ?? false;
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
