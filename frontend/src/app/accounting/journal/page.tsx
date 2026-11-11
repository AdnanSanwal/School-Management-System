'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Trash2, X } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Empty, Field, Modal, Spinner } from '@/components/ui/kit';
import { ledgerAPI, apiError } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { formatDate, todayIso } from '@/lib/utils';
import { financeError, useFinance, useFinanceRefresh } from '@/components/finance/shared';

const KIND: Record<string, string> = {
  OPENING: 'Opening', FEES: 'Fees', INCOME: 'Income', EXPENSE: 'Expense', OWNER: 'Owner', ADJUSTMENT: 'Correction',
  TRANSFER: 'Transfer', ADVANCE: 'Advance', RECOVERY: 'Recovery', REPAYMENT: 'Repayment', JOURNAL: 'Journal',
};

/** Every posting in double-entry form. Most post themselves; hand-made entries are added here. */
export default function JournalPage() {
  const { money, canManage } = useFinance();
  const refresh = useFinanceRefresh();
  const today = todayIso();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [only, setOnly] = useState('');
  const [adding, setAdding] = useState(false);
  const { data, isLoading, error } = useQuery({ queryKey: ['finance', 'ledger', 'journal', from, to], queryFn: () => ledgerAPI.journal({ from, to }), enabled: from <= to });
  const remove = useMutation({ mutationFn: (id: string) => ledgerAPI.deleteJournal(id), onSuccess: (r) => { toast.success(r.data.message); refresh(); }, onError: financeError });
  const entries = (data?.entries ?? []).filter((e) => !only || e.kind === only);

  return (
    <DashboardLayout title="Journal" allowedRoles={CAN.viewFinance} subtitle="Every entry in the books: which account was debited and which was credited"
      actions={canManage ? <button className="btn-primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Journal entry</button> : undefined}>
      <div className="card space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <label><span className="label">From</span><input type="date" className="input" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
          <label><span className="label">To</span><input type="date" className="input" value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
          <label><span className="label">Show</span><select className="select w-44" value={only} onChange={(e) => setOnly(e.target.value)}>
            <option value="">Everything</option>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          {data && <p className="ml-auto text-sm text-gray-500">{entries.length} entries{!only && <> · {money(data.total)} posted</>}</p>}
        </div>
        {isLoading ? <Spinner /> : error ? <p className="text-sm text-red-600">{apiError(error)}</p> : entries.length === 0 ? <Empty title="No entries in these dates" /> : (
          <div className="table-container">
            <table className="table">
              <thead><tr><th>Date</th><th>Entry</th><th>Account</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th /></tr></thead>
              <tbody>
                {entries.map((e) => e.lines.map((l, i) => (
                  <tr key={`${e.kind}-${e.id}-${i}`} className={i === 0 ? 'border-t-2 border-slate-200' : ''}>
                    {i === 0 && <>
                      <td rowSpan={e.lines.length} className="whitespace-nowrap align-top text-sm">{formatDate(e.date)}</td>
                      <td rowSpan={e.lines.length} className="align-top text-sm"><span className="badge badge-gray mr-2">{KIND[e.kind] ?? e.kind}</span>{e.description}
                        {e.reference && <span className="block font-mono text-xs text-gray-500">{e.reference}</span>}</td>
                    </>}
                    <td className={`text-sm ${Number(l.credit) ? 'pl-10' : ''}`}><span className="mr-2 font-mono text-xs text-gray-400">{l.code}</span>{l.name}</td>
                    <td className="text-right tabular-nums">{Number(l.debit) ? money(l.debit) : ''}</td>
                    <td className="text-right tabular-nums">{Number(l.credit) ? money(l.credit) : ''}</td>
                    {i === 0 && <td rowSpan={e.lines.length} className="align-top">{canManage && e.manual && (
                      <button className="btn-icon btn-ghost text-red-600" aria-label="Remove entry" disabled={remove.isPending} onClick={() => window.confirm('Remove this journal entry?') && remove.mutate(e.id)}><Trash2 className="h-4 w-4" /></button>
                    )}</td>}
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-gray-500">Fee receipts, expenses, income, payroll, advances and transfers post themselves and are changed where they were entered. Use a journal entry for anything else, such as buying equipment or taking a bank loan.</p>
      </div>
      {adding && <JournalModal onClose={() => setAdding(false)} />}
    </DashboardLayout>
  );
}

type Line = { accountId: string; debit: string; credit: string };
const blank = (): Line => ({ accountId: '', debit: '', credit: '' });

function JournalModal({ onClose }: { onClose: () => void }) {
  const { money } = useFinance();
  const refresh = useFinanceRefresh();
  const accounts = useQuery({ queryKey: ['finance', 'ledger', 'accounts'], queryFn: ledgerAPI.accounts });
  const [f, setF] = useState({ date: todayIso(), description: '', reference: '' });
  const [lines, setLines] = useState<Line[]>([blank(), blank()]);
  const set = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const debit = lines.reduce((t, l) => t + Number(l.debit || 0), 0);
  const credit = lines.reduce((t, l) => t + Number(l.credit || 0), 0);
  const filled = lines.filter((l) => l.accountId && (Number(l.debit) > 0 || Number(l.credit) > 0));
  const ok = filled.length >= 2 && debit > 0 && Math.abs(debit - credit) < 0.005;
  const usable = (accounts.data ?? []).filter((a) => a.isActive && a.systemKey !== 'STAFF_ADVANCES');
  const groups: [string, string][] = [['ASSET', 'Assets'], ['LIABILITY', 'Liabilities'], ['EQUITY', 'Owner’s funds'], ['INCOME', 'Income'], ['EXPENSE', 'Expenses']];
  const save = useMutation({
    mutationFn: () => ledgerAPI.addJournal({ date: f.date, description: f.description.trim(), reference: f.reference.trim() || undefined, lines: filled.map((l) => ({ accountId: l.accountId, debit: Number(l.debit || 0), credit: Number(l.credit || 0) })) }),
    onSuccess: (r) => { toast.success(r.data.message); refresh(); onClose(); }, onError: financeError,
  });
  return (
    <Modal open onClose={onClose} title="Journal entry" wide>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ok) save.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Date"><input type="date" required className="input" max={todayIso()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="What is it for?" className="sm:col-span-2"><input required minLength={2} maxLength={300} className="input" placeholder="e.g. 20 desks bought for class 5" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Reference"><input className="input" maxLength={100} placeholder="Optional" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        </div>
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_7.5rem_7.5rem_2rem] gap-2 text-xs font-medium text-gray-500"><span>Account</span><span className="text-right">Debit</span><span className="text-right">Credit</span><span /></div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_7.5rem_7.5rem_2rem] items-center gap-2">
              <select className="select" value={l.accountId} onChange={(e) => set(i, { accountId: e.target.value })} aria-label={`Account ${i + 1}`}>
                <option value="">Choose…</option>
                {groups.map(([type, label]) => <optgroup key={type} label={label}>{usable.filter((a) => a.type === type).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</optgroup>)}
              </select>
              <input type="number" min={0} step="0.01" className="input text-right" aria-label={`Debit ${i + 1}`} value={l.debit} onChange={(e) => set(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} />
              <input type="number" min={0} step="0.01" className="input text-right" aria-label={`Credit ${i + 1}`} value={l.credit} onChange={(e) => set(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} />
              {lines.length > 2 ? <button type="button" className="btn-icon btn-ghost" aria-label="Remove line" onClick={() => setLines(lines.filter((_, j) => j !== i))}><X className="h-4 w-4" /></button> : <span />}
            </div>
          ))}
          <div className="grid grid-cols-[1fr_7.5rem_7.5rem_2rem] items-center gap-2 border-t border-slate-200 pt-2 text-sm font-semibold">
            <button type="button" className="justify-self-start text-sm font-medium text-primary-700 hover:underline" onClick={() => setLines([...lines, blank()])}>+ Add line</button>
            <span className="text-right tabular-nums">{money(debit)}</span><span className="text-right tabular-nums">{money(credit)}</span><span />
          </div>
        </div>
        <p className={`rounded-lg px-3 py-2 text-sm ${ok ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
          {ok ? 'Debits and credits are equal.' : debit === credit ? 'Enter at least one debit and one credit.' : `Debits and credits must be equal. Difference: ${money(Math.abs(debit - credit))}.`}
          <span className="block text-xs opacity-80">Debit the account that receives value (what you bought, or the bank that got the money); credit the account that gives it.</span>
        </p>
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!ok || save.isPending}>Post entry</button></div>
      </form>
    </Modal>
  );
}
