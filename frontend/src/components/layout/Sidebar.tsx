'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, Users, GraduationCap, Bell, Settings, LogOut, ChevronLeft, ChevronRight,
  UserCheck, Layers, Wallet, Receipt, AlertTriangle, BadgePercent, FileSpreadsheet, ClipboardCheck,
  KeyRound, School, Home, Megaphone, BookOpen, CalendarDays,
} from 'lucide-react';
import { can, Capability, ROLE_LABEL } from '@/lib/roles';

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
      { label: 'My children', href: '/family', icon: Home, roles: ['PARENT', 'STUDENT'] },
    ],
  },
  {
    title: 'People',
    items: [
      { label: 'Students', href: '/students', icon: GraduationCap, cap: 'viewStudents' },
      { label: 'Staff', href: '/staff', icon: Users, cap: 'viewStaff' },
    ],
  },
  {
    title: 'Academics',
    items: [
      { label: 'Classes', href: '/classes', icon: Layers, cap: 'viewClasses' },
      { label: 'Attendance', href: '/attendance', icon: UserCheck, cap: 'markAttendance' },
      { label: 'Attendance today', href: '/attendance/summary', icon: ClipboardCheck, cap: 'viewAttendanceSummary' },
      { label: 'Staff attendance', href: '/attendance/staff', icon: UserCheck, cap: 'staffAttendance' },
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
    title: 'Finance',
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
    title: 'System',
    items: [
      { label: 'Notifications', href: '/notifications', icon: Bell, roles: ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT'] },
      { label: 'Users & logins', href: '/users', icon: KeyRound, cap: 'manageUsers' },
      { label: 'School settings', href: '/settings/school', icon: School, cap: 'manageSchool' },
      { label: 'My account', href: '/settings', icon: Settings, roles: ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT', 'SUPER_ADMIN'] },
    ],
  },
];

const ROLE_COLORS: Record<string, { color: string; bg: string }> = {
  OWNER: { color: 'text-amber-700', bg: 'bg-amber-50' },
  PRINCIPAL: { color: 'text-violet-700', bg: 'bg-violet-50' },
  ADMIN: { color: 'text-indigo-700', bg: 'bg-indigo-50' },
  ACCOUNTANT: { color: 'text-emerald-700', bg: 'bg-emerald-50' },
  TEACHER: { color: 'text-blue-700', bg: 'bg-blue-50' },
  STUDENT: { color: 'text-green-700', bg: 'bg-green-50' },
  PARENT: { color: 'text-orange-700', bg: 'bg-orange-50' },
};

export function Sidebar() {
  const pathname = usePathname();
  const { user, clearAuth } = useAuthStore();
  const [collapsed, setCollapsed] = useState(false);

  const role = user?.role || '';
  const roleMeta = { label: ROLE_LABEL[role] ?? role, ...(ROLE_COLORS[role] ?? { color: 'text-gray-600', bg: 'bg-gray-100' }) };

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
      <nav className="flex-1 overflow-y-auto scrollbar-hide py-3 px-2">
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

      {/* User footer */}
      <div className="flex-shrink-0 border-t border-slate-100 p-3">
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-primary-100 flex items-center justify-center text-sm font-bold text-primary-700">
              {user?.name?.[0]?.toUpperCase()}
            </div>
            <button onClick={clearAuth} className="p-2 rounded-xl text-red-400 hover:bg-red-50 transition-colors">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer">
              <div className="w-9 h-9 rounded-xl bg-primary-100 flex items-center justify-center text-sm font-bold text-primary-700 flex-shrink-0">
                {user?.name?.[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{user?.name}</p>
                <span className={cn('text-2xs font-semibold px-1.5 py-0.5 rounded-full', roleMeta.bg, roleMeta.color)}>
                  {roleMeta.label}
                </span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />
            </div>
            <button
              onClick={clearAuth}
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-sm text-slate-500 hover:bg-red-50 hover:text-red-600 transition-all duration-150 mt-1"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign out</span>
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
