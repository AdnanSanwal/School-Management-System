'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Field, Modal } from '@/components/ui/kit';
import { payrollAPI, PayrollRun } from '@/lib/api';
import { todayIso } from '@/lib/utils';
import { useFinance, useAccounts, financeError } from '@/components/finance/shared';

export function PayrollPayment({ run, onClose, onPaid, inline = false }: { run: PayrollRun; onClose: () => void; onPaid: () => void; inline?: boolean }) {
  const { money } = useFinance();
  const accounts = useAccounts();
  const active = (accounts.data ?? []).filter((a) => a.isActive);
  const [f, setF] = useState({ accountId: '', paymentDate: todayIso(),paymentReference:'',paymentRemarks:'' });
  const account = active.find((a) => a.id === f.accountId);
  const short = account && Number(account.balance) < Number(run.totals.net);
  const pay = useMutation({
    mutationFn: () => payrollAPI.pay(run.id, f),
    onSuccess: (r) => { toast.success(r.data.message, { duration: 6000 }); onPaid(); onClose(); }, onError: financeError,
  });
  const content = (
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); pay.mutate(); }}>
        <p className="text-sm text-gray-600"><b className="text-gray-900">{money(run.totals.net)}</b> for {run.totals.staff} staff leaves the account you choose and is recorded as a Salaries expense.
          {Number(run.totals.loans) > 0 && <> {money(run.totals.loans)} of advances and loans is marked as recovered.</>} This can’t be undone.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Pay from" hint={account ? `Holds ${money(account.balance)}` : undefined}><select required className="select" value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>
            <option value="">Choose…</option>{active.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
          <Field label="Payment date"><input type="date" required className="input" max={todayIso()} value={f.paymentDate} onChange={(e) => setF({ ...f, paymentDate: e.target.value })} /></Field>
        </div>
        {short && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{account.name} holds only {money(account.balance)}. Transfer money into it first (Finance → Accounts).</p>}
        <Field label="Transaction reference"><input className="input w-full" maxLength={120} value={f.paymentReference} onChange={e=>setF({...f,paymentReference:e.target.value})}/></Field><Field label="Payment remarks"><textarea className="input w-full" maxLength={300} value={f.paymentRemarks} onChange={e=>setF({...f,paymentRemarks:e.target.value})}/></Field><div className="flex justify-end gap-2 pt-2">{!inline && <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>}<button className="btn-primary" disabled={pay.isPending || !!short}>{inline ? 'Record payment' : 'Pay'} {money(run.totals.net)}</button></div>
      </form>
  );
  return inline ? content : <Modal open onClose={onClose} title={`Pay salaries — ${run.label}`}>{content}</Modal>;
}
