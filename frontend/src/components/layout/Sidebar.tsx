'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { prefetchPage } from '@/lib/prefetch';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, Users, GraduationCap, Bell, Settings, ChevronLeft, ChevronRight,
  UserCheck, Layers, Wallet, Receipt, AlertTriangle, BadgePercent, FileSpreadsheet, ClipboardCheck,
  KeyRound, School, Home, Megaphone, BookOpen, CalendarDays, PenLine, Clock, Inbox, FileBarChart, Plane,
  Building2, ArrowUpCircle, Bus, Library,
  CalendarCheck, Banknote, SlidersHorizontal, PieChart, Landmark, TrendingDown, TrendingUp, HandCoins, ReceiptText, CircleDollarSign, Scale, BookText, ListTree, ShieldCheck, BadgeCheck,
} from 'lucide-react';
import { can, Capability } from '@/lib/roles';

interface NavGroup {
  title: string;
  items: NavItem[];
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  cap?: Capability;      // shown when the role has this capability
  roles?: string[];      // or when the role is listed
  badge?: string | number;
}

const navGroups: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, cap: 'dashboard' },
      { label: 'My children', href: '/family', icon: Home, roles: ['PARENT'] },
      { label: 'My school record', href: '/family', icon: Home, roles: ['STUDENT'] },
      { label: 'Schools', href: '/platform', icon: Building2, cap: 'platform' },
      { label: 'Approvals', href: '/approvals', icon: Inbox, cap: 'approvals' },
      { label: 'Reports', href: '/reports', icon: FileBarChart, cap: 'reports' },
    ],
  },
  {
    title: 'People',
    items: [
      { label: 'Students', href: '/students', icon: GraduationCap, cap: 'viewStudents' },
    ],
  },
  {
    title: 'HR',
    items: [
      { label: 'Staff', href: '/staff', icon: Users, cap: 'viewStaff' },
      { label: 'Staff attendance', href: '/attendance/staff', icon: UserCheck, cap: 'staffAttendance' },
      { label: 'Leave', href: '/leave', icon: Plane, cap: 'applyLeave' },
      { label: 'Leave balances', href: '/hr/leave', icon: CalendarCheck, cap: 'viewLeaveBalances' },
      { label: 'Salaries', href: '/hr/salaries', icon: Banknote, cap: 'viewSalary' },
      { label: 'Payroll', href: '/payroll', icon: CircleDollarSign, cap: 'viewPayroll' },
      { label: 'Advances & loans', href: '/payroll/loans', icon: HandCoins, cap: 'viewPayroll' },
      { label: 'My payslips', href: '/payroll/my', icon: ReceiptText, cap: 'myPayslips' },
      { label: 'HR settings', href: '/hr/settings', icon: SlidersHorizontal, cap: 'manageHr' },
    ],
  },
  {
    title: 'Academics',
    items: [
      { label: 'Classes', href: '/classes', icon: Layers, cap: 'viewClasses' },
      { label: 'Attendance', href: '/attendance', icon: UserCheck, cap: 'markAttendance' },
      { label: 'Attendance today', href: '/attendance/summary', icon: ClipboardCheck, cap: 'viewAttendanceSummary' },
      { label: 'Exams & results', href: '/exams', icon: GraduationCap, cap: 'viewExams' },
      { label: 'Marks entry', href: '/marks', icon: PenLine, cap: 'enterMarks' },
      { label: 'Timetable', href: '/timetable', icon: Clock, cap: 'viewTimetable' },
      { label: 'Year-end promotion', href: '/promotions', icon: ArrowUpCircle, cap: 'promotion' },
    ],
  },
  {
    title: 'Communication',
    items: [
      { label: 'Notices', href: '/notices', icon: Megaphone, cap: 'viewNotices' },
      { label: 'Daily diary', href: '/diary', icon: BookOpen, cap: 'viewDiary' },
      { label: 'Calendar', href: '/calendar', icon: CalendarDays, cap: 'viewCalendar' },
    ],
  },
  {
    title: 'Fees',
    items: [
      { label: 'Collect fee', href: '/fees', icon: Wallet, cap: 'collectFees' },
      { label: 'Collections', href: '/fees/payments', icon: Receipt, cap: 'viewFees' },
      { label: 'Defaulters', href: '/fees/defaulters', icon: AlertTriangle, cap: 'viewFees' },
      { label: 'Invoices', href: '/fees/invoices', icon: FileSpreadsheet, cap: 'viewFees' },
      { label: 'Concessions', href: '/fees/concessions', icon: BadgePercent, cap: 'viewFees' },
      { label: 'Fee structure', href: '/fees/structure', icon: Layers, cap: 'viewFees' },
    ],
  },
  {
    title: 'Finance',
    items: [
      { label: 'Finance overview', href: '/finance', icon: PieChart, cap: 'viewFinance' },
      { label: 'Accounts', href: '/finance/accounts', icon: Landmark, cap: 'viewFinance' },
      { label: 'Expenses', href: '/finance/expenses', icon: TrendingDown, cap: 'viewFinance' },
      { label: 'Other income', href: '/finance/income', icon: TrendingUp, cap: 'viewFinance' },
      { label: 'Statements', href: '/accounting', icon: Scale, cap: 'viewFinance' },
      { label: 'Journal', href: '/accounting/journal', icon: BookText, cap: 'viewFinance' },
      { label: 'Chart of accounts', href: '/accounting/chart', icon: ListTree, cap: 'viewFinance' },
    ],
  },
  {
    title: 'Facilities',
    items: [
      { label: 'Transport', href: '/transport', icon: Bus, cap: 'viewTransport' },
      { label: 'Library', href: '/library', icon: Library, cap: 'viewLibrary' },
    ],
  },
  {
    title: 'System',
    items: [
      { label: 'Notifications', href: '/notifications', icon: Bell, roles: ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT'] },
      { label: 'Users & logins', href: '/users', icon: KeyRound, cap: 'manageUsers' },
      { label: 'School settings', href: '/settings/school', icon: School, cap: 'manageSchool' },
      { label: 'Roles & permissions', href: '/settings/roles', icon: ShieldCheck, cap: 'manageRoles' },
      { label: 'Subscription', href: '/licence', icon: BadgeCheck, roles: ['OWNER', 'ADMIN'] },
      { label: 'My account', href: '/settings', icon: Settings, roles: ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT', 'SUPER_ADMIN'] },
    ],
  },
];

// Every page renders its own DashboardLayout, so the sidebar mounts afresh on each
// navigation. Keep its scroll position and collapsed state here so they survive that.
const kept = { scrollTop: 0, collapsed: false };

export function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [collapsed, setCollapsedState] = useState(kept.collapsed);
  const setCollapsed = (f: (c: boolean) => boolean) => setCollapsedState((c) => (kept.collapsed = f(c)));
  const navRef = useRef<HTMLElement>(null);

  const role = user?.role || '';

  const visibleGroups = navGroups
    .map(group => ({
      ...group,
      items: group.items.filter((item, idx, arr) => {
        if (!user) return false;
        if (!(item.cap ? can(role, item.cap) : item.roles?.includes(role))) return false;
        return arr.findIndex(i => i.label === item.label) === idx;
      }),
    }))
    .filter(g => g.items.length > 0);

  // Deduplicate Dashboard across groups
  const seenLabels = new Set<string>();
  const dedupedGroups = visibleGroups.map(group => ({
    ...group,
    items: group.items.filter(item => {
      if (seenLabels.has(item.label)) return false;
      seenLabels.add(item.label);
      return true;
    }),
  })).filter(g => g.items.length > 0);

  const allHrefs = dedupedGroups.flatMap((g) => g.items.map((i) => i.href));

  // Put the menu back where the user left it, before the browser paints.
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav || allHrefs.length === 0) return;
    nav.scrollTop = kept.scrollTop;
    // If the open page's link is out of view (e.g. reached from elsewhere), bring it in.
    const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
    if (active) {
      const a = active.getBoundingClientRect(), n = nav.getBoundingClientRect();
      if (a.top < n.top || a.bottom > n.bottom) active.scrollIntoView({ block: 'nearest' });
    }
    // Re-run once the links exist: on the first render the signed-in user may not be loaded yet.
  }, [pathname, allHrefs.length]);

  return (
    <aside
      className={cn(
        'relative flex flex-col bg-white border-r border-slate-100 transition-all duration-300 ease-in-out',
        collapsed ? 'w-[72px]' : 'w-64'
      )}
      style={{ minHeight: '100vh' }}
    >
      {/* Logo */}
      <div className={cn('flex items-center border-b border-slate-100 h-16 flex-shrink-0 overflow-hidden', collapsed ? 'px-4 justify-center' : 'px-5 gap-3')}>
        <div className="w-9 h-9 rounded-xl gradient-primary flex items-center justify-center flex-shrink-0 shadow-sm">
          <GraduationCap className="w-5 h-5 text-white" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="font-bold text-sm text-gray-900 leading-tight truncate">{user?.school?.name ?? 'School ERP'}</p>
            <p className="text-2xs text-slate-400 font-medium">School ERP</p>
          </div>
        )}
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="absolute -right-3 top-[72px] w-6 h-6 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center hover:bg-slate-50 transition-colors z-20"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed
          ? <ChevronRight className="w-3 h-3 text-slate-500" />
          : <ChevronLeft className="w-3 h-3 text-slate-500" />
        }
      </button>

      {/* Nav */}
      <nav ref={navRef} onScroll={(e) => { kept.scrollTop = e.currentTarget.scrollTop; }} onClickCapture={(e) => { kept.scrollTop = e.currentTarget.scrollTop; }} className="flex-1 overflow-y-auto scrollbar-hide py-3 px-2">
        {dedupedGroups.map((group) => (
          <div key={group.title} className="mb-1">
            {!collapsed && (
              <p className="px-3 py-1.5 text-2xs font-semibold text-slate-400 uppercase tracking-widest">
                {group.title}
              </p>
            )}
            {collapsed && group.title !== dedupedGroups[0].title && (
              <div className="mx-3 my-1 border-t border-slate-100" />
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = pathname === item.href || (pathname.startsWith(item.href + '/') && !allHrefs.some((h) => h !== item.href && h.startsWith(item.href + '/') && pathname.startsWith(h)));
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onMouseEnter={() => prefetchPage(qc, item.href)}
                    onFocus={() => prefetchPage(qc, item.href)}
                    title={collapsed ? item.label : undefined}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'relative flex items-center rounded-xl text-sm font-medium transition-all duration-150 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/60',
                      collapsed ? 'px-2.5 py-2.5 justify-center' : 'px-3 py-2.5 gap-3',
                      active
                        ? 'bg-gradient-to-r from-primary-50 to-violet-50 text-primary-700 shadow-sm ring-1 ring-primary-100'
                        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                    )}
                  >
                    {active && !collapsed && (
                      <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-primary-500" />
                    )}
                    <Icon className={cn('flex-shrink-0 transition-colors', collapsed ? 'w-5 h-5' : 'w-4.5 h-4.5', active ? 'text-primary-600' : 'text-slate-400 group-hover:text-slate-600')} style={{ width: collapsed ? 20 : 18, height: collapsed ? 20 : 18 }} />
                    {!collapsed && (
                      <>
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.badge && (
                          <span className="ml-auto w-5 h-5 rounded-full bg-primary-100 text-primary-700 text-2xs font-bold flex items-center justify-center">
                            {item.badge}
                          </span>
                        )}
                        {active && <div className="w-1.5 h-1.5 rounded-full bg-primary-500 flex-shrink-0" />}
                      </>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

    </aside>
  );
}
