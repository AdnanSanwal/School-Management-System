'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Eye, FileDown, FileSpreadsheet } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Spinner, Empty } from '@/components/ui/kit';
import { reportsAPI, apiError } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { REPORT_META, ReportFilters, defaultFilters, missingFilter, toParams } from '@/components/reports/ReportFilters';

export default function ReportsPage() {
  const { data: available = [], isLoading } = useQuery({ queryKey: ['reports'], queryFn: reportsAPI.available });
  return (
    <DashboardLayout title="Reports" allowedRoles={CAN.reports} subtitle="View any report on screen with filters, or download it as PDF / Excel">
      {isLoading ? <Spinner /> : available.length === 0 ? <div className="card"><Empty title="No reports for your role" /></div> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {available.filter((k) => REPORT_META[k]).map((k) => <ReportCard key={k} type={k} />)}
        </div>
      )}
    </DashboardLayout>
  );
}

function ReportCard({ type }: { type: string }) {
  const meta = REPORT_META[type];
  const [p, setP] = useState(() => defaultFilters(type));
  const [busy, setBusy] = useState<string | null>(null);

  const download = async (format: 'pdf' | 'xlsx') => {
    const missing = missingFilter(type, p);
    if (missing) return toast.error(missing);
    setBusy(format);
    try {
      await reportsAPI.download(type, { format, ...toParams(type, p) });
    } catch (e) {
      // Blob error bodies need decoding to show the server's message.
      const blob = (e as any)?.response?.data;
      const msg = blob instanceof Blob ? JSON.parse(await blob.text()).message : apiError(e);
      toast.error(msg);
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
      <ReportFilters type={type} value={p} onChange={setP} />
      <div className="mt-auto flex flex-wrap gap-2">
        {/* CR-02: View opens the report on screen; PDF / Excel stay separate downloads. */}
        <Link href={`/reports/${type}`} className="btn btn-primary"><Eye className="h-4 w-4" /> View</Link>
        <button className="btn btn-secondary" disabled={!!busy} onClick={() => download('pdf')}><FileDown className="h-4 w-4" /> {busy === 'pdf' ? 'Preparing…' : 'PDF'}</button>
        <button className="btn btn-secondary" disabled={!!busy} onClick={() => download('xlsx')}><FileSpreadsheet className="h-4 w-4" /> {busy === 'xlsx' ? 'Preparing…' : 'Excel'}</button>
      </div>
    </div>
  );
}
