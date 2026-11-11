'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useAuthStore } from '@/store/authStore';
import { useQuery } from '@tanstack/react-query';
import { authAPI } from '@/lib/api';
import { allowedIn } from '@/lib/roles';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { formatDate } from '@/lib/utils';

/**
 * Keeps the signed-in user's details fresh (name, school, and what they may do), so a change
 * the owner makes to a role reaches people who are already signed in.
 */
function useSessionRefresh() {
  const signedIn = useAuthStore((s) => !!s.accessToken && !!s.user && !s.user.mustChangePassword);
  const { data } = useQuery({ queryKey: ['session'], queryFn: authAPI.me, enabled: signedIn, staleTime: 60_000, refetchInterval: 5 * 60_000, meta: { quiet: true } });
  useEffect(() => {
    const current = useAuthStore.getState().user;
    if (!data || !current || data.id !== current.id) return;
    const next = { ...current, ...data };
    if (JSON.stringify(next) !== JSON.stringify(current)) useAuthStore.setState({ user: next });
  }, [data]);
}

/** Tells the people who run the school when the subscription is about to end or has ended. */
function LicenceBanner() {
  const user = useAuthStore((s) => s.user);
  const l = user?.licence;
  if (!l || !user || !['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT'].includes(user.role)) return null;
  if (l.state !== 'DUE_SOON' && l.state !== 'GRACE') return null;
  const grace = l.state === 'GRACE';
  return (
    <Link href="/licence" className={`flex items-center justify-center gap-2 px-4 py-2 text-sm print:hidden ${grace ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-amber-100 text-amber-900 hover:bg-amber-200'}`}>
      <AlertTriangle className="h-4 w-4 flex-shrink-0" />
      <span>{grace
        ? <>The subscription ended on {formatDate(l.paidUntil!)}. The system will lock on <b>{formatDate(l.lockDate!)}</b> unless it is renewed.</>
        : <>The subscription ends {l.daysLeft === 0 ? 'today' : <>on <b>{formatDate(l.paidUntil!)}</b> ({l.daysLeft} day{l.daysLeft === 1 ? '' : 's'} left)</>}. Please renew it in time.</>}</span>
      <span className="underline">Details</span>
    </Link>
  );
}

interface DashboardLayoutProps {
  children: React.ReactNode;
  title: string;
  allowedRoles?: string[];
  subtitle?: string;
  actions?: React.ReactNode;
}

export function DashboardLayout({ children, title, allowedRoles, subtitle, actions }: DashboardLayoutProps) {
  const router = useRouter();
  const { isAuthenticated, user } = useAuthStore();
  useSessionRefresh();

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/login');
      return;
    }
    if (user?.mustChangePassword) {
      router.replace('/change-password');
      return;
    }
    if (user?.licence?.state === 'LOCKED') {
      router.replace('/licence');
      return;
    }
    if (allowedRoles && user && !allowedIn(allowedRoles, user.role)) {
      router.replace('/unauthorized');
    }
  }, [allowedRoles, isAuthenticated, router, user]);

  // Must set their own password first: render nothing (no requests) while redirecting.
  if (user?.mustChangePassword || user?.licence?.state === 'LOCKED') return null;

  return (
    <div className="relative flex h-screen overflow-hidden bg-gradient-to-br from-slate-50 via-indigo-50/40 to-violet-50/40">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Header title={title} />
        <LicenceBanner />
        <main className="flex-1 overflow-y-auto">
          <div className="p-6 max-w-screen-2xl mx-auto animate-fade-in">
            {/* Optional page header with actions */}
            {subtitle || actions ? (
              <div className="flex items-start justify-between mb-6 gap-4 rounded-2xl border border-white/70 bg-white/70 backdrop-blur-md px-5 py-4 shadow-sm">
                <div>
                  <h2 className="page-title">{title}</h2>
                  {subtitle && <p className="page-subtitle">{subtitle}</p>}
                </div>
                {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
              </div>
            ) : null}
            <div className="space-y-6">{children}</div>
          </div>
        </main>
      </div>
    </div>
  );
}
