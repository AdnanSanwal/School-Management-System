import type { Role } from '@prisma/client';
import { basePrisma } from '../config/database';
import type { RoleOverrides } from '../config/tenancy';
import { effectivePermissions, Permission, PERMISSIONS, ROLE_PERMISSIONS } from '../middleware/rbac';

// Each school can tune what its roles may do. Only the differences from the standard
// set are stored (RolePermission rows); they are read once per school and kept for a few
// seconds, so a request costs no extra query and a change reaches every server quickly.
// The same rows also hold which logins a role may create ("create:<ROLE>", see utils/accounts.ts).

/** Staff roles: the owner can add to and take from their permissions. */
export const CUSTOM_ROLES: Role[] = ['PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER'];
/** Parent and student: they only ever see their own data; a few parts of the app can be switched. */
export const FAMILY_ROLES: Role[] = ['PARENT', 'STUDENT'];
export const EDITABLE_ROLES: Role[] = [...CUSTOM_ROLES, ...FAMILY_ROLES];

type Info = { module: string; label: string };

/** What each permission means for staff, grouped the way the settings screen shows it. */
export const PERMISSION_INFO: Partial<Record<Permission, Info>> = {
  'student.view': { module: 'Students', label: 'See students' },
  'student.manage': { module: 'Students', label: 'Edit student records' },
  'student.admit': { module: 'Students', label: 'Admit new students' },
  'student.fee.set': { module: 'Students', label: 'Set a student’s own monthly fee' },
  'student.status.request': { module: 'Students', label: 'Ask to withdraw or transfer a student' },
  'student.status.approve': { module: 'Students', label: 'Approve withdrawals and transfers' },
  'promotion.run': { module: 'Students', label: 'Run year-end promotion' },

  'class.view': { module: 'Classes & timetable', label: 'See classes and sections' },
  'class.manage': { module: 'Classes & timetable', label: 'Add and edit classes, sections and subjects' },
  'timetable.manage': { module: 'Classes & timetable', label: 'Build the timetable' },
  'timetable.approve': { module: 'Classes & timetable', label: 'Approve the timetable' },
  'calendar.manage': { module: 'Classes & timetable', label: 'Manage holidays and events' },

  'attendance.student.view': { module: 'Attendance', label: 'See student attendance' },
  'attendance.student.mark': { module: 'Attendance', label: 'Mark student attendance' },
  'attendance.student.correct': { module: 'Attendance', label: 'Correct past student attendance' },
  'attendance.staff.view': { module: 'Attendance', label: 'See staff attendance' },
  'attendance.staff.mark': { module: 'Attendance', label: 'Mark staff attendance' },

  'exam.manage': { module: 'Exams', label: 'Create exams and date sheets' },
  'exam.approve': { module: 'Exams', label: 'Approve and publish results' },
  'marks.view': { module: 'Exams', label: 'See marks and results' },
  'marks.enter': { module: 'Exams', label: 'Enter marks' },
  'reportcard.generate': { module: 'Exams', label: 'Generate report cards' },

  'diary.view': { module: 'Communication', label: 'See the class diary' },
  'diary.post': { module: 'Communication', label: 'Post diary and homework' },
  'notice.publish': { module: 'Communication', label: 'Publish notices' },
  'message.broadcast': { module: 'Communication', label: 'Send messages to parents and staff' },

  'fee.view': { module: 'Fees', label: 'See invoices, payments and defaulters' },
  'fee.collect': { module: 'Fees', label: 'Collect fees' },
  'fee.invoice.generate': { module: 'Fees', label: 'Generate monthly invoices' },
  'fee.structure.view': { module: 'Fees', label: 'See the fee structure' },
  'fee.structure.manage': { module: 'Fees', label: 'Change the fee structure' },
  'fee.concession.request': { module: 'Fees', label: 'Ask for a concession' },
  'fee.concession.approve': { module: 'Fees', label: 'Approve concessions' },

  'finance.view': { module: 'Finance & accounting', label: 'See accounts, expenses, income and statements' },
  'finance.manage': { module: 'Finance & accounting', label: 'Record expenses, income, transfers and journal entries; close months' },
  'expense.approve': { module: 'Finance & accounting', label: 'Approve large expenses and set the approval limit' },
  'books.reopen': { module: 'Finance & accounting', label: 'Reopen a closed month' },

  'staff.view': { module: 'HR & payroll', label: 'See staff records' },
  'staff.manage': { module: 'HR & payroll', label: 'Add and edit staff' },
  'hr.manage': { module: 'HR & payroll', label: 'Manage departments, designations and leave allowances' },
  'salary.view': { module: 'HR & payroll', label: 'See salaries' },
  'salary.manage': { module: 'HR & payroll', label: 'Set salaries' },
  'leave.apply': { module: 'HR & payroll', label: 'Apply for own leave' },
  'leave.view': { module: 'HR & payroll', label: 'See everyone’s leave' },
  'leave.approve': { module: 'HR & payroll', label: 'Approve leave' },
  'payroll.view': { module: 'HR & payroll', label: 'See payroll, advances and loans' },
  'payroll.manage': { module: 'HR & payroll', label: 'Prepare and pay payroll; give advances and loans' },
  'payroll.approve': { module: 'HR & payroll', label: 'Approve payroll' },

  'transport.view': { module: 'Facilities', label: 'See transport routes' },
  'transport.manage': { module: 'Facilities', label: 'Manage transport' },
  'library.view': { module: 'Facilities', label: 'See the library' },
  'library.manage': { module: 'Facilities', label: 'Manage books and issue / return' },

  'reports.academic': { module: 'Reports', label: 'Academic reports' },
  'reports.attendance': { module: 'Reports', label: 'Attendance reports' },
  'reports.finance': { module: 'Reports', label: 'Fee and finance reports' },
  'audit.view': { module: 'Reports', label: 'See the activity log (who changed what)' },

  'school.manage': { module: 'Administration', label: 'Change school settings' },
};

/** The same permissions in a parent's or student's words: always about their own child / themselves. */
const FAMILY_INFO: Partial<Record<Permission, Info>> = {
  'student.view': { module: 'In the app', label: 'See the profile and class' },
  'attendance.student.view': { module: 'In the app', label: 'See attendance' },
  'diary.view': { module: 'In the app', label: 'See the diary and homework' },
  'homework.mark': { module: 'In the app', label: 'Tick homework as done' },
  'marks.view': { module: 'In the app', label: 'See marks, results and report cards' },
  'fee.view': { module: 'Fees', label: 'See fee invoices and receipts' },
  'fee.pay': { module: 'Fees', label: 'Pay fees online' },
  'transport.view': { module: 'Facilities', label: 'See the school transport' },
  'library.view': { module: 'Facilities', label: 'See library books' },
};
/** The parts a school can switch for parents and students; everything else of theirs is fixed. */
const FAMILY_SWITCHES: Record<string, Permission[]> = {
  PARENT: ['fee.view', 'fee.pay', 'homework.mark', 'transport.view', 'library.view'],
  STUDENT: ['fee.view', 'homework.mark', 'transport.view', 'library.view'],
};

/** Approvals exist so a second person checks the work; they can be handed only to the principal. */
const SENIOR_ONLY: Permission[] = ['expense.approve', 'payroll.approve', 'books.reopen', 'student.status.approve', 'fee.concession.approve', 'exam.approve', 'timetable.approve'];
/** Teachers work inside their own classes, so only a few school-wide jobs can be added to them. */
const TEACHER_EXTRAS: Permission[] = ['notice.publish', 'calendar.manage', 'library.view', 'library.manage'];

const isFamily = (role: Role) => FAMILY_ROLES.includes(role);

/** The permissions listed for a role on the settings screen, with their wording. */
export function permissionList(role: Role): { key: Permission; module: string; label: string }[] {
  const info = isFamily(role) ? FAMILY_INFO : PERMISSION_INFO;
  return PERMISSIONS.filter((p) => info[p]).map((p) => ({ key: p, ...info[p]! }));
}

/** Can the school switch this permission on for the role (beyond its standard set)? */
export function grantable(role: Role, permission: Permission): boolean {
  if (isFamily(role)) return FAMILY_SWITCHES[role].includes(permission);
  if (!CUSTOM_ROLES.includes(role) || !PERMISSION_INFO[permission]) return false;
  if (ROLE_PERMISSIONS[role].has(permission)) return true;
  if (role === 'TEACHER') return TEACHER_EXTRAS.includes(permission);
  if (SENIOR_ONLY.includes(permission)) return role === 'PRINCIPAL';
  return true;
}

/** Can the school change this permission for the role at all (on or off)? */
export function changeable(role: Role, permission: Permission): boolean {
  if (isFamily(role)) return FAMILY_SWITCHES[role].includes(permission);
  return ROLE_PERMISSIONS[role].has(permission) ? !!PERMISSION_INFO[permission] : grantable(role, permission);
}

const TTL_MS = 10_000;
const cache = new Map<string, { at: number; roles: RoleOverrides }>();

export async function roleOverrides(schoolId: string): Promise<RoleOverrides> {
  const hit = cache.get(schoolId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.roles;
  const rows = await basePrisma.rolePermission.findMany({ where: { schoolId }, select: { role: true, permission: true, granted: true } });
  const roles: RoleOverrides = {};
  for (const r of rows ?? []) {
    const o = (roles[r.role] ??= { grant: new Set(), revoke: new Set() });
    (r.granted ? o.grant : o.revoke).add(r.permission);
  }
  cache.set(schoolId, { at: Date.now(), roles });
  return roles;
}

export const forgetRoleOverrides = (schoolId: string) => { cache.delete(schoolId); };

/** Everything a user of this role may do in this school. */
export async function permissionsFor(role: string, schoolId?: string | null): Promise<Permission[]> {
  return effectivePermissions(role, schoolId ? await roleOverrides(schoolId) : undefined);
}
