'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { AlertTriangle, ArrowLeft, Check, Download, Pencil, Printer, RefreshCw, RotateCcw, Search, Send, Trash2, Wallet, X } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Field, Modal, Spinner, Stat } from '@/components/ui/kit';
import { payrollAPI, apiError, PayrollLine, PayrollRun } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { formatDate, todayIso } from '@/lib/utils';
import { financeError, useAccounts, useFinance } from '@/components/finance/shared';
import { PayrollBadge, days, usePayrollRole } from '@/components/payroll/shared';

/** One month's payroll: review each line, send for approval, approve, pay. */
export default function PayrollRunPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { money } = useFinance();
  const { canManage, canApprove } = usePayrollRole();
  const { data: run, isLoading, error } = useQuery({ queryKey: ['payroll', 'run', id], queryFn: () => payrollAPI.run(id) });
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<PayrollLine | null>(null);
  const [paying, setPaying] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['payroll'] }); qc.invalidateQueries({ queryKey: ['finance'] }); };
  const act = (fn: () => Promise<{ data: { message: string } }>, after?: () => void) => ({
    mutationFn: fn, onSuccess: (r: { data: { message: string } }) => { toast.success(r.data.message); refresh(); after?.(); }, onError: financeError,
  });
  const recalc = useMutation(act(() => payrollAPI.recalculate(id)));
  const reset = useMutation(act(() => payrollAPI.recalculate(id, true)));
  const submit = useMutation(act(() => payrollAPI.submit(id)));
  const reopen = useMutation(act(() => payrollAPI.reopen(id)));
  const remove = useMutation(act(() => payrollAPI.remove(id), () => router.push('/payroll')));
  const decide = useMutation({
    mutationFn: (v: { approve: boolean; note?: string }) => payrollAPI.decide(id, v.approve, v.note),
    onSuccess: (r) => { toast.success(r.data.message); refresh(); }, onError: financeError,
  });
  const sheet = useMutation({ mutationFn: (format: 'xlsx' | 'pdf') => payrollAPI.bankSheet(id, format), onError: financeError });
  const sendBack = () => {
    const note = window.prompt('What should the accountant fix?');
    if (note !== null) decide.mutate({ approve: false, note: note.trim() || undefined });
  };
  const lines = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (run?.lines ?? []).filter((l) => !term || `${l.name} ${l.employeeNo} ${l.designation ?? ''}`.toLowerCase().includes(term));
  }, [run, search]);
  const draft = run?.status === 'DRAFT';
  const busy = recalc.isPending || reset.isPending || submit.isPending || reopen.isPending || remove.isPending || decide.isPending;

  return (
    <DashboardLayout title={run ? `Payroll — ${run.label}` : 'Payroll'} allowedRoles={CAN.viewPayroll}
      subtitle={run ? [run.createdBy && `Prepared by ${run.createdBy}`, run.status !== 'DRAFT' && run.decidedBy && `approved by ${run.decidedBy}`, run.paymentDate && `paid ${formatDate(run.paymentDate)} from ${run.account}`].filter(Boolean).join(' · ') : undefined}
      actions={run ? <>
        <Link href="/payroll" className="btn-secondary"><ArrowLeft className="h-4 w-4" /> All months</Link>
        {draft && canManage && <>
          <button className="btn-secondary" disabled={busy} onClick={() => recalc.mutate()} title="Pick up new attendance, leave and salary changes; your own edits are kept"><RefreshCw className="h-4 w-4" /> Recalculate</button>
          <button className="btn-primary" disabled={busy} onClick={() => window.confirm(`Send ${run.label} payroll (${money(run.totals.net)}) to the owner for approval?`) && submit.mutate()}><Send className="h-4 w-4" /> Send for approval</button>
        </>}
        {run.status === 'SUBMITTED' && canApprove && <>
          <button className="btn-secondary" disabled={busy} onClick={sendBack}><X className="h-4 w-4" /> Send back</button>
          <button className="btn-primary" disabled={busy} onClick={() => window.confirm(`Approve ${run.label} payroll of ${money(run.totals.net)}?`) && decide.mutate({ approve: true })}><Check className="h-4 w-4" /> Approve</button>
        </>}
        {(run.status === 'SUBMITTED' || run.status === 'APPROVED') && canManage && <button className="btn-secondary" disabled={busy} onClick={() => window.confirm('Reopen as a draft? It will need the owner’s approval again.') && reopen.mutate()}><RotateCcw className="h-4 w-4" /> Reopen</button>}
        {run.status === 'APPROVED' && canManage && <button className="btn-primary" onClick={() => setPaying(true)}><Wallet className="h-4 w-4" /> Pay salaries</button>}
      </> : undefined}>
      {isLoading ? <Spinner /> : error ? <div className="card text-sm text-red-600">{apiError(error)}</div> : run && (
        <>
          <StatusNote run={run} canManage={canManage} canApprove={canApprove} />
          {run.missing.length > 0 && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
              <span><b>{run.missing.length} active staff are not on this payroll</b> because no salary is set: {run.missing.map((m, i) => (
                <span key={m.id}>{i > 0 && ', '}<Link href={`/staff/${m.id}`} className="underline">{m.name}</Link></span>
              ))}. Set their salary, then choose Recalculate.</span>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Net pay" tone="good" value={money(run.totals.net)} sub={`${run.totals.staff} staff`} />
            <Stat label="Gross salaries" value={money(run.totals.gross)} sub={Number(run.totals.bonus) ? `plus ${money(run.totals.bonus)} bonus` : 'Basic + allowances'} />
            <Stat label="Absence deductions" tone={Number(run.totals.absence) ? 'warn' : 'default'} value={money(run.totals.absence)} sub="Absent, unpaid leave, part month" />
            <Stat label="Advances & loans recovered" value={money(run.totals.loans)} sub={`All deductions ${money(run.totals.deductions)}`} />
          </div>

          <div className="card space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="relative w-72 max-w-full">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                <input className="input pl-9" placeholder="Name, employee no." value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search staff" />
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn-secondary" disabled={sheet.isPending} onClick={() => sheet.mutate('xlsx')}><Download className="h-4 w-4" /> Bank sheet (Excel)</button>
                <button className="btn-secondary" disabled={sheet.isPending} onClick={() => sheet.mutate('pdf')}><Download className="h-4 w-4" /> PDF</button>
              </div>
            </div>
            <div className="table-container">
              <table className="table">
                <thead><tr>
                  <th>Staff</th><th className="text-right">Gross</th><th className="text-right">Days deducted</th><th className="text-right">Absence</th>
                  <th className="text-right">Tax & fixed</th><th className="text-right">Advance / loan</th><th className="text-right">Bonus</th><th className="text-right">Other</th><th className="text-right">Net pay</th><th />
                </tr></thead>
                <tbody>
                  {lines.map((l) => {
                    const fixed = l.fixedDeductions.reduce((t, c) => t + c.amount, 0);
                    const why = [Number(l.absentDays) && `${days(l.absentDays)} absent`, Number(l.unpaidLeaveDays) && `${days(l.unpaidLeaveDays)} unpaid leave`, Number(l.notEmployedDays) && `${days(l.notEmployedDays)} not employed`].filter(Boolean).join(', ');
                    return (
                      <tr key={l.id}>
                        <td><Link href={`/staff/${l.staffId}`} className="font-medium text-primary-700 hover:underline">{l.name}</Link>
                          <span className="block text-xs text-gray-500">{l.employeeNo}{l.designation ? ` · ${l.designation}` : ''}</span>
                          {l.remarks && <span className="block text-xs italic text-gray-500">{l.remarks}</span>}</td>
                        <td className="text-right tabular-nums">{money(l.gross)}</td>
                        <td className="text-right tabular-nums">{Number(l.deductDays) ? days(l.deductDays) : '—'}
                          {(why || l.deductDaysManual) && <span className="block text-xs text-gray-500">{l.deductDaysManual ? `changed by hand${why ? ` (was: ${why})` : ''}` : why}</span>}</td>
                        <td className="text-right tabular-nums text-red-600">{Number(l.absenceDeduction) ? money(l.absenceDeduction) : '—'}</td>
                        <td className="text-right tabular-nums">{fixed ? money(fixed) : '—'}</td>
                        <td className="text-right tabular-nums">{Number(l.loanDeduction) ? money(l.loanDeduction) : '—'}</td>
                        <td className="text-right tabular-nums text-emerald-700">{Number(l.bonus) ? money(l.bonus) : '—'}</td>
                        <td className="text-right tabular-nums">{Number(l.otherDeduction) ? money(l.otherDeduction) : '—'}</td>
                        <td className="text-right font-semibold tabular-nums">{money(l.net)}</td>
                        <td><div className="flex justify-end gap-1">
                          {draft && canManage && <button className="btn-icon btn-ghost" aria-label={`Change ${l.name}`} onClick={() => setEditing(l)}><Pencil className="h-4 w-4" /></button>}
                          <Link href={`/payroll/payslip/${l.id}`} className="btn-icon btn-ghost" aria-label={`Payslip of ${l.name}`}><Printer className="h-4 w-4" /></Link>
                        </div></td>
                      </tr>
                    );
                  })}
                </tbody>
                {!search && (
                  <tfoot><tr className="bg-slate-50 font-semibold">
                    <td className="px-4 py-3 text-sm">Total ({run.totals.staff})</td>
                    <td className="px-4 py-3 text-right text-sm tabular-nums">{money(run.totals.gross)}</td><td />
                    <td className="px-4 py-3 text-right text-sm tabular-nums">{money(run.totals.absence)}</td><td />
                    <td className="px-4 py-3 text-right text-sm tabular-nums">{money(run.totals.loans)}</td>
                    <td className="px-4 py-3 text-right text-sm tabular-nums">{money(run.totals.bonus)}</td><td />
                    <td className="px-4 py-3 text-right text-sm tabular-nums">{money(run.totals.net)}</td><td />
                  </tr></tfoot>
                )}
              </table>
            </div>
            <p className="text-xs text-gray-500">One day’s pay is the gross salary divided by the days in the month. Days deducted come from staff attendance (absent = 1, half day = ½), unpaid leave, and days before joining or after leaving.</p>
            {draft && canManage && (
              <div className="flex flex-wrap gap-4 border-t border-slate-100 pt-3 text-sm">
                <button className="text-gray-600 hover:underline" disabled={busy} onClick={() => window.confirm('Throw away every change made by hand and work everything out again?') && reset.mutate()}>Recalculate from scratch</button>
                <button className="inline-flex items-center gap-1 text-red-600 hover:underline" disabled={busy} onClick={() => window.confirm(`Delete the draft payroll for ${run.label}?`) && remove.mutate()}><Trash2 className="h-4 w-4" /> Delete this draft</button>
              </div>
            )}
          </div>
        </>
      )}
      {editing && <LineModal line={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      {paying && run && <PayModal run={run} onClose={() => setPaying(false)} onPaid={refresh} />}
    </DashboardLayout>
  );
}

function StatusNote({ run, canManage, canApprove }: { run: PayrollRun; canManage: boolean; canApprove: boolean }) {
  const text = {
    DRAFT: canManage ? 'Draft. Check each line, change what needs changing, then send it to the owner for approval.' : 'The accountant is still preparing this payroll.',
    SUBMITTED: canApprove ? 'Waiting for your approval. Review the lines below, then approve or send it back.' : 'Waiting for the owner’s approval. Nothing can be changed until then.',
    APPROVED: canManage ? 'Approved by the owner. Download the bank sheet, then choose “Pay salaries” once the money has gone out.' : 'Approved. The accountant can now pay it.',
    PAID: 'Paid. Payslips are available to the staff, and the amount is recorded under Expenses → Salaries.',
  }[run.status];
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
      <PayrollBadge status={run.status} />
      <span className="text-gray-700">{text}</span>
      {run.status === 'DRAFT' && run.decisionNote && <span className="rounded-lg bg-amber-50 px-2 py-1 text-amber-800">Owner’s note: {run.decisionNote}</span>}
    </div>
  );
}

/** The accountant's review of one person. */
function LineModal({ line, onClose, onSaved }: { line: PayrollLine; onClose: () => void; onSaved: () => void }) {
  const { money } = useFinance();
  const [f, setF] = useState({
    deductDays: String(Number(line.deductDays)), loanDeduction: String(Number(line.loanDeduction)),
    bonus: String(Number(line.bonus)), otherDeduction: String(Number(line.otherDeduction)), remarks: line.remarks ?? '',
  });
  const n = (v: string) => Number(v || 0);
  const fixed = line.fixedDeductions.reduce((t, c) => t + c.amount, 0);
  const absence = Math.round((Number(line.gross) * n(f.deductDays) / line.daysInMonth) * 100) / 100;
  const net = Number(line.gross) + n(f.bonus) - fixed - absence - n(f.loanDeduction) - n(f.otherDeduction);
  const auto = Number(line.absentDays) + Number(line.unpaidLeaveDays) + Number(line.notEmployedDays);
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { bonus: n(f.bonus), otherDeduction: n(f.otherDeduction), remarks: f.remarks.trim() || null };
      // Only what was really changed counts as a hand-made override.
      if (n(f.deductDays) !== Number(line.deductDays)) body.deductDays = n(f.deductDays);
      if (n(f.loanDeduction) !== Number(line.loanDeduction)) body.loanDeduction = n(f.loanDeduction);
      return payrollAPI.updateLine(line.id, body);
    },
    onSuccess: () => { toast.success('Saved'); onSaved(); onClose(); }, onError: financeError,
  });
  return (
    <Modal open onClose={onClose} title={`${line.name} — ${line.employeeNo}`}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <dl className="grid grid-cols-2 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <dt className="text-gray-500">Gross salary</dt><dd className="text-right tabular-nums">{money(line.gross)}</dd>
          <dt className="text-gray-500">One day’s pay</dt><dd className="text-right tabular-nums">{money(Math.round(Number(line.gross) / line.daysInMonth))}</dd>
          <dt className="text-gray-500">From attendance and leave</dt>
          <dd className="text-right">{days(line.absentDays)} absent · {days(line.unpaidLeaveDays)} unpaid leave{Number(line.notEmployedDays) ? ` · ${days(line.notEmployedDays)} not employed` : ''}</dd>
        </dl>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Days to deduct" hint={`Worked out: ${days(auto)}. Deducts ${money(absence)}`}>
            <input type="number" min={0} max={line.daysInMonth} step="0.5" required className="input" value={f.deductDays} onChange={(e) => setF({ ...f, deductDays: e.target.value })} /></Field>
          <Field label="Advance / loan recovery" hint="Taken from this salary">
            <input type="number" min={0} step="0.01" className="input" value={f.loanDeduction} onChange={(e) => setF({ ...f, loanDeduction: e.target.value })} /></Field>
          <Field label="Bonus / extra pay" hint="Added to this salary only">
            <input type="number" min={0} step="0.01" className="input" value={f.bonus} onChange={(e) => setF({ ...f, bonus: e.target.value })} /></Field>
          <Field label="Other deduction" hint="e.g. a fine or damage">
            <input type="number" min={0} step="0.01" className="input" value={f.otherDeduction} onChange={(e) => setF({ ...f, otherDeduction: e.target.value })} /></Field>
        </div>
        <Field label="Note" hint="Printed on the payslip"><input className="input" maxLength={300} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field>
        <div className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold ${net < 0 ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`}>
          <span>{net < 0 ? 'Deductions are more than the pay' : 'Net pay'}</span><span className="tabular-nums">{money(net)}</span>
        </div>
        <div className="flex justify-end gap-2 pt-1"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={save.isPending || net < 0}>Save</button></div>
      </form>
    </Modal>
  );
}

function PayModal({ run, onClose, onPaid }: { run: PayrollRun; onClose: () => void; onPaid: () => void }) {
  const { money } = useFinance();
  const accounts = useAccounts();
  const active = (accounts.data ?? []).filter((a) => a.isActive);
  const [f, setF] = useState({ accountId: '', paymentDate: todayIso() });
  const account = active.find((a) => a.id === f.accountId);
  const short = account && Number(account.balance) < Number(run.totals.net);
  const pay = useMutation({
    mutationFn: () => payrollAPI.pay(run.id, f),
    onSuccess: (r) => { toast.success(r.data.message, { duration: 6000 }); onPaid(); onClose(); }, onError: financeError,
  });
  return (
    <Modal open onClose={onClose} title={`Pay salaries — ${run.label}`}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); pay.mutate(); }}>
        <p className="text-sm text-gray-600"><b className="text-gray-900">{money(run.totals.net)}</b> for {run.totals.staff} staff leaves the account you choose and is recorded as a Salaries expense.
          {Number(run.totals.loans) > 0 && <> {money(run.totals.loans)} of advances and loans is marked as recovered.</>} This can’t be undone.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Pay from" hint={account ? `Holds ${money(account.balance)}` : undefined}><select required className="select" value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>
            <option value="">Choose…</option>{active.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
          <Field label="Payment date"><input type="date" required className="input" max={todayIso()} value={f.paymentDate} onChange={(e) => setF({ ...f, paymentDate: e.target.value })} /></Field>
        </div>
        {short && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{account.name} holds only {money(account.balance)}. Transfer money into it first (Finance → Accounts).</p>}
        <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={pay.isPending || !!short}>Pay {money(run.totals.net)}</button></div>
      </form>
    </Modal>
  );
}
