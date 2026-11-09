'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { KeyRound } from 'lucide-react';
import { Field } from '@/components/ui/kit';
import { authAPI, apiError } from '@/lib/api';
import { HOME_BY_ROLE, useAuthStore } from '@/store/authStore';

/**
 * First sign-in with a password someone else chose (CR-05): the person must pick their
 * own before using the app. The server refuses everything else until they do.
 */
export default function ChangePasswordPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user, setAuth, clearAuth } = useAuthStore();
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const mismatch = f.confirm.length > 0 && f.next !== f.confirm;

  useEffect(() => { if (!useAuthStore.getState().accessToken) router.replace('/login'); }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mismatch) return;
    if (f.next === f.current) return toast.error('Choose a password different from the one you were given');
    setBusy(true);
    try {
      const r = await authAPI.changePassword({ currentPassword: f.current, newPassword: f.next });
      qc.clear();
      setAuth(r.user, r.accessToken, r.refreshToken);
      toast.success('Password set. Welcome!');
      router.replace(HOME_BY_ROLE[r.user.role] || '/dashboard');
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await authAPI.logout().catch(() => {});
    qc.clear();
    clearAuth();
    router.replace('/login');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-indigo-50/40 to-violet-50/40 p-6">
      <div className="card w-full max-w-md space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-600"><KeyRound className="h-5 w-5" /></div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Set your own password</h1>
            <p className="text-sm text-gray-500">{user ? `Welcome, ${user.name}. ` : ''}The password you were given was chosen by the school office. Please replace it.</p>
          </div>
        </div>
        <form className="space-y-3" onSubmit={submit}>
          <Field label="Password you were given"><input type="password" className="input" required autoFocus autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
          <Field label="New password" hint="At least 8 characters"><input type="password" className="input" required minLength={8} autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
          <Field label="Repeat new password" hint={mismatch ? 'The two passwords are different' : undefined}>
            <input type="password" className={`input ${mismatch ? 'border-red-300' : ''}`} required minLength={8} autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
          </Field>
          <button className="btn btn-primary w-full" disabled={busy || mismatch}>Save and continue</button>
        </form>
        <button className="text-sm text-gray-500 hover:underline" onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
}
