'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { FileDown, FileSpreadsheet } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Field, Spinner, SectionSelect, Empty } from '@/components/ui/kit';
import { reportsAPI, academicsAPI, apiError } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { todayIso } from '@/lib/utils';

type Param = 'dateRange' | 'month' | 'section' | 'class' | 'overdue';

const META: Record<string, { title: string; desc: string; params: Param[] }> = {
  'fee-collection': { title: 'Fee collection', desc: 'Every receipt in a date range, with totals by payment method. Use the same date for a daily report.', params: ['dateRange'] },
  'fee-monthly-summary': { title: 'Monthly fee summary', desc: 'Billed, received and still pending, month by month for this academic year.', params: [] },
  defaulters: { title: 'Defaulter list', desc: 'Students with overdue fee, parent phone numbers and months owed.', params: ['class', 'overdue'] },
  'student-attendance-register': { title: 'Student attendance register', desc: 'One row per student, one column per school day, with totals.', params: ['section', 'month'] },
  'staff-attendance': { title: 'Teacher attendance', desc: 'Present, late, absent and leave days per staff member for a month.', params: ['month'] },
  'class-strength': { title: 'Class-wise strength', desc: 'Students per section with boys/girls and class teacher.', params: [] },
  leave: { title: 'Leave report', desc: 'All staff leave requests and approved days.', params: ['dateRange'] },
};

export default function ReportsPage() {
  const { data: available = [], isLoading } = useQuery({ queryKey: ['reports'], queryFn: reportsAPI.available });
  return (
    <DashboardLayout title="Reports" allowedRoles={CAN.reports} subtitle="Download as PDF to print, or Excel to work with the numbers">
      {isLoading ? <Spinner /> : available.length === 0 ? <div className="card"><Empty title="No reports for your role" /></div> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {available.filter((k) => META[k]).map((k) => <ReportCard key={k} type={k} />)}
        </div>
      )}
    </DashboardLayout>
  );
}

function ReportCard({ type }: { type: string }) {
  const meta = META[type];
  const today = todayIso();
  const [p, setP] = useState({ from: today, to: today, month: today.slice(0, 7), sectionId: '', classId: '', minDaysOverdue: '0' });
  const [busy, setBusy] = useState<string | null>(null);
  const classes = useQuery({ queryKey: ['classes'], queryFn: academicsAPI.classes, enabled: meta.params.includes('class') });

  const download = async (format: 'pdf' | 'xlsx') => {
    if (meta.params.includes('section') && !p.sectionId) return toast.error('Choose a class section');
    setBusy(format);
    try {
      await reportsAPI.download(type, {
        format,
        ...(meta.params.includes('dateRange') ? { from: p.from, to: p.to } : {}),
        ...(meta.params.includes('month') ? { month: p.month } : {}),
        ...(meta.params.includes('section') ? { sectionId: p.sectionId } : {}),
        ...(meta.params.includes('class') && p.classId ? { classId: p.classId } : {}),
        ...(meta.params.includes('overdue') ? { minDaysOverdue: p.minDaysOverdue } : {}),
      });
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
      <div className="flex flex-wrap gap-3">
        {meta.params.includes('dateRange') && <>
          <Field label="From"><input type="date" className="input" value={p.from} onChange={(e) => setP({ ...p, from: e.target.value, to: e.target.value > p.to ? e.target.value : p.to })} /></Field>
          <Field label="To"><input type="date" className="input" min={p.from} value={p.to} onChange={(e) => setP({ ...p, to: e.target.value })} /></Field>
        </>}
        {meta.params.includes('month') && <Field label="Month"><input type="month" className="input" value={p.month} onChange={(e) => setP({ ...p, month: e.target.value })} /></Field>}
        {meta.params.includes('section') && <Field label="Class"><SectionSelect value={p.sectionId} onChange={(v) => setP({ ...p, sectionId: v })} className="w-44" /></Field>}
        {meta.params.includes('class') && (
          <Field label="Class">
            <select className="select w-40" value={p.classId} onChange={(e) => setP({ ...p, classId: e.target.value })}>
              <option value="">All classes</option>
              {(classes.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        )}
        {meta.params.includes('overdue') && (
          <Field label="Overdue by">
            <select className="select w-40" value={p.minDaysOverdue} onChange={(e) => setP({ ...p, minDaysOverdue: e.target.value })}>
              <option value="0">Any</option><option value="30">30+ days</option><option value="60">60+ days</option>
            </select>
          </Field>
        )}
      </div>
      <div className="mt-auto flex gap-2">
        <button className="btn btn-primary" disabled={!!busy} onClick={() => download('pdf')}><FileDown className="h-4 w-4" /> {busy === 'pdf' ? 'Preparing…' : 'PDF'}</button>
        <button className="btn btn-secondary" disabled={!!busy} onClick={() => download('xlsx')}><FileSpreadsheet className="h-4 w-4" /> {busy === 'xlsx' ? 'Preparing…' : 'Excel'}</button>
      </div>
    </div>
  );
}
