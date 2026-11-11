'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { AlertTriangle, Landmark, Scale, TrendingDown, TrendingUp } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Spinner, Stat } from '@/components/ui/kit';
import { financeAPI, apiError } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { todayIso } from '@/lib/utils';
import { ACCOUNT_TYPE_LABEL, financeError, useFinance, useFinanceRefresh } from '@/components/finance/shared';

/** Where the money stands: balances now, and income against expenses for a month. */
export default function FinanceOverviewPage() {
  const router = useRouter();
  const { money, canApprove } = useFinance();
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const { data, isLoading, error } = useQuery({ queryKey: ['finance', 'summary', month], queryFn: () => financeAPI.summary(month) });

  return (
    <DashboardLayout title="Finance overview" allowedRoles={CAN.viewFinance} subtitle="Balances today, and what came in and went out in the month"
      actions={<label className="flex items-center gap-2 text-sm"><span className="text-gray-500">Month</span>
        <input type="month" className="input w-44" value={month} max={todayIso().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} /></label>}>
      {isLoading ? <Spinner /> : error ? <div className="card text-sm text-red-600">{apiError(error)}</div> : data && (
        <>
          {data.pendingExpenses.count > 0 && (
            <Link href="/finance/expenses?status=PENDING" className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100">
              <AlertTriangle className="h-5 w-5 flex-shrink-0" />
              <span><b>{data.pendingExpenses.count} expense{data.pendingExpenses.count > 1 ? 's' : ''}</b> worth {money(data.pendingExpenses.amount)} {canApprove ? 'need your approval' : 'are waiting for the owner’s approval'}.</span>
            </Link>
          )}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat icon={Landmark} label="Money in all accounts" value={money(data.totalBalance)} sub="Right now" onClick={() => router.push('/finance/accounts')} />
            <Stat icon={TrendingUp} tone="good" label="Income this month" value={money(data.income.total)} sub={`Fees ${money(data.income.fees)} · other ${money(data.income.other)}`} />
            <Stat icon={TrendingDown} tone="bad" label="Expenses this month" value={money(data.expenses.total)} onClick={() => router.push('/finance/expenses')} sub="Approved expenses" />
            <Stat icon={Scale} tone={Number(data.net) < 0 ? 'bad' : 'good'} label={Number(data.net) < 0 ? 'Shortfall this month' : 'Surplus this month'} value={money(Math.abs(Number(data.net)))} sub="Income minus expenses" />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="card space-y-3">
              <h3 className="section-title">Accounts</h3>
              <ul className="divide-y divide-slate-100">
                {data.accounts.map((a: any) => (
                  <li key={a.id}>
                    <Link href={`/finance/accounts?account=${a.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-primary-700">
                      <span><span className="font-medium">{a.name}</span><span className="block text-xs text-gray-500">{ACCOUNT_TYPE_LABEL[a.type]}</span></span>
                      <span className={`font-semibold tabular-nums ${Number(a.balance) < 0 ? 'text-red-600' : ''}`}>{money(a.balance)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <Breakdown title="Expenses by category" rows={data.expenses.byCategory} total={data.expenses.total} money={money} bar="bg-red-400" empty="No expenses recorded this month." />
            <Breakdown title="Income by source" rows={[{ category: 'Student fees', amount: data.income.fees }, ...data.income.otherByCategory].filter((r: any) => Number(r.amount) > 0)}
              total={data.income.total} money={money} bar="bg-emerald-400" empty="No income recorded this month." />
          </div>

          <ApprovalLimit />
        </>
      )}
    </DashboardLayout>
  );
}

function Breakdown({ title, rows, total, money, bar, empty }: { title: string; rows: { category: string; amount: string }[]; total: string; money: (v: unknown) => string; bar: string; empty: string }) {
  const t = Number(total) || 1;
  return (
    <div className="card space-y-3">
      <h3 className="section-title">{title}</h3>
      {rows.length === 0 ? <p className="text-sm text-gray-500">{empty}</p> : (
        <ul className="space-y-2.5">
          {rows.map((r) => {
            const pct = Math.round((Number(r.amount) / t) * 100);
            return (
              <li key={r.category} className="text-sm">
                <div className="flex justify-between gap-2"><span>{r.category}</span><span className="tabular-nums">{money(r.amount)} <span className="text-xs text-gray-400">{pct}%</span></span></div>
                <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className={`h-1.5 rounded-full ${bar}`} style={{ width: `${Math.max(pct, 2)}%` }} /></div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The owner chooses above which amount an expense must wait for them. */
function ApprovalLimit() {
  const { money } = useFinance();
  const refresh = useFinanceRefresh();
  const { data } = useQuery({ queryKey: ['finance', 'settings'], queryFn: financeAPI.settings });
  const [limit, setLimit] = useState('');
  useEffect(() => { if (data) setLimit(data.expenseApprovalLimit === null ? '' : String(Number(data.expenseApprovalLimit))); }, [data]);
  const save = useMutation({
    mutationFn: () => financeAPI.saveSettings(limit.trim() === '' ? null : Number(limit)),
    onSuccess: (r) => { toast.success(r.data.message); refresh(); }, onError: financeError,
  });
  if (!data) return null;
  if (!data.canApprove) {
    return <p className="text-xs text-gray-500">{data.expenseApprovalLimit === null ? 'Expenses are recorded without approval.' : `Expenses above ${money(data.expenseApprovalLimit)} wait for the owner’s approval.`}</p>;
  }
  return (
    <form className="card flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <div className="min-w-0 flex-1">
        <h3 className="section-title">Expense approval</h3>
        <p className="text-xs text-gray-500">Expenses above this amount wait for your approval before the money leaves the account. Leave it empty to let the accountant record any expense.</p>
      </div>
      <input type="number" min={0} step="1" className="input w-44" placeholder="No approval needed" value={limit} onChange={(e) => setLimit(e.target.value)} aria-label="Approval limit" />
      <button className="btn-primary" disabled={save.isPending}>Save</button>
    </form>
  );
}
