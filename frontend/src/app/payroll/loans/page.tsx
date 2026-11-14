'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ChevronDown, ChevronRight, Plus, Trash2, Undo2, Wallet, TrendingUp, CheckCircle2, Clock3 } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Empty, Field, Modal, Spinner, Stat } from '@/components/ui/kit';
import { payrollAPI, staffAPI, apiError } from '@/lib/api';
import { CAN, can } from '@/lib/roles';
import { useAuthStore } from '@/store/authStore';
import { formatDate, formatPeriod, todayIso } from '@/lib/utils';
import { financeError, useAccounts, useFinance } from '@/components/finance/shared';
import { usePayrollRole } from '@/components/payroll/shared';

/** Money given to staff ahead of salary, and how much of it has come back. */
export default function LoansPage() {
  const qc = useQueryClient();
  const { money } = useFinance();
  const { canManage } = usePayrollRole();
  const [status, setStatus] = useState<'ACTIVE' | 'SETTLED' | 'PENDING' | ''>('');
  const role=useAuthStore(s=>s.user?.role);
  const approve=can(role,'approveLoan');
  const requests=useQuery({queryKey:['payroll','loan-requests'],queryFn:payrollAPI.loanRequests});
  const [adding, setAdding] = useState(false);
  const [repaying, setRepaying] = useState<any | null>(null);
  const [disbursing,setDisbursing]=useState<any|null>(null);
  const [paymentDate,setPaymentDate]=useState(todayIso());
  const [open, setOpen] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ['payroll', 'loans'], queryFn: () => payrollAPI.loans() });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['payroll'] }); qc.invalidateQueries({ queryKey: ['finance'] }); };
  const remove = useMutation({ mutationFn: (id: string) => payrollAPI.deleteLoan(id), onSuccess: (r) => { toast.success(r.data.message); refresh(); }, onError: financeError });
  const all=data?.loans??[];
  const loans = all.filter(l=>!status||l.status===status);
  const decide=useMutation({mutationFn:({id,yes}:{id:string;yes:boolean})=>payrollAPI.decideLoan(id,yes),onSuccess:()=>{toast.success('Decision saved');refresh();},onError:financeError});
  const pay=useMutation({mutationFn:({id,date}:{id:string;date:string})=>payrollAPI.disburseLoan(id,date),onSuccess:()=>{toast.success('Disbursement recorded');setDisbursing(null);refresh();},onError:financeError});
  const pending=(requests.data??[]).filter(r=>r.status!=='DISBURSED');
  const visibleRequests=pending.filter(r=>status!=='PENDING'||r.status==='PENDING');

  return (
    <DashboardLayout title="Advances & loans" allowedRoles={CAN.viewLoans} subtitle="Request → approval → disbursement → recovery"
      actions={canManage ? <button className="btn-primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> New advance / loan</button> : undefined}>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={Wallet} label="Total given" value={money(all.reduce((s,l)=>s+Number(l.amount),0))} sub="Disbursed advances and loans" />
        <Stat icon={TrendingUp} tone="warn" label="Outstanding balance" value={money(data?.totals.outstanding??0)} />
        <Stat icon={CheckCircle2} tone="good" label="Recovered amount" value={money(all.reduce((s,l)=>s+Number(l.repaid),0))} />
        <Stat icon={Clock3} label="Open cases" value={all.filter(l=>l.status==='ACTIVE').length} sub={`${pending.filter(r=>r.status==='PENDING').length} awaiting approval`} />
      </div>
      <div className="card space-y-3">
        <div className="flex flex-wrap gap-2 border-b border-slate-100 pb-3">{[['','All records'],['ACTIVE','Open'],['SETTLED','Completed'],['PENDING','Pending approval']].map(([v,label])=><button key={v} className={status===v?'btn-primary':'btn-secondary'} onClick={()=>setStatus(v as typeof status)}>{label}</button>)}</div>
        {(status===''||status==='PENDING')&&<section className="rounded-xl border border-violet-100 bg-violet-50/30 p-4"><h3 className="mb-3 text-sm font-semibold">Requests & approvals</h3>{requests.error?<p className="text-red-600">{apiError(requests.error)}</p>:!visibleRequests.length?<p className="text-sm text-slate-500">No pending requests.</p>:visibleRequests.map(r=><div key={r.id} className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-4 shadow-sm"><div><p className="font-semibold text-slate-800">{r.staff?.name??'Staff member'} <span className="badge badge-indigo">{r.details.kind}</span></p><p className="mt-1 text-sm text-slate-500">{money(r.details.amount)} · {r.status} · requested by {r.requestedBy??'Office'}</p><p className="mt-1 text-xs text-slate-400">{r.details.note??'No reason recorded'}{r.decidedBy?` · reviewed by ${r.decidedBy}`:''}</p></div><div className="flex gap-2">{approve&&r.status==='PENDING'&&<><button className="btn-primary" disabled={decide.isPending} onClick={()=>decide.mutate({id:r.id,yes:true})}>Approve</button><button className="btn-secondary" disabled={decide.isPending} onClick={()=>decide.mutate({id:r.id,yes:false})}>Reject</button></>}{canManage&&r.status==='APPROVED'&&<button className="btn-primary" disabled={pay.isPending} onClick={()=>{setPaymentDate(todayIso());setDisbursing(r);}}>Record disbursement</button>}</div></div>)}</section>}
        {status!=='PENDING'&&(isLoading ? <Spinner /> : error ? <p className="text-sm text-red-600">{apiError(error)}</p> : loans.length === 0 ? <Empty title={status === 'ACTIVE' ? 'Nobody owes anything' : 'Nothing to show'} /> : (
          <div className="table-container">
            <table className="table">
              <thead><tr><th /><th>No.</th><th>Staff</th><th>Given</th><th className="text-right">Amount</th><th className="text-right">Each month</th><th className="text-right">Paid back</th><th className="text-right">Still owed</th><th /></tr></thead>
              <tbody>
                {loans.map((l) => (
                  <Fragment key={l.id}>
                    <tr>
                      <td><button className="btn-icon btn-ghost" aria-label="Show repayments" onClick={() => setOpen(open === l.id ? null : l.id)}>{open === l.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button></td>
                      <td className="font-mono text-xs">{l.loanNo}<span className="block font-sans text-gray-500">{l.kind === 'ADVANCE' ? 'Advance' : 'Loan'}</span></td>
                      <td><Link href={`/staff/${l.staff.id}`} className="font-medium text-primary-700 hover:underline">{l.staff.name}</Link><span className="block text-xs text-gray-500">{l.staff.employeeNo}{l.staff.designation ? ` · ${l.staff.designation}` : ''}</span></td>
                      <td className="text-sm">{formatDate(l.issuedOn)}<span className="block text-xs text-gray-500">from {l.account.name}</span></td>
                      <td className="text-right tabular-nums">{money(l.amount)}</td>
                      <td className="text-right tabular-nums">{l.recoveryMethod==='MANUAL'?'Manual repayment':money(l.installment)}<span className="block text-xs text-gray-500">from {formatPeriod(l.startPeriod)}</span></td>
                      <td className="text-right tabular-nums text-emerald-700">{money(l.repaid)}</td>
                      <td className="text-right font-semibold tabular-nums">{l.status === 'SETTLED' ? <span className="badge badge-green">paid back</span> : money(l.outstanding)}</td>
                      <td><div className="flex justify-end gap-1">
                        {canManage && l.status === 'ACTIVE' && <button className="btn-icon btn-ghost" aria-label="Record cash repayment" title="Paid back in cash" onClick={() => setRepaying(l)}><Undo2 className="h-4 w-4" /></button>}
                        {canManage && l.repayments.length === 0 && <button className="btn-icon btn-ghost text-red-600" aria-label="Delete" disabled={remove.isPending}
                          onClick={() => window.confirm(`Delete ${l.loanNo}? Use this only if it was entered by mistake; the amount goes back into ${l.account.name}.`) && remove.mutate(l.id)}><Trash2 className="h-4 w-4" /></button>}
                      </div></td>
                    </tr>
                    {open === l.id && (
                      <tr className="bg-slate-50"><td /><td colSpan={8} className="text-sm">
                        <div className="mb-3 flex items-center gap-4"><div className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-emerald-400 bg-white font-bold text-emerald-700">{Math.round(Number(l.repaid)/Number(l.amount)*100)}%</div><div><p className="font-semibold">Recovery progress</p><p className="text-xs text-slate-500">{money(l.repaid)} recovered · {money(l.outstanding)} remaining</p></div></div>
                        {l.note && <p className="mb-1 text-gray-600">Note: {l.note}</p>}
                        {l.repayments.length === 0 ? <span className="text-gray-500">Nothing paid back yet.</span> : (
                          <ul className="space-y-0.5">{l.repayments.map((r: any) => (
                            <li key={r.id} className="flex justify-between gap-4"><span>{formatDate(r.paidOn)} · {r.fromSalary ? r.note ?? 'From salary' : `Cash into ${r.account}${r.note ? ` — ${r.note}` : ''}`}</span><span className="tabular-nums">{money(r.amount)}</span></li>
                          ))}</ul>
                        )}
                      </td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        <p className="text-xs text-gray-500">Salary recovery: each payroll takes the monthly amount from the person’s salary until nothing is owed. Manual-repayment loans are excluded. The accountant can change that amount on the payroll before it is approved.</p>
      </div>
      {adding && <LoanModal onClose={() => setAdding(false)} onSaved={refresh} />}
      {repaying && <RepayModal loan={repaying} onClose={() => setRepaying(null)} onSaved={refresh} />}
      {disbursing&&<Modal open onClose={()=>setDisbursing(null)} title="Record approved disbursement"><form className="space-y-4" onSubmit={e=>{e.preventDefault();pay.mutate({id:disbursing.id,date:paymentDate});}}><p className="rounded-xl bg-violet-50 p-4 text-sm text-violet-800">Pay {money(disbursing.details.amount)} to {disbursing.staff?.name}. The approved amount and source account stay fixed.</p><Field label="Actual payment date"><input className="input w-full" type="date" required max={todayIso()} value={paymentDate} onChange={e=>setPaymentDate(e.target.value)}/></Field><p className="text-xs text-slate-500">Salary recovery starts no earlier than the payment month. Only record this after the money has actually been handed over or transferred.</p><div className="flex justify-end gap-2"><button className="btn-secondary" type="button" onClick={()=>setDisbursing(null)}>Cancel</button><button className="btn-primary" disabled={pay.isPending}>Confirm disbursement</button></div></form></Modal>}
    </DashboardLayout>
  );
}

function LoanModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { money } = useFinance();
  const accounts = useAccounts();
  const staff = useQuery({ queryKey: ['staff', 'active-all'], queryFn: () => staffAPI.list({ limit: 200 }) });
  const today = todayIso();
  const [f, setF] = useState({ staffId: '', kind: 'ADVANCE', amount: '', issuedOn: today, accountId: '', installment: '', startPeriod: today.slice(0, 7), recoveryMethod:'SALARY', note: '' });
  const active = (accounts.data ?? []).filter((a) => a.isActive);
  const account = active.find((a) => a.id === f.accountId);
  const short = account && Number(f.amount) > Number(account.balance);
  const months = f.kind === 'LOAN' && Number(f.installment) > 0 ? Math.ceil(Number(f.amount) / Number(f.installment)) : 0;
  const save = useMutation({
    mutationFn: () => payrollAPI.addLoan({
      staffId: f.staffId, kind: f.kind, recoveryMethod:f.recoveryMethod, amount: Number(f.amount), issuedOn: f.issuedOn, accountId: f.accountId, startPeriod: f.startPeriod,
      installment: f.kind === 'LOAN' && f.recoveryMethod==='SALARY' ? Number(f.installment) : undefined, note: f.note.trim() || undefined,
    }),
    onSuccess: (r) => { toast.success(r.data.message, { duration: 5000 }); onSaved(); onClose(); }, onError: financeError,
  });
  return (
    <Modal open onClose={onClose} title="Request advance or loan">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label="Staff member"><select required className="select" value={f.staffId} onChange={(e) => setF({ ...f, staffId: e.target.value })}>
          <option value="">Choose…</option>{(staff.data?.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name} ({s.employeeNo})</option>)}</select></Field>
        <div className="grid grid-cols-2 gap-2">
          {[['ADVANCE', 'Salary advance', 'Taken back in full from the next salary'], ['LOAN', 'Loan', 'Taken back in monthly instalments']].map(([v, l, h]) => (
            <label key={v} className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${f.kind === v ? 'border-primary-400 bg-primary-50' : 'border-slate-200'}`}>
              <input type="radio" name="kind" className="sr-only" checked={f.kind === v} onChange={() => setF({ ...f, kind: v })} />
              <span className="font-medium">{l}</span><span className="block text-xs text-gray-500">{h}</span>
            </label>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount"><input type="number" required min={0.01} step="0.01" className="input" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Paid from" hint={account ? `Holds ${money(account.balance)}` : undefined}><select required className="select" value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>
            <option value="">Choose…</option>{active.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
          <Field label="Recovery method"><select className="select w-full" value={f.recoveryMethod} onChange={e=>setF({...f,recoveryMethod:e.target.value})}><option value="SALARY">Monthly salary deduction</option><option value="MANUAL">Manual repayment</option></select></Field><Field label="Given on"><input type="date" required className="input" max={today} value={f.issuedOn} onChange={(e) => setF({ ...f, issuedOn: e.target.value, startPeriod: e.target.value.slice(0, 7) > f.startPeriod ? e.target.value.slice(0, 7) : f.startPeriod })} /></Field>
          <Field label="Recover starting with"><input type="month" required className="input" min={f.issuedOn.slice(0, 7)} value={f.startPeriod} onChange={(e) => setF({ ...f, startPeriod: e.target.value })} /></Field>
          {f.kind === 'LOAN' && f.recoveryMethod==='SALARY' && <Field label="Monthly instalment" hint={months ? `About ${months} month${months > 1 ? 's' : ''}` : undefined} className="sm:col-span-2">
            <input type="number" required min={0.01} max={f.amount || undefined} step="0.01" className="input" value={f.installment} onChange={(e) => setF({ ...f, installment: e.target.value })} /></Field>}
        </div>
        {short && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{account.name} holds only {money(account.balance)}.</p>}
        <Field label="Reason"><input className="input" required maxLength={300} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <p className="rounded-xl bg-violet-50 p-3 text-xs text-violet-700">Submit request → authorized approval → accountant records payment. No funds leave the account before approval and disbursement.</p>
        <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={save.isPending}>Submit request</button></div>
      </form>
    </Modal>
  );
}

function RepayModal({ loan, onClose, onSaved }: { loan: any; onClose: () => void; onSaved: () => void }) {
  const { money } = useFinance();
  const accounts = useAccounts();
  const [f, setF] = useState({ amount: String(Number(loan.outstanding)), paidOn: todayIso(), accountId: '', note: '' });
  const save = useMutation({
    mutationFn: () => payrollAPI.repayLoan(loan.id, { amount: Number(f.amount), paidOn: f.paidOn, accountId: f.accountId, note: f.note.trim() || undefined }),
    onSuccess: (r) => { toast.success(r.data.message); onSaved(); onClose(); }, onError: financeError,
  });
  return (
    <Modal open onClose={onClose} title={`${loan.staff.name} pays back — ${loan.loanNo}`}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <p className="text-sm text-gray-600">Still owed: <b className="text-gray-900">{money(loan.outstanding)}</b>. Use this when the money is handed back, not taken from salary.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount"><input type="number" required min={0.01} max={Number(loan.outstanding)} step="0.01" className="input" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Date"><input type="date" required className="input" min={loan.issuedOn} max={todayIso()} value={f.paidOn} onChange={(e) => setF({ ...f, paidOn: e.target.value })} /></Field>
        </div>
        <Field label="Received in"><select required className="select" value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>
          <option value="">Choose…</option>{(accounts.data ?? []).filter((a) => a.isActive).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <Field label="Note" hint="Optional"><input className="input" maxLength={300} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={save.isPending}>Save</button></div>
      </form>
    </Modal>
  );
}
