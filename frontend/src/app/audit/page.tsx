'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowRight, ChevronLeft, ChevronRight, Clock3, Eye, Filter, History, RefreshCw, ShieldCheck } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Empty, Field, Modal, Spinner } from '@/components/ui/kit';
import { SearchInput, useDebounced } from '@/components/ui/SearchInput';
import { auditAPI, apiError, type AuditEntry } from '@/lib/api';
import { CAN, can, ROLE_LABEL } from '@/lib/roles';
import { useAuthStore } from '@/store/authStore';
import { cn, getInitials } from '@/lib/utils';

const emptyFilters = { from: '', to: '', entity: '', userId: '', kind: '' };
const kinds = { activity: { label: 'Activity', icon: Activity, color: 'bg-teal-50 text-teal-700 ring-teal-200' }, security: { label: 'Security', icon: ShieldCheck, color: 'bg-amber-50 text-amber-700 ring-amber-200' }, request: { label: 'API request', icon: ArrowRight, color: 'bg-slate-100 text-slate-600 ring-slate-200' } };
function human(s: string) { return s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }
function moment(at: string, timezone: string) { return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(at)); }
function display(v: unknown): string { return v === null || v === undefined ? 'Not set' : typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v); }
function Kind({ value }: { value: AuditEntry['kind'] }) { const k = kinds[value]; const Icon = k.icon; return <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset whitespace-nowrap', k.color)}><Icon className="h-3.5 w-3.5" />{k.label}</span>; }

export default function AuditPage() {
  const user = useAuthStore(s => s.user);
  const branch = user?.school?.id;
  const allowed = can(user?.role, 'viewAudit');
  const [filters, setFilters] = useState(emptyFilters);
  const [search, setSearch] = useState('');
  const term = useDebounced(search.trim(), 300);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [selected, setSelected] = useState<{ branch?: string; entry: AuditEntry } | null>(null);
  const invalidDates = !!filters.from && !!filters.to && filters.from > filters.to;
  const query = Object.fromEntries(Object.entries({ ...filters, search: term, page, limit }).filter(([, v]) => v !== ''));
  const options = useQuery({ queryKey: ['audit-options', branch], queryFn: auditAPI.options, enabled: allowed });
  const log = useQuery({ queryKey: ['audit-log', branch, query], queryFn: () => auditAPI.list(query), enabled: allowed && !invalidDates, placeholderData: (previous, previousQuery) => previousQuery?.queryKey[1] === branch ? previous : undefined, meta: { quiet: true } });
  const timezone = log.data?.timezone ?? options.data?.timezone ?? 'UTC';
  const rows = log.data?.data ?? [];
  const pagination = log.data?.pagination;
  const total = pagination?.total ?? 0;
  const selectedEntry = selected?.branch === branch ? selected?.entry : undefined;
  const activeCount = Object.values(filters).filter(Boolean).length + (search.trim() ? 1 : 0);
  const set = (patch: Partial<typeof filters>) => { setFilters(f => ({ ...f, ...patch })); setPage(1); };
  const reset = () => { setFilters(emptyFilters); setSearch(''); setPage(1); };

  return <DashboardLayout title="Audit log" allowedRoles={CAN.viewAudit} subtitle="A clear record of who did what, and when"
    actions={<button className="btn-secondary" disabled={log.isFetching || invalidDates} onClick={() => { void log.refetch(); void options.refetch(); }}><RefreshCw className={cn('h-4 w-4', log.isFetching && 'animate-spin')} />Refresh</button>}>
    <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div className="flex items-start gap-4"><div className="rounded-2xl bg-teal-50 p-3 text-teal-700"><History className="h-6 w-6" /></div><div><p className="text-xs font-semibold uppercase tracking-widest text-teal-700">Accountability & oversight</p><h2 className="mt-1 text-xl font-semibold text-slate-900">Your branch activity, in one place</h2><p className="mt-1 max-w-xl text-sm leading-6 text-slate-500">Review business changes, sign-ins and successful API changes. Audit records are read-only.</p></div></div>
        <div className="rounded-xl bg-slate-50 px-5 py-3"><p className="text-2xl font-bold tabular-nums text-slate-900">{log.isLoading ? '—' : total.toLocaleString()}</p><p className="text-xs text-slate-500">{activeCount ? 'Matching records' : 'Recorded events'}</p></div>
      </div>
      <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-t border-slate-100 pt-4 text-xs text-slate-500"><span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-teal-600" />{user?.school?.name ?? 'Current branch'} only</span><span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />Dates and times: {timezone}</span><span>Newest first</span></div>
    </section>

    <section className="card mt-4 space-y-4" aria-label="Audit filters">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Filter className="h-4 w-4 text-slate-400" />Filter activity{activeCount > 0 && <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs text-primary-700">{activeCount}</span>}</h2><button className="text-xs font-medium text-primary-600 hover:underline disabled:text-slate-400" disabled={!activeCount} onClick={reset}>Reset filters</button></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Search" className="sm:col-span-2"><SearchInput value={search} onChange={v => { setSearch(v); setPage(1); }} aria-label="Search audit log" placeholder="Action, person, record ID or IP address" /></Field>
        <Field label="From"><input className="input w-full" type="date" value={filters.from} max={filters.to || undefined} onChange={e => set({ from: e.target.value })} /></Field>
        <Field label="To"><input className="input w-full" type="date" value={filters.to} min={filters.from || undefined} onChange={e => set({ to: e.target.value })} /></Field>
        <Field label="Module"><select className="select w-full" value={filters.entity} onChange={e => set({ entity: e.target.value })}><option value="">All modules</option>{options.data?.entities.map(e => <option key={e} value={e}>{human(e)}</option>)}</select></Field>
        <Field label="Performed by"><select className="select w-full" value={filters.userId} onChange={e => set({ userId: e.target.value })}><option value="">All people</option>{options.data?.users.map(u => <option key={u.id} value={u.id}>{u.name} · {ROLE_LABEL[u.role] ?? u.role}</option>)}</select></Field>
        <Field label="Event type"><select className="select w-full" value={filters.kind} onChange={e => set({ kind: e.target.value })}><option value="">All events</option><option value="activity">Business activity</option><option value="security">Security & sign-ins</option><option value="request">API changes</option></select></Field>
        <Field label="Rows per page"><select className="select w-full" value={limit} onChange={e => { setLimit(Number(e.target.value)); setPage(1); }}>{[25, 50, 100].map(n => <option key={n} value={n}>{n} records</option>)}</select></Field>
      </div>
      {invalidDates && <p role="alert" className="text-sm text-red-600">From date must not be after To date.</p>}
      {options.error && <p role="alert" className="text-sm text-red-600">Filter options: {apiError(options.error)} <button className="underline" onClick={() => void options.refetch()}>Retry</button></p>}
    </section>

    <section className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white" aria-label="Audit events" aria-busy={log.isFetching}>
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-semibold text-slate-800">Activity timeline</h2><span role="status" className="text-xs text-slate-500">{log.isFetching ? 'Updating…' : 'Read-only history'}</span></div>
      {log.isLoading ? <Spinner label="Loading audit history…" /> : log.error ? <div role="alert" className="p-6 text-sm text-red-600">{apiError(log.error)} <button className="underline" onClick={() => void log.refetch()}>Try again</button></div> : !rows.length ? <Empty title={activeCount ? 'No events match these filters' : 'No activity recorded yet'}>{activeCount ? <button className="mt-2 text-primary-600 hover:underline" onClick={reset}>Clear filters and show all activity</button> : 'Changes and sign-ins will appear here as people use this branch.'}</Empty> : <div className={cn('overflow-x-auto', (log.isPlaceholderData || invalidDates) && 'opacity-50')}><table className="table w-full"><thead><tr><th>When</th><th>Person</th><th>Activity</th><th>Type</th><th>Source IP</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{rows.map(row => <tr key={row.id}>
        <td className="whitespace-nowrap text-xs text-slate-500">{moment(row.createdAt, timezone)}</td>
        <td><div className="flex items-center gap-2.5"><span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{row.user ? getInitials(row.user.name) : '—'}</span><div className="min-w-32"><p className="text-sm font-medium text-slate-800">{row.user?.name ?? (row.userId ? 'Former / unavailable user' : 'System / unauthenticated')}</p><p className="text-xs text-slate-400">{row.user ? ROLE_LABEL[row.user.role] ?? row.user.role : 'No current user profile'}</p></div></div></td>
        <td><p className={cn('max-w-md break-words text-sm font-medium text-slate-800', row.kind === 'request' && 'font-mono text-xs')}>{row.action}</p><p className="mt-1 text-xs text-slate-400">{human(row.entity)}{row.entityId && <> · <span title={row.entityId} className="font-mono">{row.entityId.slice(0, 8)}…</span></>}</p></td>
        <td><Kind value={row.kind} /></td><td className="whitespace-nowrap font-mono text-xs text-slate-500">{row.ipAddress ?? '—'}</td><td><button className="btn-secondary whitespace-nowrap text-xs" aria-label={`View details: ${row.action}`} onClick={() => setSelected({ branch, entry: row })}><Eye className="h-3.5 w-3.5" />Details</button></td>
      </tr>)}</tbody></table></div>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4 text-xs text-slate-500"><span>{total ? `${((pagination?.page ?? 1) - 1) * limit + 1}–${Math.min((pagination?.page ?? 1) * limit, total)} of ${total.toLocaleString()} events` : '0 events'}</span><div className="flex items-center gap-3"><button aria-label="Previous page" className="btn-secondary" disabled={page <= 1 || log.isFetching || invalidDates} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></button><span>Page {page} of {Math.max(1, pagination?.pages ?? 1)}</span><button aria-label="Next page" className="btn-secondary" disabled={!pagination || page >= pagination.pages || log.isFetching || invalidDates} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></button></div></div>
    </section>
    <p className="mt-3 text-xs leading-5 text-slate-400">Business activity and its underlying API change may appear as separate events. Failed sign-ins can appear under Security; the API trail records successful changes, not every request. Historical names reflect the current user profile.</p>
    <Modal open={!!selectedEntry} onClose={() => setSelected(null)} title="Audit event details" wide>{selectedEntry && <div className="space-y-5"><div className="flex flex-wrap items-center gap-3"><Kind value={selectedEntry.kind} /><p className="break-all text-lg font-semibold text-slate-900">{selectedEntry.action}</p></div><dl className="grid gap-4 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2">{[['When', moment(selectedEntry.createdAt, timezone)], ['Performed by', selectedEntry.user?.name ?? 'Unavailable / system'], ['Actor ID', selectedEntry.userId ?? 'Not recorded'], ['Module', human(selectedEntry.entity)], ['Source IP', selectedEntry.ipAddress ?? 'Not recorded'], ['Record ID', selectedEntry.entityId ?? 'Not recorded'], ['Event ID', selectedEntry.id]].map(([k, v]) => <div key={k}><dt className="text-xs text-slate-400">{k}</dt><dd className="mt-1 break-all text-slate-700">{v}</dd></div>)}</dl><div><h3 className="mb-3 text-sm font-semibold text-slate-800">Recorded details</h3><Metadata value={selectedEntry.meta} /></div><p className="text-xs text-slate-400">Only details recorded at the time of the event are shown. Credentials are redacted.</p></div>}</Modal>
  </DashboardLayout>;
}

function Metadata({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object' || !Object.keys(value).length) return <p className="rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-400">No additional details were recorded.</p>;
  return <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200 px-4">{Object.entries(value).map(([key, v]) => {
    const change = v && typeof v === 'object' && !Array.isArray(v) && ('from' in v || 'to' in v) ? v as { from?: unknown; to?: unknown } : null;
    return <div className="grid gap-2 py-3 sm:grid-cols-[150px_1fr]" key={key}><dt className="text-xs font-medium text-slate-500">{human(key)}</dt><dd className="min-w-0 whitespace-pre-wrap break-words text-sm text-slate-800">{change ? <div className="flex flex-wrap items-center gap-2"><span className="rounded bg-red-50 px-2 py-1 text-red-700">{display(change.from)}</span><ArrowRight className="h-3.5 w-3.5 text-slate-400" /><span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">{display(change.to)}</span></div> : display(v)}</dd></div>;
  })}</dl>;
}
