'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, keepPreviousData } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Check, Paperclip, Plus, Tags, Trash2, X } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Empty, Field, Modal, Spinner, Stat, StatusBadge } from '@/components/ui/kit';
import { financeAPI, apiError } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { formatDate, todayIso } from '@/lib/utils';
import { SearchInput, NoMatches, cleanTerm, useDebounced } from '@/components/ui/SearchInput';
import { CategoryModal, financeError, useAccounts, useCategories, useFinance, useFinanceRefresh } from '@/components/finance/shared';

export default function ExpensesPage() {
  return <Suspense fallback={null}><Expenses /></Suspense>;
}

function Expenses() {
  const { money, canManage, canApprove } = useFinance();
  const refresh = useFinanceRefresh();
  const params = useSearchParams();
  const today = todayIso();
  const pendingOnly = params.get('status') === 'PENDING';
  const [f, setF] = useState({ from: pendingOnly ? '' : `${today.slice(0, 7)}-01`, to: pendingOnly ? '' : today, categoryId: '', status: pendingOnly ? 'PENDING' : '' });
  const [search, setSearch] = useState('');
  const term = useDebounced(cleanTerm(search), 250);
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [cats, setCats] = useState(false);
  const categories = useCategories('EXPENSE');
  const set = (patch: Partial<typeof f>) => { setF({ ...f, ...patch }); setPage(1); };
  const query = Object.fromEntries(Object.entries({ ...f, search: term, page, limit: 25 }).filter(([, v]) => v !== ''));
  const { data, isLoading, error } = useQuery({ queryKey: ['finance', 'expenses', query], queryFn: () => financeAPI.expenses(query), placeholderData: keepPreviousData, meta: { quiet: true } });
  const decide = useMutation({
    mutationFn: (v: { id: string; approve: boolean; note?: string }) => financeAPI.decideExpense(v.id, v.approve, v.note),
    onSuccess: (r) => { toast.success(r.data.message); refresh(); }, onError: financeError,
  });
  const remove = useMutation({ mutationFn: (id: string) => financeAPI.deleteExpense(id), onSuccess: (r) => { toast.success(r.data.message); refresh(); }, onError: financeError });
  const reject = (id: string) => {
    const note = window.prompt('Why is it rejected? (shown to the accountant)');
    if (note !== null) decide.mutate({ id, approve: false, note: note.trim() || undefined });
  };
  const rows: any[] = data?.data ?? [];

  return (
    <DashboardLayout title="Expenses" allowedRoles={CAN.viewFinance} subtitle="Everything the school spent, by category and account"
      actions={canManage ? <>
        <button className="btn-secondary" onClick={() => setCats(true)}><Tags className="h-4 w-4" /> Categories</button>
        <button className="btn-primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add expense</button>
      </> : undefined}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat tone="bad" label={f.status === 'PENDING' ? 'Waiting for approval' : f.status === 'REJECTED' ? 'Rejected' : 'Spent in these dates'} value={money(data?.totals?.amount ?? 0)} sub={`${data?.pagination?.total ?? 0} entries listed`} />
      </div>
      <div className="card space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <label><span className="label">From</span><input type="date" className="input" value={f.from} max={f.to || today} onChange={(e) => set({ from: e.target.value })} /></label>
          <label><span className="label">To</span><input type="date" className="input" value={f.to} min={f.from} max={today} onChange={(e) => set({ to: e.target.value })} /></label>
          <label><span className="label">Category</span><select className="select w-48" value={f.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
            <option value="">All categories</option>{(categories.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label><span className="label">Status</span><select className="select w-44" value={f.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">All</option><option value="APPROVED">Approved</option><option value="PENDING">Waiting for approval</option><option value="REJECTED">Rejected</option></select></label>
          <label className="min-w-[12rem] flex-1"><span className="label">Search</span><SearchInput placeholder="Details, paid to, number, category" value={search} onChange={(v) => { setSearch(v); setPage(1); }} aria-label="Search expenses" /></label>
        </div>
        {isLoading ? <Spinner /> : error ? <p className="text-sm text-red-600">{apiError(error)}</p> : rows.length === 0 && term ? <NoMatches term={term} what="expenses" onClear={() => setSearch('')}>{f.from || f.to ? 'Only entries between the dates above are searched.' : undefined}</NoMatches>
          : rows.length === 0 ? <Empty title="No expenses in these dates" /> : (
          <div className="table-container">
            <table className="table">
              <thead><tr><th>Date</th><th>No.</th><th>Category</th><th>Details</th><th>Paid from</th><th className="text-right">Amount</th><th>Status</th><th /></tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap text-sm">{formatDate(e.expenseDate)}</td>
                    <td className="font-mono text-xs">{e.expenseNo}</td>
                    <td className="text-sm">{e.category.name}</td>
                    <td className="text-sm">{e.description}
                      <span className="block text-xs text-gray-500">{[e.paidTo && `Paid to ${e.paidTo}`, e.reference && `Ref ${e.reference}`, e.decisionNote && `Note: ${e.decisionNote}`].filter(Boolean).join(' · ')}</span></td>
                    <td className="text-sm">{e.account.name}</td>
                    <td className="text-right font-medium tabular-nums">{money(e.amount)}</td>
                    <td><StatusBadge status={e.status} /></td>
                    <td><div className="flex items-center justify-end gap-1">
                      {e.receipt && <a href={e.receipt} target="_blank" rel="noreferrer" className="btn-icon btn-ghost" aria-label="Open the bill"><Paperclip className="h-4 w-4" /></a>}
                      {canApprove && e.status === 'PENDING' && <>
                        <button className="btn-icon btn-ghost text-emerald-700" aria-label="Approve" disabled={decide.isPending} onClick={() => decide.mutate({ id: e.id, approve: true })}><Check className="h-4 w-4" /></button>
                        <button className="btn-icon btn-ghost text-red-600" aria-label="Reject" disabled={decide.isPending} onClick={() => reject(e.id)}><X className="h-4 w-4" /></button>
                      </>}
                      {canManage && <button className="btn-icon btn-ghost text-red-600" aria-label="Delete expense" disabled={remove.isPending}
                        onClick={() => window.confirm(`Delete ${e.expenseNo}? ${e.status === 'APPROVED' ? 'The amount goes back into the account.' : ''}`) && remove.mutate(e.id)}><Trash2 className="h-4 w-4" /></button>}
                    </div></td>
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
      {adding && <ExpenseModal onClose={() => setAdding(false)} />}
      <CategoryModal kind="EXPENSE" open={cats} onClose={() => setCats(false)} />
    </DashboardLayout>
  );
}

function ExpenseModal({ onClose }: { onClose: () => void }) {
  const { money } = useFinance();
  const refresh = useFinanceRefresh();
  const accounts = useAccounts();
  const categories = useCategories('EXPENSE');
  const settings = useQuery({ queryKey: ['finance', 'settings'], queryFn: financeAPI.settings });
  const [f, setF] = useState({ categoryId: '', accountId: '', amount: '', expenseDate: todayIso(), description: '', paidTo: '', reference: '' });
  const [file, setFile] = useState<File | null>(null);
  const active = (accounts.data ?? []).filter((a) => a.isActive);
  const account = active.find((a) => a.id === f.accountId);
  const limit = settings.data?.expenseApprovalLimit;
  const waits = !!limit && !settings.data?.canApprove && Number(f.amount) > Number(limit);
  const short = !waits && account && Number(f.amount) > Number(account.balance);
  const save = useMutation({
    mutationFn: () => financeAPI.addExpense({ ...f, amount: Number(f.amount) }, file),
    onSuccess: (r) => { toast.success(r.data.message, { duration: 5000 }); refresh(); onClose(); }, onError: financeError,
  });
  return (
    <Modal open onClose={onClose} title="Add expense">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Category"><select required className="select" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
            <option value="">Choose…</option>{(categories.data ?? []).filter((c) => c.isActive).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Paid from" hint={account ? `Holds ${money(account.balance)}` : undefined}><select required className="select" value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>
            <option value="">Choose…</option>{active.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
          <Field label="Amount"><input type="number" required min={0.01} step="0.01" className="input" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Date"><input type="date" required className="input" max={todayIso()} value={f.expenseDate} onChange={(e) => setF({ ...f, expenseDate: e.target.value })} /></Field>
        </div>
        {waits && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">This is above {money(limit)}, so it will wait for the owner’s approval. The money leaves the account once approved.</p>}
        {short && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{account.name} holds only {money(account.balance)}. Choose another account or record the money coming in first.</p>}
        <Field label="Details"><input required minLength={2} maxLength={500} className="input" placeholder="What was it for?" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Paid to" hint="Optional"><input className="input" maxLength={120} value={f.paidTo} onChange={(e) => setF({ ...f, paidTo: e.target.value })} /></Field>
          <Field label="Reference" hint="Optional: bill or cheque number"><input className="input" maxLength={100} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        </div>
        <Field label="Bill or receipt" hint="Optional: photo or PDF"><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="input" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
        <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={save.isPending || !!short}>Save expense</button></div>
      </form>
    </Modal>
  );
}
