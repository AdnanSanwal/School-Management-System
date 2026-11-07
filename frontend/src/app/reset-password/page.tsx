'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { KeyRound } from 'lucide-react';
import { Field } from '@/components/ui/kit';
import { authAPI, apiError } from '@/lib/api';

// Opened from the link in the "Password Reset" email (?token=…).
export default function ResetPasswordPage() {
  return <Suspense fallback={null}><ResetForm /></Suspense>;
}

function ResetForm() {
  const token = useSearchParams().get('token') ?? '';
  const router = useRouter();
  const [f, setF] = useState({ next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const mismatch = f.confirm.length > 0 && f.next !== f.confirm;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    try {
      await authAPI.resetPassword(token, f.next);
      toast.success('Password changed. Sign in with the new one.');
      router.replace('/login');
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-indigo-50/40 to-violet-50/40 p-6">
      <div className="card w-full max-w-md space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-600"><KeyRound className="h-5 w-5" /></div>
          <div><h1 className="text-lg font-bold text-gray-900">Set a new password</h1><p className="text-sm text-gray-500">At least 8 characters.</p></div>
        </div>
        {!token ? (
          <p className="text-sm text-red-600">This link is incomplete. Open the link from the email again, or <Link href="/forgot-password" className="underline">request a new one</Link>.</p>
        ) : (
          <form className="space-y-3" onSubmit={submit}>
            <Field label="New password"><input type="password" className="input" required minLength={8} autoFocus autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
            <Field label="Repeat new password" hint={mismatch ? 'The two passwords are different' : undefined}>
              <input type="password" className={`input ${mismatch ? 'border-red-300' : ''}`} required minLength={8} autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
            </Field>
            <button className="btn btn-primary w-full" disabled={busy || mismatch}>Save new password</button>
          </form>
        )}
        <Link href="/login" className="text-sm text-primary-600 hover:underline">Back to sign in</Link>
      </div>
    </div>
  );
}
