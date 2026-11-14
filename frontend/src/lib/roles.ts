import { useAuthStore, type Role } from '@/store/authStore';

// Decides what to show. The server is the real gatekeeper; this only avoids showing
// screens and buttons that would get a 403.
//  - CAN lists the roles that have each capability as standard.
//  - A school can tune its staff roles (Settings → Roles & permissions). For those roles the
//    user's own permission list (sent by the server) decides, through CAP_PERMISSIONS.

export const OFFICE: Role[] = ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT'];

export const CAN = {
  dashboard: ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT'],
  viewStudents: ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER'],
  manageStudents: ['PRINCIPAL', 'ADMIN'],
  // CR-04: accountants may admit students and set their monthly fee (not edit them).
  admitStudents: ['PRINCIPAL', 'ADMIN', 'ACCOUNTANT'],
  setStudentFee: ['ADMIN', 'ACCOUNTANT'],
  viewStaff: ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT'],
  manageStaff: ['PRINCIPAL', 'ADMIN'],
  // HR: lists and leave policy; who may see and set salaries.
  manageHr: ['ADMIN'],
  viewSalary: ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT'],
  manageSalary: ['ADMIN'],
  viewLeaveBalances: ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT'],
  // Finance: money accounts, expenses, other income.
  viewFinance: ['OWNER', 'PRINCIPAL', 'ACCOUNTANT'],
  manageFinance: ['ACCOUNTANT'],
  approveExpense: ['OWNER'],
  // Payroll: accountant prepares and pays, owner approves; staff see their own payslips.
  viewPayroll: ['OWNER', 'PRINCIPAL', 'ACCOUNTANT'],
  viewLoans: ['OWNER', 'PRINCIPAL', 'ACCOUNTANT'],
  approveLoan: ['OWNER'],
  configureDiary: ['OWNER', 'PRINCIPAL'],
  managePayroll: ['ACCOUNTANT'],
  approvePayroll: ['OWNER'],
  myPayslips: ['TEACHER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT'],
  viewClasses: ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER'],
  manageClasses: ['PRINCIPAL', 'ADMIN'],
  markAttendance: ['TEACHER', 'PRINCIPAL', 'ADMIN'],
  viewAttendanceSummary: ['OWNER', 'PRINCIPAL', 'ADMIN'],
  staffAttendance: ['OWNER', 'PRINCIPAL', 'ADMIN'],
  markStaffAttendance: ['PRINCIPAL', 'ADMIN'],
  viewFees: ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT'],
  collectFees: ['ADMIN', 'ACCOUNTANT'],
  manageFeeStructure: ['ADMIN'],
  generateInvoices: ['ADMIN', 'ACCOUNTANT'],
  requestConcession: ['ADMIN', 'ACCOUNTANT'],
  approveConcession: ['PRINCIPAL'],
  manageUsers: ['OWNER', 'PRINCIPAL', 'ADMIN'],
  manageSchool: ['OWNER', 'ADMIN'],
  viewNotices: ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT'],
  publishNotices: ['PRINCIPAL', 'ADMIN'],
  viewDiary: ['OWNER', 'PRINCIPAL', 'TEACHER'],
  postDiary: ['TEACHER'],
  viewCalendar: ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT'],
  manageCalendar: ['PRINCIPAL', 'ADMIN'],
  sendFeeReminders: ['ADMIN', 'ACCOUNTANT'],
  viewExams: ['OWNER', 'PRINCIPAL', 'ADMIN', 'TEACHER'],
  manageExams: ['PRINCIPAL', 'ADMIN'],
  approveExams: ['PRINCIPAL'],
  enterMarks: ['TEACHER', 'PRINCIPAL', 'ADMIN'],
  viewResults: ['OWNER', 'PRINCIPAL', 'ADMIN', 'TEACHER'],
  viewTimetable: ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER'],
  manageTimetable: ['PRINCIPAL', 'ADMIN'],
  applyLeave: ['TEACHER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT'],
  approvals: ['PRINCIPAL', 'ADMIN', 'ACCOUNTANT'],
  reports: ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER'],
  waiveFine: ['PRINCIPAL'],
  applyFines: ['ADMIN', 'ACCOUNTANT'],
  lowAttendanceAlerts: ['PRINCIPAL', 'ADMIN'],
  promotion: ['PRINCIPAL', 'ADMIN'],
  viewTransport: ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT'],
  manageTransport: ['PRINCIPAL', 'ADMIN'],
  viewLibrary: ['OWNER', 'PRINCIPAL', 'ADMIN'],
  manageLibrary: ['PRINCIPAL', 'ADMIN'],
  manageRoles: ['OWNER'],
  viewAudit: ['OWNER', 'PRINCIPAL'],
  platform: ['SUPER_ADMIN'],
} satisfies Record<string, Role[]>;

export type Capability = keyof typeof CAN;

/**
 * The server permission(s) behind a capability (any one is enough). Capabilities not listed
 * here always follow the role. For the four staff roles and the standard permission sets
 * this gives exactly the same answer as CAN.
 */
const CAP_PERMISSIONS: Partial<Record<Capability, string[]>> = {
  viewAudit: ['audit.view'],
  viewLoans: ['payroll.view','loan.approve'], approveLoan: ['loan.approve'], configureDiary: ['diary.configure'],
  viewStudents: ['student.view'], manageStudents: ['student.manage'], admitStudents: ['student.admit'], setStudentFee: ['student.fee.set'],
  viewStaff: ['staff.view'], manageStaff: ['staff.manage'], manageHr: ['hr.manage'], viewSalary: ['salary.view'], manageSalary: ['salary.manage'],
  viewLeaveBalances: ['leave.view'], applyLeave: ['leave.apply'],
  viewFinance: ['finance.view'], manageFinance: ['finance.manage'], approveExpense: ['expense.approve'],
  viewPayroll: ['payroll.view'], managePayroll: ['payroll.manage'], approvePayroll: ['payroll.approve'],
  viewClasses: ['class.view'], manageClasses: ['class.manage'],
  markAttendance: ['attendance.student.mark', 'attendance.student.correct'],
  staffAttendance: ['attendance.staff.view'], markStaffAttendance: ['attendance.staff.mark'],
  viewFees: ['fee.view'], collectFees: ['fee.collect'], manageFeeStructure: ['fee.structure.manage'], generateInvoices: ['fee.invoice.generate'],
  requestConcession: ['fee.concession.request'], approveConcession: ['fee.concession.approve'], sendFeeReminders: ['fee.collect', 'fee.invoice.generate'],
  manageUsers: ['users.manage'], manageSchool: ['school.manage'],
  publishNotices: ['notice.publish'], viewDiary: ['diary.view'], postDiary: ['diary.post'], manageCalendar: ['calendar.manage'],
  manageExams: ['exam.manage'], approveExams: ['exam.approve'], enterMarks: ['marks.enter', 'exam.manage'], viewResults: ['marks.view', 'exam.manage'],
  manageTimetable: ['timetable.manage'], promotion: ['promotion.run'],
  approvals: ['leave.approve', 'fee.concession.approve', 'fee.collect'], waiveFine: ['fee.concession.approve'],
  applyFines: ['fee.invoice.generate'], lowAttendanceAlerts: ['attendance.student.correct'],
  viewTransport: ['transport.view'], manageTransport: ['transport.manage'], viewLibrary: ['library.view'], manageLibrary: ['library.manage'],
};
/** Roles whose menus follow the server's permission list: the staff roles a school can tune, and the owner (full rights). */
const TUNED_ROLES = ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER'];

// Each list remembers its capability, so `allowedRoles={CAN.viewFees}` can follow the school's settings too.
for (const [cap, roles] of Object.entries(CAN)) Object.defineProperty(roles, 'capability', { value: cap, enumerable: false });

export function can(role: string | undefined, cap: Capability) {
  if (!role) return false;
  const need = CAP_PERMISSIONS[cap];
  const own = useAuthStore.getState().user?.permissions;
  if (need && own && TUNED_ROLES.includes(role)) return need.some((p) => own.includes(p));
  return (CAN[cap] as string[]).includes(role);
}

/** May this role open a page limited to `roles` (normally one of the CAN lists)? */
export function allowedIn(roles: string[], role: string) {
  const cap = (roles as { capability?: Capability }).capability;
  return cap ? can(role, cap) : roles.includes(role);
}

export const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Platform admin', OWNER: 'Owner', PRINCIPAL: 'Principal', ADMIN: 'Office admin',
  ACCOUNTANT: 'Accountant', TEACHER: 'Teacher', PARENT: 'Parent', STUDENT: 'Student',
};

/**
 * The school's own roles (e.g. Receptionist) that this user may give out, for a role picker.
 * Each option's value is "BASE:<id>" — `splitRole` turns it back into role + customRoleId.
 */
export function customRoleOptions(baseRoles: string[]): string[][] {
  const list = useAuthStore.getState().user?.customRoles ?? [];
  return list.filter((r) => baseRoles.includes(r.baseRole)).map((r) => [`${r.baseRole}:${r.id}`, `${r.name} (${ROLE_LABEL[r.baseRole] ?? r.baseRole} access)`]);
}

export function splitRole(value: string): { role: string; customRoleId: string | null } {
  const [role, customRoleId] = value.split(':');
  return { role, customRoleId: customRoleId || null };
}

/** How to show a user's role: their custom role's name if they have one. */
export function roleName(u: { role: string; customRole?: { name: string } | null }) {
  return u.customRole?.name ?? ROLE_LABEL[u.role] ?? u.role;
}
