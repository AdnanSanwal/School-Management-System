'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { authAPI, apiError } from '@/lib/api';
import { useAuthStore, HOME_BY_ROLE } from '@/store/authStore';

export function BranchSwitcher() {
  const user = useAuthStore(s => s.user);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (!user?.branches?.length || user.role === 'SUPER_ADMIN') return null;
  const switchTo = async (schoolId: string) => {
    if (busy || schoolId === user.school?.id) return;
    setBusy(true);
    try {
      await qc.cancelQueries();
      const result = await authAPI.switchBranch(schoolId);
      qc.clear();
      useAuthStore.getState().setAuth(result.user, result.accessToken, result.refreshToken);
      // A full navigation discards branch-local component state and in-flight views.
      window.location.replace(HOME_BY_ROLE[result.user.role] || '/dashboard');
    } catch (e) { toast.error(apiError(e)); setBusy(false); }
  };
  return <select aria-label="Current branch" className="input !w-auto max-w-[190px] !py-2 text-xs" disabled={busy} value={user.school?.id ?? ''} onChange={e => switchTo(e.target.value)}>{user.branches.map(b => <option key={b.id} value={b.id} disabled={!b.isActive}>{b.name}{!b.isActive ? ' (suspended)' : ''}</option>)}</select>;
}
