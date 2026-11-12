'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { Field } from '@/components/ui/kit';
import { usersAPI, type UsernameCheck } from '@/lib/api';
import { cn } from '@/lib/utils';

export type LoginValue = { username: string; email: string; password: string; confirm: string; role: string };
export const emptyLogin = (role: string): LoginValue => ({ username: '', email: '', password: '', confirm: '', role });

/** Problems that block saving; empty when the login details are complete and valid. */
export function loginProblems(v: LoginValue, check: UsernameCheck | null): string[] {
  const p: string[] = [];
  if (!v.username.trim()) p.push('Choose a username');
  else if (check && check.username === v.username.trim().toLowerCase() && !check.available) p.push(check.message);
  if (v.password.length < 8) p.push('Password must be at least 8 characters');
  if (v.password !== v.confirm) p.push('The two passwords are different');
  return p;
}

/** Turns the form value into the API's login body. */
export const loginBody = (v: LoginValue) => {
  // A school-defined role arrives as "BASE:<id>" from the role picker.
  const [role, customRoleId] = v.role.split(':');
  return { username: v.username.trim().toLowerCase(), email: v.email.trim() || undefined, password: v.password, role, ...(customRoleId ? { customRoleId } : {}) };
};

/**
 * CR-05: admin-chosen sign-in for a staff member: username (checked live, with free
 * alternatives when taken), optional email, password + confirm, role. The person must
 * replace this password the first time they sign in.
 */
export function LoginFields({ value, onChange, roles, personName, onCheck }: {
  value: LoginValue;
  onChange: (v: LoginValue) => void;
  roles: string[][];
  personName?: string;
  onCheck?: (c: UsernameCheck | null) => void;
}) {
  const [check, setCheck] = useState<UsernameCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const set = (k: keyof LoginValue) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange({ ...value, [k]: e.target.value });

  // Check availability shortly after typing stops.
  useEffect(() => {
    const u = value.username.trim();
    if (u.length < 3) { setCheck(null); onCheck?.(null); return; }
    setChecking(true);
    const t = setTimeout(() => {
      usersAPI.usernameCheck(u, personName)
        .then((c) => { setCheck(c); onCheck?.(c); })
        .catch(() => { setCheck(null); onCheck?.(null); })
        .finally(() => setChecking(false));
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the typed name changes
  }, [value.username, personName]);

  const mismatch = value.confirm.length > 0 && value.password !== value.confirm;
  const status = !value.username.trim() || value.username.trim().length < 3 ? null
    : checking ? <span className="flex items-center gap-1 text-gray-400"><Loader2 className="h-3 w-3 animate-spin" /> Checking…</span>
    : check?.available ? <span className="flex items-center gap-1 text-emerald-600"><Check className="h-3 w-3" /> Available</span>
    : check ? <span className="flex items-center gap-1 text-red-600"><X className="h-3 w-3" /> {check.message}</span> : null;

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div>
        <Field label="Username *">
          <input className={cn('input', check && !check.available && 'border-red-300')} required autoComplete="off" spellCheck={false}
            value={value.username} onChange={(e) => onChange({ ...value, username: e.target.value.replace(/\s/g, '').toLowerCase() })} placeholder="e.g. ali.raza" />
        </Field>
        <div className="mt-1 min-h-[1rem] text-xs">{status}</div>
        {check && !check.available && check.suggestions.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
            <span className="text-gray-500">Try:</span>
            {check.suggestions.map((s) => (
              <button key={s} type="button" className="rounded-full bg-primary-50 px-2 py-0.5 font-medium text-primary-700 hover:bg-primary-100" onClick={() => onChange({ ...value, username: s })}>{s}</button>
            ))}
          </div>
        )}
      </div>
      <Field label="Email (optional)" hint="Lets them reset a forgotten password by email">
        <input type="email" className="input" value={value.email} onChange={set('email')} autoComplete="off" />
      </Field>
      <Field label="Password *" hint="At least 8 characters. They choose their own at first sign-in.">
        <input type="password" className="input" required minLength={8} autoComplete="new-password" value={value.password} onChange={set('password')} />
      </Field>
      <Field label="Confirm password *" hint={mismatch ? 'The two passwords are different' : undefined}>
        <input type="password" className={cn('input', mismatch && 'border-red-300')} required minLength={8} autoComplete="new-password" value={value.confirm} onChange={set('confirm')} />
      </Field>
      {roles.length > 0 && (
        <Field label="Role">
          <select className="select" value={value.role} onChange={set('role')}>{roles.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </Field>
      )}
    </div>
  );
}

/** Shown after a login is created with an admin-chosen password. */
export function CredentialsNotice({ name, username, onClose }: { name: string; username: string; onClose: () => void }) {
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-emerald-900">Login created for {name}</p>
          <p className="mt-1 text-emerald-800">Username: <code className="rounded bg-white px-1.5 py-0.5 font-mono font-semibold">{username}</code> with the password you set.</p>
          <p className="mt-1 text-xs text-emerald-700">Give them these details. At first sign-in they will be asked to choose their own password.</p>
        </div>
        <button className="btn-icon btn-ghost h-7 w-7" onClick={onClose} aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
}
