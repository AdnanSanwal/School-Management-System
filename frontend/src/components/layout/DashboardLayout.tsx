'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useAuthStore } from '@/store/authStore';
import { useQuery } from '@tanstack/react-query';
import { authAPI } from '@/lib/api';
import { allowedIn } from '@/lib/roles';

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
    if (allowedRoles && user && !allowedIn(allowedRoles, user.role)) {
      router.replace('/unauthorized');
    }
  }, [allowedRoles, isAuthenticated, router, user]);

  // Must set their own password first: render nothing (no requests) while redirecting.
  if (user?.mustChangePassword) return null;

  return (
    <div className="relative flex h-screen overflow-hidden bg-gradient-to-br from-slate-50 via-indigo-50/40 to-violet-50/40">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Header title={title} />
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
