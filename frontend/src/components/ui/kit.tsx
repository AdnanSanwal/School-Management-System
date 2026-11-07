'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Loader2 } from 'lucide-react';
import { academicsAPI } from '@/lib/api';
import { cn } from '@/lib/utils';

export function Modal({ open, onClose, title, children, wide }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-16" onMouseDown={onClose}>
      <div
        role="dialog" aria-modal="true" aria-label={title}
        className={cn('w-full rounded-2xl bg-white shadow-xl', wide ? 'max-w-3xl' : 'max-w-lg')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <button className="btn-icon btn-ghost" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children, hint, className }: { label: string; children: React.ReactNode; hint?: string; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-gray-400">{hint}</span>}
    </label>
  );
}

export function Stat({ label, value, sub, tone = 'default', icon: Icon }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'default' | 'good' | 'bad' | 'warn'; icon?: React.ElementType;
}) {
  const tones = {
    default: 'bg-primary-50 text-primary-600',
    good: 'bg-emerald-50 text-emerald-600',
    bad: 'bg-red-50 text-red-600',
    warn: 'bg-amber-50 text-amber-600',
  };
  return (
    <div className="card flex items-start gap-4">
      {Icon && <div className={cn('flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl', tones[tone])}><Icon className="h-5 w-5" /></div>}
      <div className="min-w-0">
        <p className="text-sm text-gray-500">{label}</p>
        <p className="mt-0.5 text-2xl font-bold tracking-tight text-gray-900">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-gray-500">{sub}</p>}
      </div>
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-400">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="py-12 text-center">
      <p className="font-medium text-gray-700">{title}</p>
      {children && <div className="mt-1 text-sm text-gray-500">{children}</div>}
    </div>
  );
}

/** Shows a one-time password so the office can hand it over. */
export function PasswordNotice({ email, password }: { email: string; password: string }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
      <p className="font-medium text-amber-900">Login created for {email}</p>
      <p className="mt-1 text-amber-800">
        One-time password: <code className="rounded bg-white px-1.5 py-0.5 font-mono font-semibold">{password}</code>
      </p>
      <p className="mt-1 text-xs text-amber-700">Share it now — it is not shown again. They should change it after first login.</p>
    </div>
  );
}

export type SectionOption = { id: string; label: string; classId: string; className: string; strength: number; classTeacher?: { id: string; name: string } | null };

/** All sections the user may see, flattened as "Class 8-A". */
export function useSections() {
  return useQuery({
    queryKey: ['classes'],
    queryFn: academicsAPI.classes,
    select: (classes: any[]): SectionOption[] =>
      classes.flatMap((c) => c.sections.map((s: any) => ({
        id: s.id, label: `${c.name}-${s.name}`, classId: c.id, className: c.name, strength: s.strength, classTeacher: s.classTeacher,
      }))),
  });
}

export function SectionSelect({ value, onChange, includeAll, className }: {
  value: string; onChange: (id: string) => void; includeAll?: string; className?: string;
}) {
  const { data = [] } = useSections();
  return (
    <select className={cn('select', className)} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Section">
      {includeAll !== undefined ? <option value="">{includeAll}</option> : <option value="" disabled>Choose section…</option>}
      {data.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
    </select>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PRESENT: 'badge-green', ABSENT: 'badge-red', LATE: 'badge-yellow', LEAVE: 'badge-blue', HALF_DAY: 'badge-orange',
    PAID: 'badge-green', UNPAID: 'badge-red', PARTIAL: 'badge-yellow', CANCELLED: 'badge-gray',
    ACTIVE: 'badge-green', LEFT: 'badge-gray', TRANSFERRED: 'badge-gray', GRADUATED: 'badge-blue',
    PENDING: 'badge-yellow', APPROVED: 'badge-green', REJECTED: 'badge-red',
  };
  return <span className={cn('badge', map[status] ?? 'badge-gray')}>{status.replace('_', ' ').toLowerCase()}</span>;
}
