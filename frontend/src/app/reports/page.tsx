'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Eye, FileDown, FileSpreadsheet } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Spinner, Empty } from '@/components/ui/kit';
import { reportsAPI, apiError, reportDownloadError } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { REPORT_META, ReportFilters, defaultFilters, missingFilter, toParams } from '@/components/reports/ReportFilters';

export default function ReportsPage() {
  const { data: available = [], isLoading, error } = useQuery({ queryKey: ['reports'], queryFn: reportsAPI.available });
  const [find, setFind] = useState('');
  const filtered = available.filter(k => REPORT_META[k] && `${REPORT_META[k].title} ${REPORT_META[k].desc}`.toLowerCase().includes(find.trim().toLowerCase()));
  return (
    <DashboardLayout title="Reports" allowedRoles={CAN.reports} subtitle="View any report on screen with filters, or download it as PDF / Excel">
      <input className="input max-w-md mb-4" aria-label="Find a report" placeholder="Find a report…" value={find} onChange={e=>setFind(e.target.value)} />
      {isLoading ? <Spinner /> : error ? <div role="alert" className="card text-red-600">{apiError(error)}</div> : available.length === 0 ? <div className="card"><Empty title="No reports for your role" /></div> : filtered.length === 0 ? <div className="card"><Empty title="No matching reports" /></div> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {filtered.map((k) => <ReportCard key={k} type={k} />)}
        </div>
      )}
    </DashboardLayout>
  );
}

function ReportCard({ type }: { type: string }) {
  const meta = REPORT_META[type];
  const [p, setP] = useState(() => defaultFilters(type));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const download = async (format: 'pdf' | 'xlsx') => {
    const missing = missingFilter(type, p);
    if (missing) return toast.error(missing);
    setBusy(format);
    try {
      await reportsAPI.download(type, { format, ...toParams(type, p) });
    } catch (e) {
      toast.error(await reportDownloadError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card flex flex-col gap-3">
      <div>
        <h3 className="section-title">{meta.title}</h3>
        <p className="text-sm text-gray-500">{meta.desc}</p>
      </div>
      <button className="text-sm text-primary-600 text-left" onClick={() => setFiltersOpen(v => !v)}>{filtersOpen ? 'Hide filters' : 'Filters'}</button>
      {filtersOpen && <ReportFilters type={type} value={p} onChange={setP} />}
      <div className="mt-auto flex flex-wrap gap-2">
        {/* CR-02: View opens the report on screen; PDF / Excel stay separate downloads. */}
        <Link href={`/reports/${type}?${new URLSearchParams(Object.entries({ ...toParams(type,p), ...(meta.params.includes('dateRange') ? {from:p.from,to:p.to} : {}) }).filter((entry): entry is [string,string] => entry[1] !== undefined)).toString()}`} className="btn btn-primary"><Eye className="h-4 w-4" /> View</Link>
        <button className="btn btn-secondary" disabled={!!busy} onClick={() => download('pdf')}><FileDown className="h-4 w-4" /> {busy === 'pdf' ? 'Preparing…' : 'PDF'}</button>
        <button className="btn btn-secondary" disabled={!!busy} onClick={() => download('xlsx')}><FileSpreadsheet className="h-4 w-4" /> {busy === 'xlsx' ? 'Preparing…' : 'Excel'}</button>
      </div>
    </div>
  );
}
