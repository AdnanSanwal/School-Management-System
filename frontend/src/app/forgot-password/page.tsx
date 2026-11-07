'use client';

import { useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { ArrowLeft, Mail } from 'lucide-react';
import { Field } from '@/components/ui/kit';
import { authAPI, apiError } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await authAPI.forgotPassword(email.trim());
      setSent(true);
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
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-600"><Mail className="h-5 w-5" /></div>
          <div><h1 className="text-lg font-bold text-gray-900">Forgot password</h1><p className="text-sm text-gray-500">We’ll email you a link to set a new one.</p></div>
        </div>
        {sent ? (
          <div className="space-y-2 text-sm text-gray-700">
            <p>If <b>{email}</b> has an account, a reset link is on its way. It works for 1 hour.</p>
            <p className="text-gray-500">No email after a few minutes? Check spam, or ask your school office to reset your password from <i>Users &amp; logins</i>.</p>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={submit}>
            <Field label="Your login email"><input type="email" className="input" required autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <button className="btn btn-primary w-full" disabled={busy}>Send reset link</button>
          </form>
        )}
        <Link href="/login" className="inline-flex items-center gap-1 text-sm text-primary-600 hover:underline"><ArrowLeft className="h-4 w-4" /> Back to sign in</Link>
      </div>
    </div>
  );
}
