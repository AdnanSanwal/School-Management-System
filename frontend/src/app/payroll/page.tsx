'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Users, Wallet, Clock3, CheckCircle2, CalendarDays, Info, Printer, Eye, FileText, BadgeDollarSign, ArrowRight } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Empty, Spinner } from '@/components/ui/kit';
import { payrollAPI, apiError } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { formatDate, todayIso } from '@/lib/utils';
import { useFinance, financeError } from '@/components/finance/shared';
import { PayrollBadge, usePayrollRole } from '@/components/payroll/shared';
import { PayrollPayment } from '@/components/payroll/Payment';

const months = Array.from({ length: 12 }, (_, i) => new Date(2026, i, 1).toLocaleString('en', { month: 'long' }));
const steps = ['Prepare payroll', 'Submit for approval', 'Approval', 'Payment processing', 'Marked as paid'];

export default function PayrollPage() {
  const qc = useQueryClient();
  const { money } = useFinance();
  const { canManage, canApprove } = usePayrollRole();
  const [period, setPeriod] = useState(todayIso().slice(0, 7));
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const runs = useQuery({ queryKey: ['payroll', 'runs'], queryFn: payrollAPI.runs });
  const selected = runs.data?.find(r => r.period === period);
  const detail = useQuery({ queryKey: ['payroll', 'run', selected?.id], queryFn: () => payrollAPI.run(selected!.id), enabled: !!selected });
  const run = detail.data;
  const refresh = () => { qc.invalidateQueries({ queryKey: ['payroll'] }); qc.invalidateQueries({ queryKey: ['finance'] }); };
  const prepare = useMutation({ mutationFn: () => payrollAPI.prepare(period), onSuccess: r => { toast.success(r.data.message); setFilter(''); refresh(); }, onError: financeError });
  const submit = useMutation({ mutationFn: () => payrollAPI.submit(run!.id), onSuccess: r => { toast.success(r.data.message); refresh(); }, onError: financeError });
  const decide = useMutation({ mutationFn: (approve: boolean) => payrollAPI.decide(run!.id, approve), onSuccess: r => { toast.success(r.data.message); refresh(); }, onError: financeError });
  const sheet = useMutation({ mutationFn: (format: 'xlsx' | 'pdf') => payrollAPI.bankSheet(run!.id, format), onError: financeError });
  const staff = run?.totals.staff ?? selected?.staff ?? 0;
  const pending = run?.status === 'SUBMITTED' ? staff : 0;
  const approved = run?.status === 'APPROVED' ? staff : 0;
  const paid = run?.status === 'PAID' ? staff : 0;
  const stage = run ? ({ DRAFT: 0, SUBMITTED: 1, APPROVED: 3, PAID: 4 }[run.status]) : -1;
  const label = `${months[Number(period.slice(5)) - 1]} ${period.slice(0, 4)}`;
  const lines = (run?.lines ?? []).filter(l => (!filter || run?.status === filter) && `${l.name} ${l.employeeNo} ${l.designation ?? ''}`.toLowerCase().includes(search.toLowerCase().trim()));
  const year = Number(period.slice(0, 4));
  const years = Array.from(new Set([new Date().getFullYear(), year, ...(runs.data ?? []).map(r => Number(r.period.slice(0, 4)))]));
  const yearOptions = Array.from({ length: Math.max(...years) - Math.min(...years) + 6 }, (_, i) => Math.min(...years) - 5 + i).reverse();
  const busy = submit.isPending || decide.isPending;

  return <DashboardLayout title="Payroll" allowedRoles={CAN.viewPayroll}>
    <div className="payroll-dashboard space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><span className="rounded-2xl bg-violet-600 p-3 text-white shadow-lg shadow-violet-200"><BadgeDollarSign className="h-6 w-6" /></span><div><h1 className="text-2xl font-bold tracking-tight text-slate-900">Payroll</h1><p className="text-sm text-slate-500">Manage staff salaries and payments</p></div></div>
        <span className="flex items-center gap-2 rounded-xl bg-violet-100 px-3 py-2 text-sm font-medium text-violet-800"><CalendarDays className="h-4 w-4" />{label}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Staff in payroll', value: staff, icon: Users, tone: 'border-blue-100 bg-blue-50 text-blue-700' },
          { label: 'Total net salary', value: money(run?.totals.net ?? selected?.net ?? 0), icon: Wallet, tone: 'border-emerald-100 bg-emerald-50 text-emerald-700' },
          { label: 'Pending approval', value: pending, icon: Clock3, tone: 'border-amber-100 bg-amber-50 text-amber-700' },
          { label: 'Paid staff', value: paid, icon: CheckCircle2, tone: 'border-teal-100 bg-teal-50 text-teal-700' },
        ].map(s => <div key={s.label} className={`relative overflow-hidden rounded-2xl border p-4 ${s.tone}`}><div className="flex items-center gap-3"><s.icon className="h-7 w-7 shrink-0" /><div className="min-w-0"><p className="text-xs font-medium text-slate-600">{s.label}</p><p className="mt-1 break-words text-xl font-bold text-slate-900 xl:text-2xl">{s.value}</p></div></div><s.icon aria-hidden className="absolute -bottom-2 -right-2 h-16 w-16 opacity-10" /></div>)}
      </div>
      <section className="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><CalendarDays className="h-4 w-4 text-violet-600" />Generate Monthly Payroll</h2>
        <div className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_auto_1.4fr]">
          <label className="space-y-1 text-xs font-medium">Month<select aria-label="Payroll month" className="select w-full" value={period.slice(5)} onChange={e => { setPeriod(`${year}-${e.target.value}`); setFilter(''); }}>{months.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}</select></label>
          <label className="space-y-1 text-xs font-medium">Year<select aria-label="Payroll year" className="select w-full" value={year} onChange={e => { setPeriod(`${e.target.value}-${period.slice(5)}`); setFilter(''); }}>{yearOptions.map(y => <option key={y}>{y}</option>)}</select></label>
          {selected ? <Link className="btn-primary justify-center" href={`/payroll/${selected.id}`}>Review payroll <ArrowRight className="h-4 w-4" /></Link> : canManage ? <button className="btn-primary justify-center" disabled={prepare.isPending || runs.isPending || !!runs.error || period > todayIso().slice(0, 7)} onClick={() => prepare.mutate()}><CalendarDays className="h-4 w-4" />Generate payroll</button> : <p className="text-xs text-slate-500">Payroll has not been prepared.</p>}
          <div className="flex gap-2 rounded-xl bg-indigo-50 p-3 text-xs text-indigo-900"><Info className="h-4 w-4 shrink-0 text-indigo-500" /><div><b>Payroll process</b><p className="mt-1">Salaries are calculated from attendance, leave and deductions. One run covers all included staff.</p></div></div>
        </div>
      </section>
      {(runs.error || detail.error) && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{apiError(runs.error || detail.error)}</p>}
      {!!run?.missing.length && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{run.missing.length} staff have no effective salary structure and are excluded. Set their salaries, then recalculate in Review payroll.</p>}
      <section className="overflow-hidden rounded-2xl border border-violet-100 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-3">
          <div role="group" aria-label="Filter salary status" className="flex flex-wrap gap-1">{[['', 'All', staff], ['DRAFT', 'Draft', run?.status === 'DRAFT' ? staff : 0], ['SUBMITTED', 'Pending', pending], ['APPROVED', 'Approved', approved], ['PAID', 'Paid', paid]].map(([v, text, count]) => <button key={v} aria-pressed={filter === v} onClick={() => setFilter(String(v))} className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${filter === v ? 'bg-violet-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-violet-50'}`}>{text} ({count})</button>)}</div>
          <div className="flex flex-wrap items-center gap-2"><select aria-label="Download payroll report" value="" className="select !w-auto !py-1.5 !text-xs" disabled={!run || sheet.isPending} onChange={e => { if (e.target.value) sheet.mutate(e.target.value as 'xlsx' | 'pdf'); }}><option value="">Download report</option><option value="pdf">Bank sheet · PDF</option><option value="xlsx">Bank sheet · Excel</option></select><button className="btn-secondary !px-3 !py-1.5 !text-xs" disabled={!run} onClick={() => window.print()}><Printer className="h-3.5 w-3.5" />Print</button></div>
        </div>
        {run && <div className="px-3 pt-3"><input aria-label="Search payroll staff" className="input !py-2 !text-xs sm:max-w-xs" placeholder="Search name, designation or employee no." value={search} onChange={e => setSearch(e.target.value)} /></div>}
        {runs.isLoading || (selected && detail.isLoading) ? <Spinner /> : !run ? <Empty title={`No payroll for ${label}`}>Choose another month or generate this month’s payroll.</Empty> : <div className="table-container"><table className="table payroll-table"><thead><tr><th>#</th><th>Staff name</th><th>Designation</th><th>Basic salary</th><th>Allowances</th><th>Deductions</th><th>Net salary</th><th>Status</th><th>Actions</th></tr></thead><tbody>{lines.map((l, i) => <tr key={l.id}><td>{i + 1}</td><td><p className="font-semibold text-slate-800">{l.name}</p><span className="text-[10px] text-slate-400">{l.employeeNo}</span></td><td>{l.designation || '—'}</td><td className="tabular-nums">{money(l.basic)}</td><td className="tabular-nums">{money(l.allowances.reduce((n, a) => n + Number(a.amount), 0))}</td><td className="tabular-nums">{money(l.totalDeductions)}</td><td className="font-bold tabular-nums">{money(l.net)}</td><td><PayrollBadge status={run.status} /></td><td><div className="flex gap-1"><Link href={`/payroll/${run.id}`} className="payroll-row-action"><Eye className="h-3 w-3" />View</Link><Link href={`/payroll/payslip/${l.id}`} className="payroll-row-action text-violet-700"><FileText className="h-3 w-3" />Payslip</Link></div></td></tr>)}{!lines.length && <tr><td colSpan={9} className="!py-8 text-center text-slate-500">No staff match this filter.</td></tr>}</tbody></table></div>}
        {run && <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">Status applies to the entire monthly run. Bonus: {money(run.totals.bonus)} · Total deductions: {money(run.totals.deductions)} · Net payable: {money(run.totals.net)}</p>}
      </section>
      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm"><h2 className="mb-5 flex items-center gap-2 text-sm font-semibold"><CheckCircle2 className="h-4 w-4 text-violet-600" />Payroll Approval Workflow</h2><ol className="flex">{steps.map((s, i) => <li key={s} className="relative flex-1 text-center"><div className={`relative z-10 mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${i <= stage ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-400'}`}>{i < stage || (i === 4 && stage === 4) ? '✓' : i + 1}</div>{i < 4 && <span className={`absolute left-1/2 right-[-50%] top-3 h-px ${i < stage ? 'bg-violet-300' : 'bg-slate-200'}`} />}<p className="relative z-10 mt-2 px-1 text-[11px] font-medium text-slate-700">{s}</p></li>)}</ol><div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-3">{run?.status === 'DRAFT' && canManage && <button className="btn-primary !text-xs" disabled={busy} onClick={() => window.confirm(`Submit ${label} payroll for approval?`) && submit.mutate()}>Submit for approval</button>}{run?.status === 'SUBMITTED' && canApprove && <><button className="btn-primary !text-xs" disabled={busy} onClick={() => window.confirm(`Approve ${money(run.totals.net)} for ${staff} staff?`) && decide.mutate(true)}>Approve payroll</button><button className="btn-secondary !text-xs" disabled={busy} onClick={() => window.confirm('Send this payroll back to draft?') && decide.mutate(false)}>Send back</button></>}{run && <Link className="btn-secondary !text-xs" href={`/payroll/${run.id}`}>Review details</Link>}<p className="w-full text-xs text-slate-500">{run?.status === 'PAID' ? 'Payment recorded. Staff can access their payslips.' : 'Review salaries before approval. Record payment after funds have been paid out.'}</p>{run?.decisionNote && <p className="text-xs text-amber-700">Reviewer’s note: {run.decisionNote}</p>}</div></section>
        <section className="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm"><h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Wallet className="h-4 w-4 text-violet-600" />Payment Details</h2>{run?.status === 'APPROVED' && canManage ? <PayrollPayment key={run.id} run={run} inline onClose={() => {}} onPaid={refresh} /> : run?.status === 'PAID' ? <dl className="grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-slate-500">Paid from</dt><dd className="mt-1 font-medium">{run.account}</dd></div><div><dt className="text-xs text-slate-500">Payment date</dt><dd className="mt-1 font-medium">{run.paymentDate ? formatDate(run.paymentDate) : '—'}</dd></div><div><dt className="text-xs text-slate-500">Transaction reference</dt><dd className="mt-1 break-words">{run.paymentReference || '—'}</dd></div><div><dt className="text-xs text-slate-500">Paid by</dt><dd className="mt-1">{run.paidBy || '—'}</dd></div><div className="col-span-2"><dt className="text-xs text-slate-500">Remarks</dt><dd className="mt-1 break-words">{run.paymentNote || '—'}</dd></div><p className="col-span-2 rounded-xl bg-emerald-50 p-3 font-semibold text-emerald-800">✓ {money(run.totals.net)} paid for {staff} staff</p></dl> : <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500"><Wallet className="mb-3 h-8 w-8 text-slate-300" />{run?.status === 'APPROVED' ? 'An authorized payroll manager can record the monthly payment.' : 'Payment details become available once the monthly payroll is approved.'}<p className="mt-3 text-xs">One payment covers the complete run.</p></div>}</section>
      </div>
      {run && <div className="print-only"><h1>Payroll — {run.label}</h1><p>{staff} staff · Net salary {money(run.totals.net)} · {run.status}</p><table className="print-table"><thead><tr><th>Staff</th><th>Designation</th><th>Basic</th><th>Allowances</th><th>Deductions</th><th>Net pay</th></tr></thead><tbody>{run.lines.map(l => <tr key={l.id}><td>{l.name}</td><td>{l.designation}</td><td>{money(l.basic)}</td><td>{money(l.allowances.reduce((n, a) => n + Number(a.amount), 0))}</td><td>{money(l.totalDeductions)}</td><td>{money(l.net)}</td></tr>)}</tbody></table></div>}
    </div>
  </DashboardLayout>;
}
