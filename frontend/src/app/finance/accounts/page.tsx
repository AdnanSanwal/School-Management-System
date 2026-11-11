'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowLeftRight, Pencil, Plus, PlusCircle, Printer, Trash2 } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Empty, Field, Modal, Spinner } from '@/components/ui/kit';
import { financeAPI, apiError, MoneyAccount } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { formatDate, todayIso } from '@/lib/utils';
import { ACCOUNT_TYPE_LABEL, METHOD_LABEL, financeError, useAccounts, useFinance, useFinanceRefresh } from '@/components/finance/shared';

export default function AccountsPage() {
  return <Suspense fallback={null}><Accounts /></Suspense>;
}

function Accounts() {
  const { money, canManage } = useFinance();
  const params = useSearchParams();
  const accounts = useAccounts();
  const [selected, setSelected] = useState(params.get('account') ?? '');
  const [edit, setEdit] = useState<MoneyAccount | 'new' | null>(null);
  const [entry, setEntry] = useState<MoneyAccount | null>(null);
  const [transfer, setTransfer] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const list = (accounts.data ?? []).filter((a) => showClosed || a.isActive);
  const closed = (accounts.data ?? []).filter((a) => !a.isActive).length;

  return (
    <DashboardLayout title="Accounts" allowedRoles={CAN.viewFinance} subtitle="Cash, bank and wallet accounts, and everything that moved through them"
      actions={canManage ? <>
        <button className="btn-secondary" onClick={() => setTransfer(true)}><ArrowLeftRight className="h-4 w-4" /> Transfer</button>
        <button className="btn-primary" onClick={() => setEdit('new')}><Plus className="h-4 w-4" /> Add account</button>
      </> : undefined}>
      {accounts.isLoading ? <Spinner /> : accounts.error ? <div className="card text-sm text-red-600">{apiError(accounts.error)}</div> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 print:hidden">
            {list.map((a) => (
              <div key={a.id} className={`card space-y-2 ${selected === a.id ? 'ring-2 ring-primary-400' : ''} ${a.isActive ? '' : 'opacity-60'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{a.name}</p>
                    <p className="text-xs text-gray-500">{ACCOUNT_TYPE_LABEL[a.type]}{a.accountNo ? ` · ${a.accountNo}` : ''}{a.isActive ? '' : ' · closed'}</p>
                  </div>
                  {canManage && <button className="btn-icon btn-ghost" aria-label={`Edit ${a.name}`} onClick={() => setEdit(a)}><Pencil className="h-4 w-4" /></button>}
                </div>
                <p className={`text-2xl font-bold tabular-nums ${Number(a.balance) < 0 ? 'text-red-600' : ''}`}>{money(a.balance)}</p>
                <p className="min-h-[1rem] text-xs text-gray-500">{a.methods.length ? `Receives: ${a.methods.map((m) => METHOD_LABEL[m] ?? m).join(', ')}` : 'No fee payments land here'}</p>
                <div className="flex gap-2 pt-1">
                  <button className="btn-secondary flex-1" onClick={() => setSelected(a.id)}>Statement</button>
                  {canManage && a.isActive && <button className="btn-secondary flex-1" onClick={() => setEntry(a)}><PlusCircle className="h-4 w-4" /> Money in / out</button>}
                </div>
              </div>
            ))}
          </div>
          {closed > 0 && <button className="text-sm text-primary-700 hover:underline print:hidden" onClick={() => setShowClosed(!showClosed)}>{showClosed ? 'Hide' : 'Show'} {closed} closed account{closed > 1 ? 's' : ''}</button>}
          <Statement accounts={accounts.data ?? []} accountId={selected} onAccount={setSelected} />
        </>
      )}
      {edit && <AccountModal account={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {entry && <EntryModal account={entry} onClose={() => setEntry(null)} />}
      {transfer && <TransferModal accounts={(accounts.data ?? []).filter((a) => a.isActive)} onClose={() => setTransfer(false)} />}
    </DashboardLayout>
  );
}

/** One account's statement, or the day book across all accounts. */
function Statement({ accounts, accountId, onAccount }: { accounts: MoneyAccount[]; accountId: string; onAccount: (id: string) => void }) {
  const { money, canManage } = useFinance();
  const refresh = useFinanceRefresh();
  const today = todayIso();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const { data, isLoading, error } = useQuery({
    queryKey: ['finance', 'statement', accountId, from, to],
    queryFn: () => financeAPI.statement({ accountId: accountId || undefined, from, to }),
    enabled: !!from && !!to && from <= to,
  });
  const remove = useMutation({ mutationFn: (id: string) => financeAPI.deleteTransaction(id), onSuccess: (r) => { toast.success(r.data.message); refresh(); }, onError: financeError });
  const name = accounts.find((a) => a.id === accountId)?.name;

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="section-title">{name ? `${name} — statement` : 'Day book — all accounts'}</h3>
          {data && <p className="text-xs text-gray-500">{formatDate(data.from)} to {formatDate(data.to)}</p>}
        </div>
        <div className="flex flex-wrap items-end gap-2 print:hidden">
          <label><span className="label">Account</span>
            <select className="select w-48" value={accountId} onChange={(e) => onAccount(e.target.value)}>
              <option value="">All accounts</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.isActive ? '' : ' (closed)'}</option>)}
            </select></label>
          <label><span className="label">From</span><input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
          <label><span className="label">To</span><input type="date" className="input" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} /></label>
          <button className="btn-secondary" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</button>
        </div>
      </div>
      {isLoading ? <Spinner /> : error ? <p className="text-sm text-red-600">{apiError(error)}</p> : data && (
        <div className="table-container">
          <table className="table">
            <thead><tr><th>Date</th>{!accountId && <th>Account</th>}<th>Details</th><th>Reference</th><th className="text-right">In</th><th className="text-right">Out</th><th className="text-right">Balance</th><th className="print:hidden" /></tr></thead>
            <tbody>
              <tr className="bg-slate-50 text-sm font-medium"><td colSpan={accountId ? 5 : 6}>Opening balance</td><td className="text-right tabular-nums">{money(data.opening)}</td><td className="print:hidden" /></tr>
              {data.rows.map((r) => (
                <tr key={`${r.kind}-${r.id}`}>
                  <td className="whitespace-nowrap text-sm">{formatDate(r.date)}</td>
                  {!accountId && <td className="text-sm">{r.account}</td>}
                  <td className="text-sm">{r.link ? <Link href={r.link} className="text-primary-700 hover:underline">{r.description}</Link> : r.description}</td>
                  <td className="font-mono text-xs text-gray-500">{r.reference ?? ''}</td>
                  <td className="text-right tabular-nums text-emerald-700">{Number(r.in) ? money(r.in) : ''}</td>
                  <td className="text-right tabular-nums text-red-600">{Number(r.out) ? money(r.out) : ''}</td>
                  <td className="text-right tabular-nums">{money(r.balance)}</td>
                  <td className="print:hidden">{canManage && r.removable && (
                    <button className="btn-icon btn-ghost text-red-600" aria-label="Remove entry" disabled={remove.isPending}
                      onClick={() => window.confirm(r.kind.startsWith('TRANSFER') ? 'Remove this transfer from both accounts?' : 'Remove this entry?') && remove.mutate(r.id)}><Trash2 className="h-4 w-4" /></button>
                  )}</td>
                </tr>
              ))}
              {data.rows.length === 0 && <tr><td colSpan={8}><Empty title="Nothing moved in these dates" /></td></tr>}
            </tbody>
            <tfoot><tr className="bg-slate-50 font-semibold">
              <td className="px-4 py-3 text-sm" colSpan={accountId ? 3 : 4}>Closing balance</td>
              <td className="px-4 py-3 text-right text-sm tabular-nums">{money(data.totalIn)}</td>
              <td className="px-4 py-3 text-right text-sm tabular-nums">{money(data.totalOut)}</td>
              <td className="px-4 py-3 text-right text-sm tabular-nums">{money(data.closing)}</td><td className="print:hidden" />
            </tr></tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function AccountModal({ account, onClose }: { account: MoneyAccount | null; onClose: () => void }) {
  const refresh = useFinanceRefresh();
  const [f, setF] = useState({
    name: account?.name ?? '', type: account?.type ?? 'BANK', accountNo: account?.accountNo ?? '', methods: account?.methods ?? [] as string[],
    openingBalance: account ? String(Number(account.openingBalance)) : '0', openingDate: account?.openingDate ?? todayIso(), notes: account?.notes ?? '',
  });
  const body = () => ({ ...f, openingBalance: Number(f.openingBalance || 0), accountNo: f.accountNo || null, notes: f.notes || null });
  const save = useMutation({
    mutationFn: () => (account ? financeAPI.updateAccount(account.id, body()) : financeAPI.addAccount(body())),
    onSuccess: () => { toast.success('Account saved'); refresh(); onClose(); }, onError: financeError,
  });
  const toggle = useMutation({
    mutationFn: () => financeAPI.updateAccount(account!.id, { isActive: !account!.isActive }),
    onSuccess: () => { toast.success(account!.isActive ? 'Account closed' : 'Account reopened'); refresh(); onClose(); }, onError: financeError,
  });
  const flip = (m: string) => setF({ ...f, methods: f.methods.includes(m) ? f.methods.filter((x) => x !== m) : [...f.methods, m] });
  return (
    <Modal open onClose={onClose} title={account ? `Edit ${account.name}` : 'Add account'}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><input required minLength={2} maxLength={80} className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. HBL current account" /></Field>
          <Field label="Type"><select className="select" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as MoneyAccount['type'] })}>
            {Object.entries(ACCOUNT_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Account number" hint="Optional"><input className="input" maxLength={40} value={f.accountNo} onChange={(e) => setF({ ...f, accountNo: e.target.value })} /></Field>
          <Field label="Opening balance" hint="What it held on the opening date"><input type="number" min={0} step="0.01" className="input" value={f.openingBalance} onChange={(e) => setF({ ...f, openingBalance: e.target.value })} /></Field>
          <Field label="Opening date"><input type="date" required className="input" max={todayIso()} value={f.openingDate} onChange={(e) => setF({ ...f, openingDate: e.target.value })} /></Field>
        </div>
        <div>
          <span className="label">Fee payments that land in this account</span>
          <div className="flex flex-wrap gap-2">
            {Object.entries(METHOD_LABEL).map(([m, l]) => (
              <label key={m} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${f.methods.includes(m) ? 'border-primary-400 bg-primary-50 text-primary-700' : 'border-slate-200 text-gray-600'}`}>
                <input type="checkbox" className="sr-only" checked={f.methods.includes(m)} onChange={() => flip(m)} />{l}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-gray-400">Each payment method goes to one account; choosing it here takes it from the other account.</p>
        </div>
        <Field label="Notes"><input className="input" maxLength={300} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <div className="flex items-center justify-between gap-2 pt-2">
          {account ? <button type="button" className="text-sm text-gray-600 hover:underline" disabled={toggle.isPending} onClick={() => toggle.mutate()}>{account.isActive ? 'Close this account' : 'Reopen this account'}</button> : <span />}
          <div className="flex gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={save.isPending}>Save</button></div>
        </div>
      </form>
    </Modal>
  );
}

const ENTRY_TYPES = [
  ['DEPOSIT', 'Money put in', 'e.g. the owner added cash'],
  ['WITHDRAWAL', 'Money taken out', 'e.g. the owner withdrew cash'],
  ['ADJUSTMENT_IN', 'Correction (add)', 'The count was more than the books'],
  ['ADJUSTMENT_OUT', 'Correction (subtract)', 'The count was less than the books'],
] as const;

function EntryModal({ account, onClose }: { account: MoneyAccount; onClose: () => void }) {
  const { money } = useFinance();
  const refresh = useFinanceRefresh();
  const [f, setF] = useState({ type: 'DEPOSIT', amount: '', txDate: todayIso(), description: '', reference: '' });
  const save = useMutation({
    mutationFn: () => financeAPI.addTransaction(account.id, { ...f, amount: Number(f.amount), reference: f.reference || undefined }),
    onSuccess: () => { toast.success('Recorded'); refresh(); onClose(); }, onError: financeError,
  });
  return (
    <Modal open onClose={onClose} title={`${account.name} — money in / out`}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <p className="text-sm text-gray-500">Balance now: <b className="text-gray-900">{money(account.balance)}</b>. Expenses and other income have their own screens; use this for money the owner puts in or takes out, and for corrections.</p>
        <Field label="What happened" hint={ENTRY_TYPES.find((t) => t[0] === f.type)?.[2]}>
          <select className="select" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{ENTRY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount"><input type="number" required min={0.01} step="0.01" className="input" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Date"><input type="date" required className="input" max={todayIso()} value={f.txDate} onChange={(e) => setF({ ...f, txDate: e.target.value })} /></Field>
        </div>
        <Field label="Details"><input required minLength={2} maxLength={300} className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Reference" hint="Optional: slip or cheque number"><input className="input" maxLength={100} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={save.isPending}>Save</button></div>
      </form>
    </Modal>
  );
}

function TransferModal({ accounts, onClose }: { accounts: MoneyAccount[]; onClose: () => void }) {
  const { money } = useFinance();
  const refresh = useFinanceRefresh();
  const [f, setF] = useState({ fromAccountId: accounts[0]?.id ?? '', toAccountId: accounts[1]?.id ?? '', amount: '', txDate: todayIso(), description: '', reference: '' });
  useEffect(() => { if (f.fromAccountId === f.toAccountId) setF((p) => ({ ...p, toAccountId: accounts.find((a) => a.id !== p.fromAccountId)?.id ?? '' })); }, [f.fromAccountId, f.toAccountId, accounts]);
  const from = accounts.find((a) => a.id === f.fromAccountId);
  const save = useMutation({
    mutationFn: () => financeAPI.transfer({ ...f, amount: Number(f.amount), description: f.description || undefined, reference: f.reference || undefined }),
    onSuccess: () => { toast.success('Transfer recorded'); refresh(); onClose(); }, onError: financeError,
  });
  return (
    <Modal open onClose={onClose} title="Transfer between accounts">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From" hint={from ? `Holds ${money(from.balance)}` : undefined}><select className="select" required value={f.fromAccountId} onChange={(e) => setF({ ...f, fromAccountId: e.target.value })}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
          <Field label="To"><select className="select" required value={f.toAccountId} onChange={(e) => setF({ ...f, toAccountId: e.target.value })}>
            {accounts.filter((a) => a.id !== f.fromAccountId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
          <Field label="Amount"><input type="number" required min={0.01} step="0.01" className="input" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Date"><input type="date" required className="input" max={todayIso()} value={f.txDate} onChange={(e) => setF({ ...f, txDate: e.target.value })} /></Field>
        </div>
        <Field label="Details" hint="Optional, e.g. cash deposited at the branch"><input className="input" maxLength={300} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Reference" hint="Optional: deposit slip number"><input className="input" maxLength={100} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={save.isPending || !f.toAccountId}>Transfer</button></div>
      </form>
    </Modal>
  );
}
