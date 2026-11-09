'use client';

/* eslint-disable @next/next/no-img-element -- QR code is a data: URL */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { User, Lock, ShieldCheck, Bell } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Field, Spinner } from '@/components/ui/kit';
import { authAPI, apiError, type UsernameCheck } from '@/lib/api';
import { ROLE_LABEL } from '@/lib/roles';
import { usePushSubscription } from '@/hooks/usePushSubscription';
import { useAuthStore } from '@/store/authStore';

// "My account": every signed-in user's own profile, password, two-step login and browser alerts.
export default function SettingsPage() {
  const me = useQuery({ queryKey: ['me'], queryFn: authAPI.me });
  return (
    <DashboardLayout title="My account" subtitle="Your profile, password and sign-in security">
      {me.isLoading || !me.data ? <Spinner /> : (
        <div className="grid max-w-5xl gap-4 lg:grid-cols-2">
          <Profile me={me.data} />
          <Password />
          <TwoStep enabled={!!me.data.mfaEnabled} />
          <BrowserAlerts />
        </div>
      )}
    </DashboardLayout>
  );
}

function CardTitle({ icon: Icon, title, desc }: { icon: React.ElementType; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600"><Icon className="h-4 w-4" /></div>
      <div><h3 className="section-title">{title}</h3><p className="text-sm text-gray-500">{desc}</p></div>
    </div>
  );
}

function Profile({ me }: { me: any }) {
  const qc = useQueryClient();
  const initial = () => ({ name: me.name ?? '', phone: me.phone ?? '', email: me.email ?? '', username: me.username ?? '', currentPassword: '' });
  const [f, setF] = useState(initial);
  const [check, setCheck] = useState<UsernameCheck | null>(null);
  useEffect(() => setF(initial()), [me]); // eslint-disable-line react-hooks/exhaustive-deps
  const loginChanged = f.email.trim().toLowerCase() !== (me.email ?? '') || f.username.trim().toLowerCase() !== (me.username ?? '');
  const usernameChanged = f.username.trim().toLowerCase() !== (me.username ?? '');

  // Live availability while changing the username (your current one counts as free).
  useEffect(() => {
    const u = f.username.trim();
    if (!usernameChanged || u.length < 3) { setCheck(null); return; }
    const t = setTimeout(() => authAPI.usernameCheck(u).then(setCheck).catch(() => setCheck(null)), 400);
    return () => clearTimeout(t);
  }, [f.username, usernameChanged]);

  const save = useMutation({
    mutationFn: () => authAPI.updateProfile({
      name: f.name, phone: f.phone || null,
      ...(loginChanged ? { email: f.email.trim() || null, username: f.username.trim() || null, currentPassword: f.currentPassword } : {}),
    }),
    onSuccess: (u: any) => {
      toast.success(loginChanged ? 'Saved. Sign in with your new details from now on.' : 'Profile saved');
      const { user, accessToken, refreshToken, setAuth } = useAuthStore.getState();
      if (user && accessToken && refreshToken) setAuth({ ...user, name: u.name, email: u.email, username: u.username }, accessToken, refreshToken);
      qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });
  const blocked = usernameChanged && !!check && !check.available;
  return (
    <form className="card space-y-3" onSubmit={(e) => { e.preventDefault(); if (!blocked) save.mutate(); }}>
      <CardTitle icon={User} title="Profile & sign-in" desc="Your name, phone, and the username or email you sign in with." />
      <Field label="Name"><input className="input" required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Phone"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="0300 1234567" /></Field>
      <div>
        <Field label="Username"><input className="input font-mono" autoCapitalize="none" spellCheck={false} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.replace(/\s/g, '').toLowerCase() })} placeholder="e.g. ali.raza" /></Field>
        {usernameChanged && check && (
          <p className={`mt-1 text-xs ${check.available ? 'text-emerald-600' : 'text-red-600'}`}>
            {check.message}
            {!check.available && check.suggestions.length > 0 && <> — try {check.suggestions.map((s, i) => (
              <button key={s} type="button" className="ml-1 font-medium text-primary-700 underline" onClick={() => setF({ ...f, username: s })}>{s}{i < check.suggestions.length - 1 ? ',' : ''}</button>
            ))}</>}
          </p>
        )}
      </div>
      <Field label="Email" hint="Optional if you have a username. Needed to reset a forgotten password by email.">
        <input type="email" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      </Field>
      {loginChanged && (
        <Field label="Current password" hint="Needed to change how you sign in">
          <input type="password" className="input" required autoComplete="current-password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} />
        </Field>
      )}
      <p className="text-sm text-gray-500">Role: <b>{ROLE_LABEL[me.role] ?? me.role}</b>{me.school ? ` · ${me.school.name}` : ''}</p>
      <button className="btn btn-primary" disabled={save.isPending || blocked}>Save</button>
    </form>
  );
}

function Password() {
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const mismatch = f.confirm.length > 0 && f.next !== f.confirm;
  const save = useMutation({
    mutationFn: () => authAPI.changePassword({ currentPassword: f.current, newPassword: f.next }),
    // Changing the password signs out every device; this one continues on the fresh tokens.
    onSuccess: (r) => {
      useAuthStore.getState().setAuth(r.user, r.accessToken, r.refreshToken);
      toast.success('Password changed. Other devices have been signed out.');
      setF({ current: '', next: '', confirm: '' });
    },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <form className="card space-y-3" onSubmit={(e) => { e.preventDefault(); if (!mismatch) save.mutate(); }}>
      <CardTitle icon={Lock} title="Password" desc="Use at least 8 characters." />
      <Field label="Current password"><input type="password" className="input" required autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
      <Field label="New password"><input type="password" className="input" required minLength={8} autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
      <Field label="Repeat new password" hint={mismatch ? 'The two new passwords are different' : undefined}>
        <input type="password" className={`input ${mismatch ? 'border-red-300' : ''}`} required minLength={8} autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
      </Field>
      <button className="btn btn-primary" disabled={save.isPending || mismatch}>Change password</button>
    </form>
  );
}

function TwoStep({ enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  const [setup, setSetup] = useState<{ secret: string; qrCodeUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const done = (msg: string) => { toast.success(msg); setSetup(null); setCode(''); setPassword(''); qc.invalidateQueries({ queryKey: ['me'] }); };
  const start = useMutation({ mutationFn: authAPI.mfaSetup, onSuccess: setSetup, onError: (e) => toast.error(apiError(e)) });
  const verify = useMutation({ mutationFn: () => authAPI.mfaVerify(code), onSuccess: () => done('Two-step login is on'), onError: (e) => toast.error(apiError(e)) });
  const disable = useMutation({ mutationFn: () => authAPI.mfaDisable(password), onSuccess: () => done('Two-step login is off'), onError: (e) => toast.error(apiError(e)) });

  return (
    <div className="card space-y-3">
      <CardTitle icon={ShieldCheck} title="Two-step login" desc="Ask for a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator…) when signing in." />
      {enabled ? (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); disable.mutate(); }}>
          <p className="text-sm"><span className="badge badge-green">on</span> Your account asks for a code at sign-in.</p>
          <Field label="Password, to turn it off"><input type="password" className="input" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <button className="btn btn-secondary" disabled={disable.isPending}>Turn off</button>
        </form>
      ) : setup ? (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); verify.mutate(); }}>
          <p className="text-sm text-gray-600">1. Scan this with your authenticator app (or type the key).</p>
          <img src={setup.qrCodeUrl} alt="QR code for your authenticator app" className="h-40 w-40 rounded-lg border border-slate-200" />
          <p className="break-all text-xs text-gray-500">Key: <code>{setup.secret}</code></p>
          <Field label="2. Enter the 6-digit code it shows">
            <input className="input w-40 tracking-[0.3em]" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => { setSetup(null); setCode(''); }}>Cancel</button>
            <button className="btn btn-primary" disabled={verify.isPending || code.length !== 6}>Turn on</button>
          </div>
        </form>
      ) : (
        <>
          <p className="text-sm text-gray-600"><span className="badge badge-gray">off</span> Recommended for owners, principals and accountants.</p>
          <button className="btn btn-primary" disabled={start.isPending} onClick={() => start.mutate()}>Set up two-step login</button>
        </>
      )}
    </div>
  );
}

function BrowserAlerts() {
  const push = usePushSubscription();
  return (
    <div className="card space-y-3">
      <CardTitle icon={Bell} title="Alerts on this computer" desc="Pop-up alerts for approvals, notices and other notifications, even when this tab is in the background." />
      {!push.isSupported ? <p className="text-sm text-gray-500">This browser doesn’t support pop-up alerts.</p> : (
        <>
          <p className="text-sm">{push.isSubscribed ? <><span className="badge badge-green">on</span> for this browser</> : <><span className="badge badge-gray">off</span> for this browser</>}</p>
          <button className="btn btn-secondary" disabled={push.isLoading} onClick={() => (push.isSubscribed ? push.unsubscribe() : push.subscribe())}>
            {push.isSubscribed ? 'Turn off' : 'Turn on'}
          </button>
          {push.error && <p className="text-sm text-red-600">{push.error}</p>}
        </>
      )}
      <p className="text-xs text-gray-400">Every alert is also kept under Notifications (the bell).</p>
    </div>
  );
}
