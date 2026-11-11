'use client';

import { useState } from 'react';
import { useQuery, useMutation, keepPreviousData } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Tags, Trash2 } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Empty, Field, Modal, Spinner, Stat } from '@/components/ui/kit';
import { financeAPI, apiError } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { formatDate, todayIso } from '@/lib/utils';
import { CategoryModal, financeError, useAccounts, useCategories, useFinance, useFinanceRefresh } from '@/components/finance/shared';

/** Money received that is not a student fee: canteen rent, uniform sales, donations. */
export default function OtherIncomePage() {
  const { money, canManage } = useFinance();
  const refresh = useFinanceRefresh();
  const today = todayIso();
  const [f, setF] = useState({ from: `${today.slice(0, 7)}-01`, to: today, categoryId: '', search: '' });
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [cats, setCats] = useState(false);
  const categories = useCategories('INCOME');
  const set = (patch: Partial<typeof f>) => { setF({ ...f, ...patch }); setPage(1); };
  const query = Object.fromEntries(Object.entries({ ...f, page, limit: 25 }).filter(([, v]) => v !== ''));
  const { data, isLoading, error } = useQuery({ queryKey: ['finance', 'income', query], queryFn: () => financeAPI.income(query), placeholderData: keepPreviousData, meta: { quiet: true } });
  const remove = useMutation({ mutationFn: (id: string) => financeAPI.deleteIncome(id), onSuccess: (r) => { toast.success(r.data.message); refresh(); }, onError: financeError });
  const rows: any[] = data?.data ?? [];

  return (
    <DashboardLayout title="Other income" allowedRoles={CAN.viewFinance} subtitle="Money received apart from student fees"
      actions={canManage ? <>
        <button className="btn-secondary" onClick={() => setCats(true)}><Tags className="h-4 w-4" /> Categories</button>
        <button className="btn-primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add income</button>
      </> : undefined}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat tone="good" label="Received in these dates" value={money(data?.totals?.amount ?? 0)} sub={`${data?.pagination?.total ?? 0} entries`} />
      </div>
      <div className="card space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <label><span className="label">From</span><input type="date" className="input" value={f.from} max={f.to || today} onChange={(e) => set({ from: e.target.value })} /></label>
          <label><span className="label">To</span><input type="date" className="input" value={f.to} min={f.from} max={today} onChange={(e) => set({ to: e.target.value })} /></label>
          <label><span className="label">Category</span><select className="select w-48" value={f.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
            <option value="">All categories</option>{(categories.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="min-w-[12rem] flex-1"><span className="label">Search</span><input className="input" placeholder="Details, received from, number" value={f.search} onChange={(e) => set({ search: e.target.value })} /></label>
        </div>
        {isLoading ? <Spinner /> : error ? <p className="text-sm text-red-600">{apiError(error)}</p> : rows.length === 0 ? <Empty title="No income recorded in these dates">Student fees are not listed here; see Fees → Payments.</Empty> : (
          <div className="table-container">
            <table className="table">
              <thead><tr><th>Date</th><th>No.</th><th>Category</th><th>Details</th><th>Received in</th><th className="text-right">Amount</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap text-sm">{formatDate(r.incomeDate)}</td>
                    <td className="font-mono text-xs">{r.incomeNo}</td>
                    <td className="text-sm">{r.category.name}</td>
                    <td className="text-sm">{r.description}<span className="block text-xs text-gray-500">{[r.receivedFrom && `From ${r.receivedFrom}`, r.reference && `Ref ${r.reference}`].filter(Boolean).join(' · ')}</span></td>
                    <td className="text-sm">{r.account.name}</td>
                    <td className="text-right font-medium tabular-nums">{money(r.amount)}</td>
                    <td className="text-right">{canManage && <button className="btn-icon btn-ghost text-red-600" aria-label="Delete entry" disabled={remove.isPending}
                      onClick={() => window.confirm(`Delete ${r.incomeNo}? The amount comes out of ${r.account.name}.`) && remove.mutate(r.id)}><Trash2 className="h-4 w-4" /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(data?.pagination?.pages ?? 1) > 1 && (
          <div className="flex items-center justify-end gap-2 text-sm">
            <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <span>Page {page} of {data?.pagination.pages}</span>
            <button className="btn-secondary" disabled={page >= (data?.pagination.pages ?? 1)} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        )}
      </div>
      {adding && <IncomeModal onClose={() => setAdding(false)} />}
      <CategoryModal kind="INCOME" open={cats} onClose={() => setCats(false)} />
    </DashboardLayout>
  );
}

function IncomeModal({ onClose }: { onClose: () => void }) {
  const refresh = useFinanceRefresh();
  const accounts = useAccounts();
  const categories = useCategories('INCOME');
  const [f, setF] = useState({ categoryId: '', accountId: '', amount: '', incomeDate: todayIso(), description: '', receivedFrom: '', reference: '' });
  const save = useMutation({
    mutationFn: () => financeAPI.addIncome({ ...f, amount: Number(f.amount), receivedFrom: f.receivedFrom || undefined, reference: f.reference || undefined }),
    onSuccess: (r) => { toast.success(r.data.message); refresh(); onClose(); }, onError: financeError,
  });
  return (
    <Modal open onClose={onClose} title="Add income">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Category"><select required className="select" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
            <option value="">Choose…</option>{(categories.data ?? []).filter((c) => c.isActive).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Received in"><select required className="select" value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>
            <option value="">Choose…</option>{(accounts.data ?? []).filter((a) => a.isActive).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
          <Field label="Amount"><input type="number" required min={0.01} step="0.01" className="input" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Date"><input type="date" required className="input" max={todayIso()} value={f.incomeDate} onChange={(e) => setF({ ...f, incomeDate: e.target.value })} /></Field>
        </div>
        <Field label="Details"><input required minLength={2} maxLength={500} className="input" placeholder="What was it for?" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Received from" hint="Optional"><input className="input" maxLength={120} value={f.receivedFrom} onChange={(e) => setF({ ...f, receivedFrom: e.target.value })} /></Field>
          <Field label="Reference" hint="Optional"><input className="input" maxLength={100} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        </div>
        <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={save.isPending}>Save income</button></div>
      </form>
    </Modal>
  );
}
