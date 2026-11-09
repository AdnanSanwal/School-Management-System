'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowLeft, FileDown, FileSpreadsheet, Filter, RotateCcw, Search } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Spinner, Empty } from '@/components/ui/kit';
import { reportsAPI, apiError, type ReportColumn } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { cn } from '@/lib/utils';
import { REPORT_META, ReportFilters, defaultFilters, missingFilter, toParams, type FilterValues } from '@/components/reports/ReportFilters';

/**
 * CR-02: a report shown inside the app. Pick filters, press Apply, and the table updates on
 * the same page. Nothing downloads unless PDF / Excel is pressed.
 */
export default function ReportViewPage() {
  const { type } = useParams<{ type: string }>();
  const meta = REPORT_META[type];
  const [draft, setDraft] = useState<FilterValues>(() => defaultFilters(type));
  const [applied, setApplied] = useState<FilterValues>(() => defaultFilters(type));
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const missing = missingFilter(type, applied);
  const params = toParams(type, applied);

  const q = useQuery({
    queryKey: ['report-view', type, params],
    queryFn: () => reportsAPI.view(type, params),
    enabled: !!meta && !missing,
  });

  const apply = () => {
    const m = missingFilter(type, draft);
    if (m) return toast.error(m);
    setApplied(draft);
  };
  const reset = () => { const d = defaultFilters(type); setDraft(d); setApplied(d); };

  const download = async (format: 'pdf' | 'xlsx') => {
    if (missing) return toast.error(missing);
    setBusy(format);
    try {
      await reportsAPI.download(type, { format, ...params });
    } catch (e) {
      const blob = (e as any)?.response?.data;
      toast.error(blob instanceof Blob ? JSON.parse(await blob.text()).message : apiError(e));
    } finally {
      setBusy(null);
    }
  };

  if (!meta) return <DashboardLayout title="Report" allowedRoles={CAN.reports}><div className="card"><Empty title="Unknown report" /></div></DashboardLayout>;
  const r = q.data;
  const term = search.trim().toLowerCase();
  const rows = r ? (term ? r.rows.filter((row) => Object.values(row).some((v) => String(v ?? '').toLowerCase().includes(term))) : r.rows) : [];
  const dirty = JSON.stringify(toParams(type, draft)) !== JSON.stringify(params);

  return (
    <DashboardLayout title={meta.title} allowedRoles={CAN.reports} subtitle={r?.subtitle ?? meta.desc}
      actions={<>
        <Link href="/reports" className="btn btn-ghost"><ArrowLeft className="h-4 w-4" /> All reports</Link>
        <button className="btn btn-secondary" disabled={!!busy || !r} onClick={() => download('pdf')}><FileDown className="h-4 w-4" /> {busy === 'pdf' ? 'Preparing…' : 'Download PDF'}</button>
        <button className="btn btn-secondary" disabled={!!busy || !r} onClick={() => download('xlsx')}><FileSpreadsheet className="h-4 w-4" /> {busy === 'xlsx' ? 'Preparing…' : 'Excel'}</button>
      </>}>
      <div className="card space-y-3">
        <ReportFilters type={type} value={draft} onChange={setDraft} />
        {meta.params.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={apply}><Filter className="h-4 w-4" /> Apply{dirty ? ' changes' : ''}</button>
            <button className="btn btn-ghost" onClick={reset}><RotateCcw className="h-4 w-4" /> Reset</button>
          </div>
        )}
      </div>

      <div className="card">
        {missing ? <Empty title={missing}>Then press Apply.</Empty>
          : q.isLoading ? <Spinner label="Building report…" />
          : q.error ? <p className="text-sm text-red-600">{apiError(q.error)}</p>
          : r && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-gray-600"><b>{r.rows.length}</b> row{r.rows.length === 1 ? '' : 's'}{term ? ` · ${rows.length} matching` : ''}</p>
                <div className="relative w-64 max-w-full">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                  <input className="input pl-9" placeholder="Search in this report" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search in report" />
                </div>
              </div>
              {rows.length === 0 ? <Empty title={term ? 'Nothing matches your search' : 'No data for these filters'} /> : (
                <div className="table-container max-h-[65vh] overflow-auto">
                  <table className="table">
                    <thead>
                      <tr>{r.columns.map((c) => <th key={c.key} className={cn(isNumeric(c) && 'text-right', 'whitespace-nowrap')}>{c.label}</th>)}</tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <tr key={i}>{r.columns.map((c) => <td key={c.key} className={cn('text-sm', isNumeric(c) && 'text-right tabular-nums')}>{fmt(row[c.key], c, r.currency)}</td>)}</tr>
                      ))}
                    </tbody>
                    {r.totals && !term && (
                      <tfoot>
                        <tr className="bg-slate-50 font-semibold">{r.columns.map((c) => <td key={c.key} className={cn('px-4 py-3 text-sm', isNumeric(c) && 'text-right tabular-nums')}>{fmt(r.totals![c.key], c, r.currency)}</td>)}</tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
              {r.notes?.filter(Boolean).map((n, i) => <p key={i} className="text-xs text-gray-500">{n}</p>)}
            </div>
          )}
      </div>
    </DashboardLayout>
  );
}

const isNumeric = (c: ReportColumn) => c.type === 'money' || c.type === 'number' || c.type === 'percent';

function fmt(v: string | number | null | undefined, c: ReportColumn, currency: string) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'string' && isNaN(Number(v))) return v; // labels in total rows
  if (c.type === 'money') return `${currency} ${Number(v).toLocaleString('en-PK', { maximumFractionDigits: 2 })}`;
  if (c.type === 'percent') return `${Number(v).toFixed(1)}%`;
  if (c.type === 'number') return Number(v).toLocaleString('en-PK');
  return String(v);
}
