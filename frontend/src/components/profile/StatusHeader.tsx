'use client';

import { useState } from 'react';
import { CheckCircle2, Clock, History, type LucideIcon } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Field, Modal } from '@/components/ui/kit';
import { cn, formatDate, formatDateTime, todayIso } from '@/lib/utils';

export type Tone = 'green' | 'amber' | 'violet' | 'blue' | 'gray' | 'red' | 'orange';

const SOLID: Record<Tone, string> = {
  green: 'bg-emerald-600 hover:bg-emerald-700 text-white',
  amber: 'bg-amber-400 hover:bg-amber-500 text-amber-950',
  violet: 'bg-violet-600 hover:bg-violet-700 text-white',
  blue: 'bg-blue-600 hover:bg-blue-700 text-white',
  gray: 'bg-slate-500 hover:bg-slate-600 text-white',
  red: 'bg-red-600 hover:bg-red-700 text-white',
  orange: 'bg-orange-500 hover:bg-orange-600 text-white',
};
const SOFT: Record<Tone, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  amber: 'bg-amber-50 text-amber-700 ring-amber-100',
  violet: 'bg-violet-50 text-violet-700 ring-violet-100',
  blue: 'bg-blue-50 text-blue-700 ring-blue-100',
  gray: 'bg-slate-100 text-slate-600 ring-slate-200',
  red: 'bg-red-50 text-red-700 ring-red-100',
  orange: 'bg-orange-50 text-orange-700 ring-orange-100',
};

export type StatusAction = {
  value: string;
  label: string;
  icon: LucideIcon;
  tone: Tone;
  /** What happens, shown in the confirmation. */
  about: string;
};

export type ChangeDetails = { date?: string; reason?: string };

/**
 * The top of a student or staff profile (client change request 01 / 03): photo and name,
 * a clear Current Status box and Quick Actions to change it. Every change is confirmed first.
 */
export function StatusHeader({
  name, photoUrl, subtitle, chips, status, actions, canChange, onChange, pending, noun,
}: {
  name: string;
  photoUrl?: string | null;
  subtitle?: React.ReactNode;
  chips?: React.ReactNode;
  status: string;
  actions: StatusAction[];
  canChange: boolean;
  onChange: (value: string, details: ChangeDetails) => void;
  pending?: boolean;
  /** "student" / "staff member", for the confirmation text. */
  noun: string;
}) {
  const [asking, setAsking] = useState<StatusAction | null>(null);
  const current = actions.find((a) => a.value === status);
  const Icon = current?.icon ?? CheckCircle2;
  return (
    <div className="card flex flex-col gap-5 2xl:flex-row 2xl:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <Avatar name={name} src={photoUrl ?? undefined} size="xl" />
        <div className="min-w-0">
          <h2 className="truncate text-2xl font-bold text-gray-900">{name}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-gray-600">{subtitle}</p>}
          {chips && <div className="mt-2 flex flex-wrap gap-1.5">{chips}</div>}
        </div>
      </div>

      <div className="flex flex-col gap-4 border-t border-slate-100 pt-4 sm:flex-row sm:items-stretch 2xl:border-l 2xl:border-t-0 2xl:pl-6 2xl:pt-0">
        <div className="sm:w-48">
          <p className="mb-1.5 text-sm font-semibold text-gray-800">Current Status</p>
          <div className={cn('flex items-center gap-2 rounded-xl px-4 py-3 text-lg font-bold ring-1', SOFT[current?.tone ?? 'gray'])} role="status">
            <Icon className="h-5 w-5 flex-shrink-0" /> {current?.label ?? status}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-semibold text-gray-800">Quick Actions</p>
          <div className="flex flex-wrap gap-2">
            {actions.map((a) => {
              const A = a.icon;
              const isCurrent = a.value === status;
              return (
                <button key={a.value} type="button" disabled={!canChange || isCurrent || pending}
                  onClick={() => setAsking(a)}
                  title={!canChange ? 'You can’t change the status' : isCurrent ? `Already ${a.label.toLowerCase()}` : a.about}
                  aria-pressed={isCurrent}
                  className={cn('inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm transition disabled:cursor-not-allowed',
                    SOLID[a.tone], isCurrent ? 'ring-2 ring-offset-2 ring-slate-300' : 'disabled:opacity-50')}>
                  <A className="h-4 w-4" /> {a.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {asking && (
        <ConfirmStatus action={asking} from={current?.label ?? status} name={name} noun={noun} pending={!!pending}
          onClose={() => setAsking(null)}
          onConfirm={(d) => { onChange(asking.value, d); setAsking(null); }} />
      )}
    </div>
  );
}

function ConfirmStatus({ action, from, name, noun, pending, onClose, onConfirm }: {
  action: StatusAction; from: string; name: string; noun: string; pending: boolean;
  onClose: () => void; onConfirm: (d: ChangeDetails) => void;
}) {
  const [date, setDate] = useState(todayIso());
  const [reason, setReason] = useState('');
  const A = action.icon;
  return (
    <Modal open onClose={onClose} title={`Change status to ${action.label}?`}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onConfirm({ date, reason: reason.trim() || undefined }); }}>
        <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 text-sm">
          <span className="font-medium text-gray-700">{name}</span>
          <span className="text-gray-400">{from} →</span>
          <span className={cn('inline-flex items-center gap-1 rounded-lg px-2 py-0.5 font-semibold ring-1', SOFT[action.tone])}><A className="h-3.5 w-3.5" /> {action.label}</span>
        </div>
        <p className="text-sm text-gray-600">{action.about}</p>
        <p className="text-xs text-gray-500">Nothing is deleted: the {noun}’s profile, records and history stay. The change is saved in the activity log.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Effective date"><input type="date" className="input" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} required /></Field>
          <Field label="Reason / note (optional)"><input className="input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder={action.value === 'TRANSFERRED' ? 'e.g. moved to City School' : ''} /></Field>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={pending}>Yes, change to {action.label}</button>
        </div>
      </form>
    </Modal>
  );
}

export type ActivityItem = { id: string; action: string; at: string; by: string | null; meta?: Record<string, unknown> | null };

/** "Recent activity" for a profile: status changes and other recorded actions, newest first. */
export function ActivityCard({ items, extra, title = 'Recent activity' }: { items: ActivityItem[]; extra?: { label: string; at: string }[]; title?: string }) {
  const rows = [
    ...items.map((i) => ({ key: i.id, label: describe(i), at: i.at, dateOnly: false, by: i.by, note: (i.meta?.reason as string) || null, effective: (i.meta?.effective as string) || null })),
    // Extra entries are calendar dates (admission, joining): no time of day.
    ...(extra ?? []).map((e, n) => ({ key: `x${n}`, label: e.label, at: e.at, dateOnly: true, by: null, note: null, effective: null })),
  ];
  return (
    <div className="card">
      <h3 className="section-title mb-3 flex items-center gap-2"><History className="h-4 w-4 text-primary-600" /> {title}</h3>
      {rows.length === 0 ? <p className="text-sm text-gray-500">Nothing recorded yet.</p> : (
        <ol className="relative space-y-4 border-l border-slate-200 pl-5">
          {rows.map((r) => (
            <li key={r.key} className="relative">
              <span className="absolute -left-[25px] top-1 h-2.5 w-2.5 rounded-full bg-primary-500 ring-4 ring-white" />
              <p className="text-sm font-medium text-gray-800">{r.label}</p>
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-gray-500">
                <Clock className="h-3 w-3" /> {r.dateOnly ? formatDate(r.at) : formatDateTime(r.at)}{r.by ? ` · by ${r.by}` : ''}{r.effective ? ` · effective ${formatDate(r.effective)}` : ''}
              </p>
              {r.note && <p className="mt-0.5 text-xs italic text-gray-500">“{r.note}”</p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function describe(i: ActivityItem) {
  const m = i.meta ?? {};
  if (i.action === 'Status changed' && m.toLabel) return `Status changed from ${m.fromLabel} to ${m.toLabel}`;
  if (i.action === 'Promoted' && m.toClass) return `Promoted from ${m.fromClass} to ${m.toClass} (${m.toYear})`;
  return i.action;
}
