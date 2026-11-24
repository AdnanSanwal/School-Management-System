'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { prefetchPage } from '@/lib/prefetch';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { useBranding } from '@/components/BrandingProvider';
import { cn } from '@/lib/utils';
import {
  X, LayoutDashboard, Users, GraduationCap, Bell, Settings, ChevronLeft, ChevronRight,
  UserCheck, Layers, Wallet, Receipt, AlertTriangle, BadgePercent, FileSpreadsheet, ClipboardCheck,
  KeyRound, School, Home, Megaphone, Send, FileQuestion, Sparkles, BookOpen, CalendarDays, PenLine, Clock, Inbox, FileBarChart, Plane,
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
      { label: 'All branches', href: '/brands', icon: Building2, roles: ['OWNER'] },
      { label: 'My children', href: '/family', icon: Home, roles: ['PARENT'] },
      { label: 'My school record', href: '/family', icon: Home, roles: ['STUDENT'] },
      { label: 'Brands & branches', href: '/platform', icon: Building2, cap: 'platform' },
      { label: 'AI for schools', href: '/platform/ai', icon: Sparkles, cap: 'platform' },
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
      { label: 'My attendance', href: '/attendance/mine', icon: CalendarCheck, cap: 'myAttendance' },
      { label: 'Attendance corrections', href: '/attendance/staff/corrections', icon: ClipboardCheck, cap: 'attendanceCorrections' },
      { label: 'Attendance rules', href: '/attendance/staff/settings', icon: SlidersHorizontal, cap: 'attendanceRules' },
      { label: 'Staff attendance', href: '/attendance/staff', icon: UserCheck, cap: 'staffAttendance' },
      { label: 'Leave', href: '/leave', icon: Plane, cap: 'applyLeave' },
      { label: 'Leave balances', href: '/hr/leave', icon: CalendarCheck, cap: 'viewLeaveBalances' },
      { label: 'Salaries', href: '/hr/salaries', icon: Banknote, cap: 'viewSalary' },
      { label: 'Payroll', href: '/payroll', icon: CircleDollarSign, cap: 'viewPayroll' },
      { label: 'Advances & loans', href: '/payroll/loans', icon: HandCoins, cap: 'viewLoans' },
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
      { label: 'Test maker', href: '/testmaker', icon: FileQuestion, cap: 'testMaker' },
      { label: 'Timetable', href: '/timetable', icon: Clock, cap: 'viewTimetable' },
      { label: 'Year-end promotion', href: '/promotions', icon: ArrowUpCircle, cap: 'promotion' },
    ],
  },
  {
    title: 'Communication',
    items: [
      { label: 'Notices', href: '/notices', icon: Megaphone, cap: 'viewNotices' },
      { label: 'Send a message', href: '/notifications/broadcasts', icon: Send, cap: 'sendBroadcasts' },
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
      { label: 'AI', href: '/settings/ai', icon: Sparkles, cap: 'manageSchool' },
      { label: 'Roles & permissions', href: '/settings/roles', icon: ShieldCheck, cap: 'manageRoles' },
      { label: 'Audit log', href: '/audit', icon: ClipboardCheck, cap: 'viewAudit' },
      { label: 'Subscription', href: '/licence', icon: BadgeCheck, roles: ['OWNER', 'ADMIN'] },
      { label: 'My account', href: '/settings', icon: Settings, roles: ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT', 'SUPER_ADMIN'] },
    ],
  },
];

// Every page renders its own DashboardLayout, so the sidebar mounts afresh on each
// navigation. Keep its scroll position and collapsed state here so they survive that.
const kept = { scrollTop: 0, collapsed: false, groups: {} as Record<string, boolean> };

export function Sidebar({ mobileOpen = false, onMobileClose }: { mobileOpen?: boolean; onMobileClose?: () => void }) {
  const pathname = usePathname();
  const brand = useBranding();
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [collapsed, setCollapsedState] = useState(kept.collapsed);
  const setCollapsed = (f: (c: boolean) => boolean) => setCollapsedState((c) => (kept.collapsed = f(c)));
  const [expandedGroups, setExpandedGroups] = useState(kept.groups);
  useEffect(() => { kept.groups = expandedGroups; }, [expandedGroups]);
  const navRef = useRef<HTMLElement>(null);

  const drawerRef = useRef<HTMLElement>(null);
  const compact = collapsed && !mobileOpen;
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const drawer = drawerRef.current;
    const controls = () => Array.from(drawer?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? []).filter(el => el.getClientRects().length > 0);
    controls()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onMobileClose?.(); }
      if (e.key === 'Tab') {
        const items = controls(); const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    const desktop = window.matchMedia('(min-width: 1024px)');
    const resized = () => { if (desktop.matches) onMobileClose?.(); };
    document.addEventListener('keydown', key); desktop.addEventListener('change', resized);
    return () => { document.removeEventListener('keydown', key); desktop.removeEventListener('change', resized); previous?.focus(); };
  }, [mobileOpen, onMobileClose]);

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

  const isActive = (href: string) => pathname === href || (pathname.startsWith(href + '/') && !allHrefs.some(h => h !== href && h.startsWith(href + '/') && pathname.startsWith(h)));
  const toggleGroup = (title: string, expanded: boolean) => {
    setExpandedGroups(previous => {
      const next = { ...previous, [title]: !expanded };
      return next;
    });
  };

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
    <>
    {mobileOpen && <button type="button" aria-label="Close navigation overlay" tabIndex={-1} onClick={onMobileClose} className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" />}
    <aside ref={drawerRef} id="erp-navigation" aria-label="Main navigation" role={mobileOpen ? 'dialog' : undefined} aria-modal={mobileOpen || undefined}
      className={cn(
        'fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col bg-white border-r border-slate-100 transition-transform duration-200 lg:relative lg:z-auto lg:translate-x-0',
        mobileOpen ? 'visible translate-x-0 shadow-xl' : 'invisible -translate-x-full lg:visible',
        collapsed ? 'lg:w-[72px]' : 'lg:w-64'
      )}

    >
      {/* Logo */}
      <div className={cn('flex items-center border-b border-slate-100 h-16 flex-shrink-0 overflow-hidden', compact ? 'px-2 justify-center' : 'px-3 gap-2.5')}>
        <div className="w-12 h-12 flex items-center justify-center flex-shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={user?.brand?.logoUrl || brand.logo} alt={user?.brand?.name || brand.name} className="w-12 h-12 object-contain" />
        </div>
        {!compact && (
          <div className="min-w-0 flex-1">
            <p title={user?.school?.name ?? brand.name} className="font-bold text-sm text-gray-900 leading-tight truncate">{user?.school?.name ?? brand.name}</p>
            <p className="text-2xs text-slate-400 font-medium truncate">{user?.brand?.name || brand.name}</p>
          </div>
        )}
      </div>

      <button type="button" onClick={onMobileClose} aria-label="Close navigation" className="absolute right-2 top-4 rounded-lg bg-white p-2 lg:hidden"><X className="h-5 w-5" /></button>
      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="hidden lg:flex absolute -right-3 top-[72px] w-6 h-6 rounded-full bg-white border border-slate-200 shadow-sm items-center justify-center hover:bg-slate-50 transition-colors z-20"
        aria-label={compact ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {compact
          ? <ChevronRight className="w-3 h-3 text-slate-500" />
          : <ChevronLeft className="w-3 h-3 text-slate-500" />
        }
      </button>

      {/* Nav */}
      <nav ref={navRef} onScroll={(e) => { kept.scrollTop = e.currentTarget.scrollTop; }} onClickCapture={(e) => { kept.scrollTop = e.currentTarget.scrollTop; }} className="flex-1 overflow-y-auto scrollbar-hide py-3 px-2">
        {dedupedGroups.map((group) => {
          const current = group.items.some(item => isActive(item.href));
          const expanded = expandedGroups[group.title] ?? (group.title === 'Overview' || current);
          const panelId = `nav-group-${group.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
          return (
          <div key={group.title} className="mb-1">
            {!compact && (
              <button type="button" aria-label={`${group.title} sections`} aria-expanded={expanded} aria-controls={panelId}
                onClick={() => toggleGroup(group.title, expanded)}
                className={cn('flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-2xs font-semibold uppercase tracking-widest transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400', current ? 'text-primary-700' : 'text-slate-500')}>
                <span>{group.title}</span>
                <ChevronRight aria-hidden="true" className={cn('h-4 w-4 shrink-0 transition-transform duration-200 motion-reduce:transition-none', expanded && 'rotate-90')} />
              </button>
            )}
            {compact && group.title !== dedupedGroups[0].title && (
              <div className="mx-3 my-1 border-t border-slate-100" />
            )}
            <div id={panelId} hidden={!compact && !expanded} className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onMobileClose}
                    onMouseEnter={() => prefetchPage(qc, item.href)}
                    onFocus={() => prefetchPage(qc, item.href)}
                    title={compact ? item.label : undefined}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'relative flex items-center rounded-xl text-sm font-medium transition-all duration-150 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/60',
                      compact ? 'px-2.5 py-2.5 justify-center' : 'px-3 py-2.5 gap-3',
                      active
                        ? 'bg-gradient-to-r from-primary-50 to-violet-50 text-primary-700 shadow-sm ring-1 ring-primary-100'
                        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                    )}
                  >
                    {active && !compact && (
                      <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-primary-500" />
                    )}
                    <Icon className={cn('flex-shrink-0 transition-colors', compact ? 'w-5 h-5' : 'w-4.5 h-4.5', active ? 'text-primary-600' : 'text-slate-400 group-hover:text-slate-600')} style={{ width: compact ? 20 : 18, height: compact ? 20 : 18 }} />
                    {!compact && (
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
          );
        })}
      </nav>

    </aside>
    </>
  );
}
