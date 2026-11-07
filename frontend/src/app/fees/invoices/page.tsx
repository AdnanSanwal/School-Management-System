'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { FilePlus2 } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Field, Modal, Spinner, StatusBadge, Empty } from '@/components/ui/kit';
import { feesAPI, academicsAPI, apiError } from '@/lib/api';
import { CAN, can } from '@/lib/roles';
import { formatDate, formatMoney, formatPeriod, sectionLabel, todayIso } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';

export default function InvoicesPage() {
  const user = useAuthStore((s) => s.user);
  const currency = user?.school?.currency ?? 'PKR';
  const [period, setPeriod] = useState(todayIso().slice(0, 7));
  const [classId, setClassId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [generating, setGenerating] = useState(false);
  const classes = useQuery({ queryKey: ['classes'], queryFn: academicsAPI.classes });
  const { data, isLoading } = useQuery({
    queryKey: ['invoices', period, classId, status, page],
    queryFn: () => feesAPI.invoices({ period: period || undefined, classId: classId || undefined, status: status || undefined, page, limit: 50 }),
    placeholderData: keepPreviousData,
  });
  const rows: any[] = data?.data ?? [];
  const qc = useQueryClient();
  const fines = useMutation({
    mutationFn: feesAPI.applyFines,
    onSuccess: (r: any) => { toast.success(`Late fee added to ${r.fined} invoice(s)`); qc.invalidateQueries({ queryKey: ['invoices'] }); },
    onError: (e) => toast.error(apiError(e)),
  });
  const waive = useMutation({
    mutationFn: (invoiceId: string) => feesAPI.waiveFine(invoiceId),
    onSuccess: () => { toast.success('Late fee waived'); qc.invalidateQueries({ queryKey: ['invoices'] }); },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <DashboardLayout title="Invoices" allowedRoles={CAN.viewFees} subtitle="Monthly fee vouchers"
      actions={<>
        {can(user?.role, 'applyFines') && <button className="btn btn-secondary" disabled={fines.isPending} onClick={() => confirm('Add the late fee to every overdue invoice past the grace period?') && fines.mutate()}>Apply late fees</button>}
        {can(user?.role, 'generateInvoices') && <button className="btn btn-primary" onClick={() => setGenerating(true)}><FilePlus2 className="h-4 w-4" /> Generate month</button>}
      </>}>
      <div className="card flex flex-wrap items-end gap-3">
        <label><span className="label">Month</span><input type="month" className="input" value={period} onChange={(e) => { setPeriod(e.target.value); setPage(1); }} /></label>
        <label><span className="label">Class</span>
          <select className="select w-44" value={classId} onChange={(e) => { setClassId(e.target.value); setPage(1); }}>
            <option value="">All classes</option>
            {(classes.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label><span className="label">Status</span>
          <select className="select w-40" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All</option><option value="OPEN">Unpaid + partial</option><option value="PAID">Paid</option><option value="CANCELLED">Cancelled</option>
          </select>
        </label>
        {data?.pagination && <span className="ml-auto text-sm text-gray-500">{data.pagination.total} invoices</span>}
      </div>
      <div className="card">
        {isLoading ? <Spinner /> : rows.length === 0 ? <Empty title="No invoices">Use “Generate month” to create this month&apos;s vouchers.</Empty> : (
          <div className="table-container">
            <table className="table">
              <thead><tr><th>Invoice</th><th>Student</th><th>Class</th><th>Month</th><th>Due</th><th className="text-right">Net</th><th className="text-right">Late fee</th><th className="text-right">Paid</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id}>
                    <td className="font-mono text-sm">{i.invoiceNo}</td>
                    <td><Link href={`/students/${i.student.id}`} className="font-medium hover:text-primary-600">{i.student.name}</Link></td>
                    <td className="text-sm">{sectionLabel(i.student.section)}</td>
                    <td className="text-sm">{formatPeriod(i.period)}</td>
                    <td className="text-sm">{formatDate(i.dueDate)}</td>
                    <td className="text-right" title={i.items.map((it: any) => `${it.feeHead.name}: ${it.amount}${Number(it.discount) ? ` − ${it.discount}` : ''}`).join('\n')}>
                      {formatMoney(i.netAmount, currency)}{Number(i.discountAmount) > 0 && <span className="ml-1 text-xs text-emerald-600">(−{formatMoney(i.discountAmount, currency)})</span>}
                    </td>
                    <td className="text-right text-sm">{Number(i.fineAmount) > 0 ? <>{formatMoney(i.fineAmount, currency)}{can(user?.role, 'waiveFine') && i.status !== 'PAID' && <button className="ml-1 text-xs text-primary-600 hover:underline" onClick={() => confirm('Waive this late fee?') && waive.mutate(i.id)}>waive</button>}</> : '—'}</td>
                    <td className="text-right">{formatMoney(i.paidAmount, currency)}</td>
                    <td><StatusBadge status={i.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data?.pagination?.pages > 1 && (
          <div className="mt-3 flex justify-end gap-2">
            <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <button className="btn btn-ghost" disabled={page >= (data?.pagination?.pages ?? 1)} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        )}
      </div>
      {generating && <GenerateModal classes={classes.data ?? []} onClose={() => setGenerating(false)} onDone={(p) => { setPeriod(p); setPage(1); }} />}
    </DashboardLayout>
  );
}

function GenerateModal({ classes, onClose, onDone }: { classes: any[]; onClose: () => void; onDone: (period: string) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ period: todayIso().slice(0, 7), dueDay: '10', classIds: [] as string[], includeAnnual: false, includeOneTime: false });
  const [result, setResult] = useState<any>(null);
  const m = useMutation({
    mutationFn: () => feesAPI.generate({ ...f, dueDay: Number(f.dueDay), classIds: f.classIds.length ? f.classIds : undefined }),
    onSuccess: (r: any) => { setResult(r); qc.invalidateQueries({ queryKey: ['invoices'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); onDone(f.period); },
    onError: (e) => toast.error(apiError(e)),
  });
  const currency = useAuthStore((s) => s.user?.school?.currency ?? 'PKR');

  return (
    <Modal open onClose={onClose} title="Generate monthly invoices">
      {result ? (
        <div className="space-y-3 text-sm">
          <p><b>{result.created}</b> invoices created for {formatPeriod(result.period)} totalling <b>{formatMoney(result.totalBilled, currency)}</b>.</p>
          {result.skipped > 0 && <p className="text-gray-500">{result.skipped} students already had an invoice for this month and were skipped.</p>}
          {result.classesWithoutFeeStructure.length > 0 && (
            <p className="text-amber-700">Some classes have no fee structure, so their students were not billed. Set it up under Fee structure.</p>
          )}
          <button className="btn btn-primary w-full" onClick={onClose}>Done</button>
        </div>
      ) : (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Month"><input type="month" required className="input" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} /></Field>
            <Field label="Due on day"><input type="number" min="1" max="31" className="input" value={f.dueDay} onChange={(e) => setF({ ...f, dueDay: e.target.value })} /></Field>
          </div>
          <Field label="Classes" hint="None selected = all classes">
            <div className="flex flex-wrap gap-2">
              {classes.map((c) => (
                <label key={c.id} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1 text-sm">
                  <input type="checkbox" checked={f.classIds.includes(c.id)}
                    onChange={(e) => setF({ ...f, classIds: e.target.checked ? [...f.classIds, c.id] : f.classIds.filter((x) => x !== c.id) })} />
                  {c.name}
                </label>
              ))}
            </div>
          </Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.includeAnnual} onChange={(e) => setF({ ...f, includeAnnual: e.target.checked })} /> Include annual charges</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.includeOneTime} onChange={(e) => setF({ ...f, includeOneTime: e.target.checked })} /> Include one-time charges (e.g. admission)</label>
          <p className="text-xs text-gray-500">Approved concessions are applied. Students who already have this month&apos;s invoice are skipped, so it is safe to run again.</p>
          <button className="btn btn-primary w-full" disabled={m.isPending}>{m.isPending ? 'Generating…' : 'Generate'}</button>
        </form>
      )}
    </Modal>
  );
}
