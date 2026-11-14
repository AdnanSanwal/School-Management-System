'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Users, Wallet, Clock3, CheckCircle2, ArrowRight } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Empty, Field, Modal, Spinner, Stat } from '@/components/ui/kit';
import { payrollAPI, apiError } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { formatDate, todayIso } from '@/lib/utils';
import { useFinance, financeError } from '@/components/finance/shared';
import { PayrollBadge, usePayrollRole } from '@/components/payroll/shared';

/** Every month's payroll and where it stands. */
export default function PayrollPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { money } = useFinance();
  const { canManage } = usePayrollRole();
  const { data, isLoading, error } = useQuery({ queryKey: ['payroll', 'runs'], queryFn: payrollAPI.runs });
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState(todayIso().slice(0, 7));
  const [filter,setFilter]=useState('');
  const selected=data?.find(r=>r.period===period);
  const detail=useQuery({queryKey:['payroll','run',selected?.id],queryFn:()=>payrollAPI.run(selected!.id),enabled:!!selected});
  const prepare = useMutation({
    mutationFn: () => payrollAPI.prepare(period),
    onSuccess: (r) => { toast.success(r.data.message, { duration: 6000 }); qc.invalidateQueries({ queryKey: ['payroll'] }); router.push(`/payroll/${r.data.data.id}`); },
    onError: financeError,
  });

  return (
    <DashboardLayout title="Payroll" allowedRoles={CAN.viewPayroll} subtitle="Prepared by the accountant, approved by the owner, then paid"
      actions={canManage ? <button className="btn-primary" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Prepare payroll</button> : undefined}>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 mb-4">
        <Stat icon={Users} label="Staff in payroll" value={selected?.staff??0} sub={period}/>
        <Stat icon={Wallet} tone="good" label="Total net salary" value={money(selected?.net??0)} sub="Selected monthly run"/>
        <Stat icon={Clock3} tone="warn" label="Pending approval" value={selected?.status==='SUBMITTED'?selected.staff:0} sub="Staff awaiting run approval"/>
        <Stat icon={CheckCircle2} tone="good" label="Paid staff" value={selected?.status==='PAID'?selected.staff:0} sub="Payment is recorded for the entire run"/>
      </div>
      <div className="card mb-4"><div className="flex flex-wrap items-end justify-between gap-4"><Field label="Monthly payroll"><input type="month" className="input" value={period} max={todayIso().slice(0,7)} onChange={e=>setPeriod(e.target.value)}/></Field><div className="flex gap-2">{selected?<Link className="btn-primary" href={`/payroll/${selected.id}`}>Review monthly run <ArrowRight className="h-4 w-4"/></Link>:canManage&&<button className="btn-primary" disabled={prepare.isPending||!period} onClick={()=>prepare.mutate()}>Generate monthly payroll</button>}</div></div><div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4">{['Prepare','Submit','Approval','Payment','Paid'].map((s,i)=><span key={s} className="rounded-xl bg-violet-50 px-3 py-2 text-xs font-medium text-violet-700">{i+1}. {s}</span>)}</div><p className="mt-3 text-xs text-slate-500">One monthly run covers all eligible staff. Review deductions, obtain approval, then record one payment for the run.</p></div>
      {detail.data&&<div className="card mb-4"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">{detail.data.label} · Staff salary breakdown</h3><PayrollBadge status={detail.data.status}/></div>{detail.data.missing.length>0&&<p className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{detail.data.missing.length} staff have no effective salary structure and are not yet included. Set their salaries and recalculate the draft.</p>}<div className="table-container"><table className="table"><thead><tr><th>Staff</th><th>Basic</th><th>Allowances</th><th>Deductions</th><th>Net salary</th><th>Status</th></tr></thead><tbody>{detail.data.lines.map(l=><tr key={l.id}><td><p className="font-medium">{l.name}</p><p className="text-xs text-slate-400">{l.designation??l.employeeNo}</p></td><td>{money(l.basic)}</td><td>{money(l.allowances.reduce((n,a)=>n+Number(a.amount),0))}</td><td className="text-red-600">{money(l.totalDeductions)}</td><td className="font-semibold">{money(l.net)}</td><td><PayrollBadge status={detail.data!.status}/></td></tr>)}</tbody></table></div></div>}
      {detail.error&&<p role="alert" className="mb-4 text-red-600">{apiError(detail.error)}</p>}
      <div className="card">
        <div className="mb-4 flex flex-wrap gap-2">{[['','All runs'],['SUBMITTED','Pending approval'],['APPROVED','Approved'],['PAID','Paid']].map(([v,label])=><button key={v} className={filter===v?'btn-primary':'btn-secondary'} onClick={()=>setFilter(v)}>{label}</button>)}</div>
        {isLoading ? <Spinner /> : error ? <p className="text-sm text-red-600">{apiError(error)}</p> : !data?.length ? (
          <Empty title="No payroll yet">{canManage ? 'Choose “Prepare payroll” to work out this month’s salaries.' : 'The accountant has not prepared a payroll yet.'}</Empty>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead><tr><th>Month</th><th>Status</th><th className="text-right">Staff</th><th className="text-right">Gross</th><th className="text-right">Deductions</th><th className="text-right">Net pay</th><th>Paid on</th><th /></tr></thead>
              <tbody>
                {data.filter(r=>!filter||r.status===filter).map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium">{r.label}</td>
                    <td><PayrollBadge status={r.status} /></td>
                    <td className="text-right tabular-nums">{r.staff}</td>
                    <td className="text-right tabular-nums">{money(r.gross)}</td>
                    <td className="text-right tabular-nums text-red-600">{money(r.deductions)}</td>
                    <td className="text-right font-semibold tabular-nums">{money(r.net)}</td>
                    <td className="text-sm">{r.paymentDate ? formatDate(r.paymentDate) : '—'}</td>
                    <td className="text-right"><Link href={`/payroll/${r.id}`} className="text-sm font-medium text-primary-700 hover:underline">Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Prepare payroll">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); prepare.mutate(); }}>
          <Field label="Month" hint="Salaries, absences, unpaid leave and loan instalments are worked out for this month. You can review and change every line before sending it to the owner.">
            <input type="month" required className="input" value={period} max={todayIso().slice(0, 7)} onChange={(e) => setPeriod(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button><button className="btn-primary" disabled={prepare.isPending}>Prepare</button></div>
        </form>
      </Modal>
    </DashboardLayout>
  );
}
