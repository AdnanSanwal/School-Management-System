'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BadgeCheck, Clock, Lock, LogOut, TriangleAlert } from 'lucide-react';
import { Spinner } from '@/components/ui/kit';
import { licenceAPI, authAPI, apiError } from '@/lib/api';
import { cn, formatDate, formatMoney } from '@/lib/utils';
import { HOME_BY_ROLE, useAuthStore } from '@/store/authStore';

const LOOK = {
  ACTIVE: { icon: BadgeCheck, title: 'Subscription active', box: 'bg-emerald-50 text-emerald-700' },
  DUE_SOON: { icon: Clock, title: 'Subscription ending soon', box: 'bg-amber-50 text-amber-700' },
  GRACE: { icon: TriangleAlert, title: 'Subscription ended', box: 'bg-red-50 text-red-700' },
  LOCKED: { icon: Lock, title: 'Subscription expired', box: 'bg-red-50 text-red-700' },
} as const;

// The school's subscription. Standalone (no sidebar): it is the one page that still opens when the school is locked.
export default function LicencePage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  // The saved session is read a moment after the first render, so decide once the page has mounted.
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    const st = useAuthStore.getState();
    if (st.accessToken && st.user) setSignedIn(true); else router.replace('/login');
  }, [router]);
  const { data, isLoading, error } = useQuery({ queryKey: ['licence'], queryFn: licenceAPI.get, enabled: signedIn && user?.role !== 'SUPER_ADMIN', refetchInterval: 60_000 });
  // Keep the banner and the lock in step with what this page shows.
  useEffect(() => {
    const current = useAuthStore.getState().user;
    if (data && current && JSON.stringify(current.licence) !== JSON.stringify(data.status)) useAuthStore.setState({ user: { ...current, licence: data.status } });
  }, [data]);

  const signOut = async () => {
    try { await authAPI.logout(); } catch { /* signing out anyway */ }
    useAuthStore.getState().clearAuth();
    window.location.href = '/login';
  };
  if (!signedIn) return null;
  const s = data?.status;
  const look = s ? LOOK[s.state] : null;
  const locked = s?.state === 'LOCKED';
  const currency = user?.school?.currency ?? 'PKR';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/40 to-violet-50/40 px-4 py-10">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex items-center justify-between">
          {!locked ? <Link href={HOME_BY_ROLE[user?.role ?? ''] ?? '/dashboard'} className="btn btn-ghost"><ArrowLeft className="h-4 w-4" /> Back</Link> : <span />}
          <button className="btn btn-ghost" onClick={signOut}><LogOut className="h-4 w-4" /> Sign out</button>
        </div>
        <div className="card space-y-5">
          {isLoading ? <Spinner /> : error ? <p className="text-sm text-red-600">{apiError(error)}</p> : s && look && (
            <>
              <div className="flex items-start gap-4">
                <div className={cn('flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl', look.box)}><look.icon className="h-7 w-7" /></div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-500">{user?.school?.name}</p>
                  <h1 className="text-xl font-bold">{look.title}</h1>
                  <p className="mt-1 text-sm text-gray-600">{s.summary}</p>
                </div>
              </div>
              {locked && (
                <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
                  <p className="font-semibold">The system is locked.</p>
                  <p>Nothing has been deleted. As soon as the subscription is renewed, everything opens again exactly as it was. Please contact your provider{user?.role === 'OWNER' ? '' : ', or let the school owner know'}.</p>
                </div>
              )}
              {s.message && <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-gray-700"><span className="font-medium">Message from your provider:</span> {s.message}</p>}
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-3">
                <div><dt className="text-xs text-gray-500">Plan</dt><dd className="font-medium">{s.plan ?? 'Standard'}</dd></div>
                <div><dt className="text-xs text-gray-500">Paid until</dt><dd className="font-medium">{s.paidUntil ? formatDate(s.paidUntil) : 'No end date'}</dd></div>
                {s.paidUntil && s.lockDate && <div><dt className="text-xs text-gray-500">{locked ? 'Locked since' : 'Locks on'}</dt><dd className="font-medium">{formatDate(s.lockDate)}<span className="block text-xs font-normal text-gray-500">{s.graceDays} grace day{s.graceDays === 1 ? '' : 's'} after the end date</span></dd></div>}
                {data.activeStudents !== undefined && <div><dt className="text-xs text-gray-500">Active students in this branch</dt><dd className="font-medium">{data.activeStudents}{s.maxStudents ? ` of ${s.maxStudents} allowed` : ''}</dd></div>}
              </dl>
              {data.brand && <p className="text-sm text-gray-600">Brand licence: {data.brand.name} · Branches: {data.branchCount ?? '—'} / {data.maxBranches ?? 'Unlimited'}. Expiry and renewal apply to all branches.</p>}
              {data.payments && (
                <div className="border-t border-slate-100 pt-4">
                  <h2 className="section-title mb-2">Payments received</h2>
                  {data.payments.length === 0 ? <p className="text-sm text-gray-500">No payments recorded yet.</p> : (
                    <div className="table-container">
                      <table className="table">
                        <thead><tr><th>Paid on</th><th className="text-right">Amount</th><th>Paid until</th><th>Details</th></tr></thead>
                        <tbody>{data.payments.map((p) => (
                          <tr key={p.id}>
                            <td className="text-sm">{formatDate(p.paidOn)}</td>
                            <td className="text-right tabular-nums">{formatMoney(p.amount, p.currency || currency)}</td>
                            <td className="text-sm">{formatDate(p.coversUntil)}</td>
                            <td className="text-sm text-gray-500">{[p.method, p.reference, p.note].filter(Boolean).join(' · ')}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
