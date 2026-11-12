import { api } from '@/lib/api';
import { can, type Capability } from '@/lib/roles';
import { matchesSearch } from '@/components/ui/SearchInput';

/** CR-06: the header's global search. */
export type SearchItem = { id: string; title: string; subtitle?: string; href: string };
export type SearchGroup = { key: string; label: string; items: SearchItem[] };

export const searchAPI = {
  /** GET /search?q= — matches grouped by kind, only what this user may see. */
  all: (q: string, signal?: AbortSignal) =>
    api.get('/search', { params: { q, limit: 5 }, signal, silent: true })
      .then((r) => r.data.data as { q: string; groups: SearchGroup[] }),
};

type PageLink = { label: string; href: string; cap?: Capability; roles?: string[]; keywords?: string };

/** Screens the search can jump to (mirrors the sidebar). */
const PAGES: PageLink[] = [
  { label: 'Dashboard', href: '/dashboard', cap: 'dashboard', keywords: 'home overview' },
  { label: 'My children', href: '/family', roles: ['PARENT'], keywords: 'family fee attendance results' },
  { label: 'My school record', href: '/family', roles: ['STUDENT'], keywords: 'attendance results fee' },
  { label: 'Schools', href: '/platform', cap: 'platform' },
  { label: 'Approvals', href: '/approvals', cap: 'approvals', keywords: 'inbox requests pending' },
  { label: 'Reports', href: '/reports', cap: 'reports' },
  { label: 'Students', href: '/students', cap: 'viewStudents', keywords: 'pupils' },
  { label: 'Admit a student', href: '/students/new', cap: 'admitStudents', keywords: 'admission new student enrol' },
  { label: 'Staff', href: '/staff', cap: 'viewStaff', keywords: 'teachers employees' },
  { label: 'Staff attendance', href: '/attendance/staff', cap: 'staffAttendance' },
  { label: 'Leave', href: '/leave', cap: 'applyLeave', keywords: 'apply holiday' },
  { label: 'Leave balances', href: '/hr/leave', cap: 'viewLeaveBalances' },
  { label: 'Salaries', href: '/hr/salaries', cap: 'viewSalary', keywords: 'pay' },
  { label: 'Payroll', href: '/payroll', cap: 'viewPayroll', keywords: 'salary run' },
  { label: 'Advances & loans', href: '/payroll/loans', cap: 'viewPayroll' },
  { label: 'My payslips', href: '/payroll/my', cap: 'myPayslips', keywords: 'salary slip' },
  { label: 'HR settings', href: '/hr/settings', cap: 'manageHr' },
  { label: 'Classes', href: '/classes', cap: 'viewClasses', keywords: 'sections' },
  { label: 'Attendance', href: '/attendance', cap: 'markAttendance', keywords: 'mark present absent' },
  { label: 'Attendance today', href: '/attendance/summary', cap: 'viewAttendanceSummary' },
  { label: 'Exams & results', href: '/exams', cap: 'viewExams', keywords: 'report card' },
  { label: 'Marks entry', href: '/marks', cap: 'enterMarks' },
  { label: 'Timetable', href: '/timetable', cap: 'viewTimetable', keywords: 'schedule periods' },
  { label: 'Year-end promotion', href: '/promotions', cap: 'promotion' },
  { label: 'Notices', href: '/notices', cap: 'viewNotices', keywords: 'announcements' },
  { label: 'Daily diary', href: '/diary', cap: 'viewDiary', keywords: 'homework' },
  { label: 'Calendar', href: '/calendar', cap: 'viewCalendar', keywords: 'events holidays' },
  { label: 'Collect fee', href: '/fees', cap: 'collectFees', keywords: 'payment receive' },
  { label: 'Collections', href: '/fees/payments', cap: 'viewFees', keywords: 'payments receipts' },
  { label: 'Defaulters', href: '/fees/defaulters', cap: 'viewFees', keywords: 'overdue unpaid' },
  { label: 'Invoices', href: '/fees/invoices', cap: 'viewFees', keywords: 'vouchers challan' },
  { label: 'Concessions', href: '/fees/concessions', cap: 'viewFees', keywords: 'discount' },
  { label: 'Fee structure', href: '/fees/structure', cap: 'viewFees' },
  { label: 'Finance overview', href: '/finance', cap: 'viewFinance' },
  { label: 'Accounts', href: '/finance/accounts', cap: 'viewFinance', keywords: 'bank cash' },
  { label: 'Expenses', href: '/finance/expenses', cap: 'viewFinance', keywords: 'spending bills' },
  { label: 'Other income', href: '/finance/income', cap: 'viewFinance' },
  { label: 'Statements', href: '/accounting', cap: 'viewFinance', keywords: 'balance sheet income statement' },
  { label: 'Journal', href: '/accounting/journal', cap: 'viewFinance' },
  { label: 'Chart of accounts', href: '/accounting/chart', cap: 'viewFinance', keywords: 'ledger' },
  { label: 'Transport', href: '/transport', cap: 'viewTransport', keywords: 'bus routes van' },
  { label: 'Library', href: '/library', cap: 'viewLibrary', keywords: 'books' },
  { label: 'Notifications', href: '/notifications', roles: ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT'] },
  { label: 'Users & logins', href: '/users', cap: 'manageUsers', keywords: 'accounts passwords' },
  { label: 'School settings', href: '/settings/school', cap: 'manageSchool' },
  { label: 'Roles & permissions', href: '/settings/roles', cap: 'manageRoles' },
  { label: 'Subscription', href: '/licence', roles: ['OWNER', 'ADMIN'], keywords: 'licence billing' },
  { label: 'My account', href: '/settings', keywords: 'password profile settings' },
];

/** Screens this role may open whose name (or keywords) match the term. */
export function matchingPages(term: string, role: string | undefined, max = 5): SearchItem[] {
  if (!role) return [];
  return PAGES
    .filter((p) => (p.cap ? can(role, p.cap) : p.roles ? p.roles.includes(role) : true))
    .filter((p) => matchesSearch(term, p.label, p.keywords))
    .slice(0, max)
    .map((p) => ({ id: `page:${p.href}:${p.label}`, title: p.label, subtitle: 'Page', href: p.href }));
}
