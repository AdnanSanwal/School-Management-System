import type { Role } from '@/store/authStore';

// Mirrors backend/src/middleware/rbac.ts for showing/hiding UI. The server is
// the real gatekeeper; this only avoids showing buttons that would get a 403.

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
  platform: ['SUPER_ADMIN'],
} satisfies Record<string, Role[]>;

export type Capability = keyof typeof CAN;

export function can(role: string | undefined, cap: Capability) {
  return !!role && (CAN[cap] as string[]).includes(role);
}

export const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Platform admin', OWNER: 'Owner', PRINCIPAL: 'Principal', ADMIN: 'Office admin',
  ACCOUNTANT: 'Accountant', TEACHER: 'Teacher', PARENT: 'Parent', STUDENT: 'Student',
};
