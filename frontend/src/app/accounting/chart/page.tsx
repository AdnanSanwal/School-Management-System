'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Field, Modal, Spinner } from '@/components/ui/kit';
import { ledgerAPI, apiError, LedgerAccountRow } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { financeError, useFinance, useFinanceRefresh } from '@/components/finance/shared';

const GROUPS: [string, string, string][] = [
  ['ASSET', 'Assets', 'What the school has: cash, bank balances, money owed to it, equipment'],
  ['LIABILITY', 'Liabilities', 'What the school owes: loans, unpaid bills'],
  ['EQUITY', 'Owner’s funds', 'What the owner has put in or taken out'],
  ['INCOME', 'Income', 'Fees and other money earned'],
  ['EXPENSE', 'Expenses', 'What running the school costs'],
];
const SOURCE: Record<string, string> = { MONEY: 'Cash / bank account', CATEGORY: 'Category', SYSTEM: 'Built in' };

export default function ChartOfAccountsPage() {
  const { money, canManage } = useFinance();
  const refresh = useFinanceRefresh();
  const { data, isLoading, error } = useQuery({ queryKey: ['finance', 'ledger', 'accounts'], queryFn: ledgerAPI.accounts });
  const [edit, setEdit] = useState<LedgerAccountRow | 'new' | null>(null);
  const remove = useMutation({ mutationFn: (id: string) => ledgerAPI.deleteAccount(id), onSuccess: (r) => { toast.success(r.data.message); refresh(); }, onError: financeError });

  return (
    <DashboardLayout title="Chart of accounts" allowedRoles={CAN.viewFinance} subtitle="Every account in the books and its balance today"
      actions={canManage ? <button className="btn-primary" onClick={() => setEdit('new')}><Plus className="h-4 w-4" /> Add account</button> : undefined}>
      {isLoading ? <Spinner /> : error ? <div className="card text-sm text-red-600">{apiError(error)}</div> : (
        <div className="space-y-4">
          {GROUPS.map(([type, label, hint]) => {
            const rows = (data ?? []).filter((a) => a.type === type);
            return (
              <div key={type} className="card space-y-2">
                <div><h3 className="section-title">{label}</h3><p className="text-xs text-gray-500">{hint}</p></div>
                {rows.length === 0 ? <p className="text-sm text-gray-400">No accounts yet.</p> : (
                  <div className="table-container">
                    <table className="table">
                      <thead><tr><th className="w-24">Code</th><th>Account</th><th>Comes from</th><th className="text-right">Balance</th><th className="w-24" /></tr></thead>
                      <tbody>
                        {rows.map((a) => (
                          <tr key={a.id} className={a.isActive ? '' : 'opacity-50'}>
                            <td className="font-mono text-sm">{a.code}</td>
                            <td><Link href={`/accounting/ledger/${a.id}`} className="font-medium text-primary-700 hover:underline">{a.name}</Link>{!a.isActive && <span className="ml-2 text-xs text-gray-500">not in use</span>}</td>
                            <td className="text-sm text-gray-500">{a.link ? SOURCE[a.link] : 'Added by hand'}</td>
                            <td className={`text-right tabular-nums ${Number(a.balance) < 0 ? 'text-red-600' : ''}`}>{money(a.balance)}</td>
                            <td><div className="flex justify-end gap-1">{canManage && !a.link && <>
                              <button className="btn-icon btn-ghost" aria-label={`Edit ${a.name}`} onClick={() => setEdit(a)}><Pencil className="h-4 w-4" /></button>
                              {a.journalLines === 0 && <button className="btn-icon btn-ghost text-red-600" aria-label={`Delete ${a.name}`} disabled={remove.isPending} onClick={() => window.confirm(`Delete ${a.name}?`) && remove.mutate(a.id)}><Trash2 className="h-4 w-4" /></button>}
                            </>}</div></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
          <p className="text-xs text-gray-500">Accounts for cash and bank accounts and for expense and income categories are kept in step automatically; rename those where they are managed. Add your own accounts for things like equipment, deposits paid or loans taken, and use them in journal entries.</p>
        </div>
      )}
      {edit && <AccountModal account={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </DashboardLayout>
  );
}

function AccountModal({ account, onClose }: { account: LedgerAccountRow | null; onClose: () => void }) {
  const refresh = useFinanceRefresh();
  const [f, setF] = useState({ name: account?.name ?? '', type: account?.type ?? 'ASSET', code: account?.code ?? '', isActive: account?.isActive ?? true });
  const save = useMutation({
    mutationFn: () => (account
      ? ledgerAPI.updateAccount(account.id, { name: f.name.trim(), code: f.code.trim() || undefined, isActive: f.isActive })
      : ledgerAPI.addAccount({ name: f.name.trim(), type: f.type, code: f.code.trim() || undefined })),
    onSuccess: (r) => { toast.success(r.data.message); refresh(); onClose(); }, onError: financeError,
  });
  return (
    <Modal open onClose={onClose} title={account ? `Edit ${account.name}` : 'Add account'}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label="Name"><input required minLength={2} maxLength={100} className="input" placeholder="e.g. Furniture & equipment" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Kind" hint={account ? 'Can’t be changed' : GROUPS.find((g) => g[0] === f.type)?.[2]}>
            <select className="select" disabled={!!account} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as LedgerAccountRow['type'] })}>{GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Code" hint={account ? undefined : 'Leave empty to get the next free number'}><input className="input" pattern="\d{3,6}" title="3 to 6 digits" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
        </div>
        {account && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> In use (can be picked in journal entries)</label>}
        <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={save.isPending}>Save</button></div>
      </form>
    </Modal>
  );
}
