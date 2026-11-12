'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Info } from 'lucide-react';
import { Modal, Spinner, Empty } from '@/components/ui/kit';
import { SearchInput, NoMatches, matchesSearch } from '@/components/ui/SearchInput';
import { dashboardAPI, apiError } from '@/lib/api';
import { formatDate, formatDateTime, formatMoney, formatPeriod } from '@/lib/utils';

export type DetailKind = 'fees-today' | 'outstanding' | 'staff-present' | 'students-present' | 'alerts';

const TITLES: Record<DetailKind, string> = {
  'fees-today': 'Fee collected today',
  outstanding: 'Total remaining fee',
  'staff-present': 'Teachers present today',
  'students-present': 'Students present today',
  alerts: 'All alerts',
};

const STATUS: Record<string, string> = {
  PRESENT: 'badge-green', LATE: 'badge-yellow', HALF_DAY: 'badge-orange', ABSENT: 'badge-red', LEAVE: 'badge-blue', NOT_MARKED: 'badge-gray',
};
const statusLabel = (s: string) => s.replace('_', ' ').toLowerCase();

/** CR-01: the live records behind one dashboard card. */
export function DetailsModal({ kind, currency, onClose }: { kind: DetailKind; currency: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['dashboard-details', kind], queryFn: () => dashboardAPI.details(kind) });
  const [search, setSearch] = useState('');
  const term = search.trim();
  const rows: any[] = useMemo(() => {
    const all: any[] = q.data?.rows ?? [];
    // Match what is shown (names, numbers, class, status…), not field names or record IDs:
    // the old JSON search matched every row for words like "student" or "class".
    return term ? all.filter((r) => matchesSearch(term, visibleValues(r))) : all;
  }, [q.data, term]);

  return (
    <Modal open onClose={onClose} title={TITLES[kind]} wide>
      {q.isLoading ? <Spinner /> : q.error ? <p className="text-sm text-red-600">{apiError(q.error)}</p> : (
        <div className="space-y-3">
          {kind !== 'alerts' && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Summary kind={kind} d={q.data} currency={currency} />
              <SearchInput className="w-64 max-w-full" placeholder="Name, number, class…" value={search} onChange={setSearch} aria-label="Search this list" />
            </div>
          )}
          <div className="max-h-[60vh] overflow-auto">
            {kind === 'alerts' ? <Alerts groups={q.data.groups} onClose={onClose} />
              : !rows.length ? (term ? <NoMatches term={term} onClear={() => setSearch('')} /> : <Empty title="Nothing to show yet" />)
              : <Table kind={kind} rows={rows} currency={currency} onClose={onClose} />}
          </div>
        </div>
      )}
    </Modal>
  );
}

/** A row's values without IDs: { studentId, student: 'Ali', months: ['2026-05'] } → ['Ali', ['2026-05'], …]. */
function visibleValues(row: unknown): unknown[] {
  if (!row || typeof row !== 'object') return [row];
  return Object.entries(row as Record<string, unknown>)
    .filter(([k]) => k !== 'id' && !/Id$/.test(k))
    // Statuses are shown as words: NOT_MARKED → "not marked".
    .map(([, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? visibleValues(v) : typeof v === 'string' && v.includes('_') ? [v, v.replace(/_/g, ' ')] : v));
}

function Summary({ kind, d, currency }: { kind: DetailKind; d: any; currency: string }) {
  if (kind === 'fees-today') return <p className="text-sm text-gray-600"><b>{formatMoney(d.total, currency)}</b> from {d.rows.length} payment(s) on {formatDate(d.date)}</p>;
  if (kind === 'outstanding') return <p className="text-sm text-gray-600"><b className="text-red-600">{formatMoney(d.total, currency)}</b> outstanding from {d.students} student(s)</p>;
  if (kind === 'staff-present') return <p className="text-sm text-gray-600"><b>{d.counts.present}</b> of {d.counts.total} present · {d.counts.absent} absent · {d.counts.leave} on leave · {d.counts.notMarked} not marked</p>;
  if (kind === 'students-present') return <p className="text-sm text-gray-600"><b>{d.present}</b> present on {formatDate(d.date)}{d.byClass.length ? ` · ${d.byClass.map((c: any) => `${c.section}: ${c.count}`).join(' · ')}` : ''}</p>;
  return null;
}

function Table({ kind, rows, currency, onClose }: { kind: DetailKind; rows: any[]; currency: string; onClose: () => void }) {
  const studentLink = (id: string, name: string) => <Link href={`/students/${id}`} onClick={onClose} className="font-medium text-primary-700 hover:underline">{name}</Link>;
  if (kind === 'fees-today') return (
    <table className="table">
      <thead><tr><th>Time</th><th>Student</th><th>Class</th><th>Months</th><th>Method</th><th>Receipt</th><th className="text-right">Amount</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.paymentId}>
          <td className="whitespace-nowrap text-sm">{formatDateTime(r.time)}</td>
          <td>{studentLink(r.studentId, r.student)}<span className="block text-xs text-gray-500">{r.admissionNo}</span></td>
          <td className="text-sm">{r.class}</td>
          <td className="text-sm">{r.months.map(formatPeriod).join(', ') || '—'}</td>
          <td className="text-sm">{statusLabel(r.method)}{r.reference ? <span className="block text-xs text-gray-500">{r.reference}</span> : null}</td>
          <td><Link href={`/fees/receipt/${r.paymentId}`} onClick={onClose} className="font-mono text-xs text-primary-700 hover:underline">{r.receiptNo}</Link></td>
          <td className="text-right font-semibold">{formatMoney(r.amount, currency)}</td>
        </tr>
      ))}</tbody>
    </table>
  );
  if (kind === 'outstanding') return (
    <table className="table">
      <thead><tr><th>Student</th><th>Class</th><th>Parent</th><th>Months</th><th>Oldest due</th><th className="text-right">Remaining</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.studentId}>
          <td>{studentLink(r.studentId, r.student)}<span className="block text-xs text-gray-500">{r.admissionNo}</span></td>
          <td className="text-sm">{r.class}</td>
          <td className="text-sm">{r.guardian ?? '—'}{r.phone ? <span className="block text-xs text-gray-500">{r.phone}</span> : null}</td>
          <td className="text-sm">{r.months.map(formatPeriod).join(', ')}</td>
          <td className="text-sm">{formatDate(r.oldestDue)}</td>
          <td className="text-right font-semibold text-red-600">{formatMoney(r.pending, currency)}</td>
        </tr>
      ))}</tbody>
    </table>
  );
  if (kind === 'staff-present') return (
    <table className="table">
      <thead><tr><th>Teacher</th><th>Designation</th><th>Status</th><th>Check-in</th><th>Check-out</th><th>Note</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.staffId}>
          <td><span className="font-medium">{r.name}</span><span className="block text-xs text-gray-500">{r.employeeNo}{r.phone ? ` · ${r.phone}` : ''}</span></td>
          <td className="text-sm">{r.designation ?? 'Teacher'}</td>
          <td><span className={`badge ${STATUS[r.status] ?? 'badge-gray'}`}>{statusLabel(r.status)}</span></td>
          <td className="text-sm">{r.checkIn ? new Date(r.checkIn).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
          <td className="text-sm">{r.checkOut ? new Date(r.checkOut).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
          <td className="text-sm text-gray-500">{r.remarks ?? ''}</td>
        </tr>
      ))}</tbody>
    </table>
  );
  return (
    <table className="table">
      <thead><tr><th>Class</th><th>Roll</th><th>Student</th><th>Status</th><th>Note</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.studentId}>
          <td className="text-sm">{r.class}</td>
          <td className="text-sm">{r.rollNo ?? '—'}</td>
          <td>{studentLink(r.studentId, r.student)}<span className="block text-xs text-gray-500">{r.admissionNo}</span></td>
          <td><span className={`badge ${STATUS[r.status] ?? 'badge-gray'}`}>{statusLabel(r.status)}</span></td>
          <td className="text-sm text-gray-500">{r.remarks ?? ''}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

function Alerts({ groups, onClose }: { groups: any[]; onClose: () => void }) {
  if (!groups.length) return <Empty title="No alerts right now" />;
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <section key={g.key} className="rounded-xl border border-slate-100 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              {g.level === 'warning' ? <AlertTriangle className="h-4 w-4 text-amber-500" /> : <Info className="h-4 w-4 text-primary-500" />}
              {g.title} <span className="badge badge-gray">{g.count}</span>
            </h4>
            {g.link && <Link href={g.link} onClick={onClose} className="text-xs text-primary-600 hover:underline">Open →</Link>}
          </div>
          <ul className="space-y-1 text-sm text-gray-700">
            {g.items.map((it: string, i: number) => <li key={i} className="border-b border-slate-50 pb-1 last:border-0">{it}</li>)}
          </ul>
        </section>
      ))}
    </div>
  );
}
