'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus } from 'lucide-react';
import { Modal } from '@/components/ui/kit';
import { financeAPI, apiError, FinanceCategory } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { formatMoney } from '@/lib/utils';
import { can } from '@/lib/roles';

export const METHOD_LABEL: Record<string, string> = {
  CASH: 'Cash', BANK_TRANSFER: 'Bank transfer', CHEQUE: 'Cheque', CARD: 'Card', JAZZCASH: 'JazzCash', EASYPAISA: 'Easypaisa', ONLINE: 'Online',
};
export const ACCOUNT_TYPE_LABEL: Record<string, string> = { CASH: 'Cash', BANK: 'Bank', WALLET: 'Mobile wallet' };

/** Who is looking, and a money formatter in the school's currency. */
export function useFinance() {
  const user = useAuthStore((s) => s.user);
  const currency = user?.school?.currency ?? 'PKR';
  return {
    canManage: can(user?.role, 'manageFinance'),
    canApprove: can(user?.role, 'approveExpense'),
    money: (v: unknown) => formatMoney(v as string, currency),
  };
}

export const useAccounts = () => useQuery({ queryKey: ['finance', 'accounts'], queryFn: financeAPI.accounts });
export const useCategories = (kind: 'EXPENSE' | 'INCOME') => useQuery({ queryKey: ['finance', 'categories', kind], queryFn: () => financeAPI.categories(kind) });

/** Everything finance shows depends on everything else (balances, totals), so refresh it all. */
export function useFinanceRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['finance'] });
}

export const financeError = (e: unknown) => toast.error(apiError(e), { duration: 7000 });

/** Add, rename or retire the headings used on expenses or other income. */
export function CategoryModal({ kind, open, onClose }: { kind: 'EXPENSE' | 'INCOME'; open: boolean; onClose: () => void }) {
  const { data } = useCategories(kind);
  const refresh = useFinanceRefresh();
  const [name, setName] = useState('');
  const add = useMutation({ mutationFn: () => financeAPI.addCategory(kind, name.trim()), onSuccess: () => { setName(''); refresh(); }, onError: financeError });
  const update = useMutation({ mutationFn: (v: { id: string; body: { name?: string; isActive?: boolean } }) => financeAPI.updateCategory(v.id, v.body), onSuccess: refresh, onError: financeError });
  const rename = (c: FinanceCategory) => {
    const next = window.prompt('New name', c.name)?.trim();
    if (next && next !== c.name) update.mutate({ id: c.id, body: { name: next } });
  };
  return (
    <Modal open={open} onClose={onClose} title={kind === 'EXPENSE' ? 'Expense categories' : 'Income categories'}>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim().length >= 2) add.mutate(); }}>
        <input className="input" placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="New category" />
        <button className="btn-primary" disabled={add.isPending || name.trim().length < 2}><Plus className="h-4 w-4" /> Add</button>
      </form>
      <ul className="mt-3 divide-y divide-slate-100">
        {(data ?? []).map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span className={c.isActive ? '' : 'text-gray-400 line-through'}>{c.name}</span>
            <span className="flex gap-2">
              <button type="button" className="text-primary-700 hover:underline" onClick={() => rename(c)}>Rename</button>
              <button type="button" className="text-gray-600 hover:underline" onClick={() => update.mutate({ id: c.id, body: { isActive: !c.isActive } })}>{c.isActive ? 'Retire' : 'Bring back'}</button>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-gray-500">A retired category stays on old entries but can’t be picked for new ones.</p>
    </Modal>
  );
}
