'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { CheckCircle2, Lock, LockOpen, Printer } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Spinner } from '@/components/ui/kit';
import { ledgerAPI, apiError, StatementRow } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { cn, formatDate, formatPeriod, todayIso } from '@/lib/utils';
import { financeError, useFinance } from '@/components/finance/shared';
import { useAuthStore } from '@/store/authStore';

type Tab = 'income' | 'balance' | 'trial';
const TABS: [Tab, string][] = [['income', 'Income & expenditure'], ['balance', 'Balance sheet'], ['trial', 'Trial balance']];

/** The three statements, straight from the ledger, and month closing. */
export default function StatementsPage() {
  const today = todayIso();
  const [tab, setTab] = useState<Tab>('income');
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const school = useAuthStore((s) => s.user?.school?.name);

  return (
    <DashboardLayout title="Statements" allowedRoles={CAN.viewFinance} subtitle="Worked out from fee receipts, expenses, income, payroll and journal entries"
      actions={<button className="btn-secondary print:hidden" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</button>}>
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
          {TABS.map(([k, l]) => <button key={k} className={cn('rounded-lg px-3 py-1.5 text-sm font-medium', tab === k ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600 hover:text-gray-900')} onClick={() => setTab(k)}>{l}</button>)}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {tab === 'income' && <label><span className="label">From</span><input type="date" className="input" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>}
          <label><span className="label">{tab === 'income' ? 'To' : 'As on'}</span><input type="date" className="input" value={to} min={tab === 'income' ? from : undefined} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
        </div>
      </div>
      <div className="card mx-auto w-full max-w-3xl">
        <header className="mb-4 border-b border-slate-200 pb-3 text-center">
          <p className="text-lg font-bold">{school}</p>
          <p className="text-sm font-semibold uppercase tracking-wider text-gray-600">{TABS.find((t) => t[0] === tab)![1]}</p>
          <p className="text-xs text-gray-500">{tab === 'income' ? `${formatDate(from)} to ${formatDate(to)}` : `As on ${formatDate(to)}`}</p>
        </header>
        {tab === 'income' ? <IncomeStatement from={from} to={to} /> : tab === 'balance' ? <BalanceSheet asOf={to} /> : <TrialBalance asOf={to} />}
      </div>
      <Closing />
    </DashboardLayout>
  );
}

function Rows({ rows, money, from, to }: { rows: StatementRow[]; money: (v: unknown) => string; from?: string; to?: string }) {
  if (!rows.length) return <tr><td colSpan={2} className="py-1.5 pl-4 text-sm text-gray-400">Nothing</td></tr>;
  const q = from && to ? `?from=${from}&to=${to}` : to ? `?to=${to}` : '';
  return <>{rows.map((r) => (
    <tr key={r.id}>
      <td className="py-1.5 pl-4 text-sm"><Link href={`/accounting/ledger/${r.id}${q}`} className="hover:text-primary-700 hover:underline"><span className="mr-2 font-mono text-xs text-gray-400">{r.code}</span>{r.name}</Link></td>
      <td className={`py-1.5 text-right text-sm tabular-nums ${Number(r.amount) < 0 ? 'text-red-600' : ''}`}>{money(r.amount)}</td>
    </tr>
  ))}</>;
}
const Head = ({ children }: { children: React.ReactNode }) => <tr><td colSpan={2} className="pt-4 text-xs font-semibold uppercase tracking-wider text-gray-500">{children}</td></tr>;
const Total = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
  <tr className={cn('border-t border-slate-200 font-semibold', strong && 'border-t-2 border-slate-400 text-base')}><td className="py-2 text-sm">{label}</td><td className="py-2 text-right tabular-nums">{value}</td></tr>
);
const Loading = ({ q }: { q: { isLoading: boolean; error: unknown } }) => (q.isLoading ? <Spinner /> : q.error ? <p className="text-sm text-red-600">{apiError(q.error)}</p> : null);

function IncomeStatement({ from, to }: { from: string; to: string }) {
  const { money } = useFinance();
  const q = useQuery({ queryKey: ['finance', 'ledger', 'income', from, to], queryFn: () => ledgerAPI.incomeStatement({ from, to }) });
  if (!q.data) return <Loading q={q} />;
  const d = q.data;
  const loss = Number(d.surplus) < 0;
  return (
    <table className="w-full"><tbody>
      <Head>Income</Head><Rows rows={d.income.rows} money={money} from={from} to={to} /><Total label="Total income" value={money(d.income.total)} />
      <Head>Expenditure</Head><Rows rows={d.expenses.rows} money={money} from={from} to={to} /><Total label="Total expenditure" value={money(d.expenses.total)} />
      <tr className={cn('border-t-2 border-slate-400 text-base font-bold', loss ? 'text-red-600' : 'text-emerald-700')}>
        <td className="py-3">{loss ? 'Deficit (spent more than earned)' : 'Surplus'}</td><td className="py-3 text-right tabular-nums">{money(Math.abs(Number(d.surplus)))}</td>
      </tr>
      <tr><td colSpan={2} className="pt-2 text-xs text-gray-500">Fees are counted when they are received. Unpaid fee invoices are not income yet; see Fees → Defaulters.</td></tr>
    </tbody></table>
  );
}

function BalanceSheet({ asOf }: { asOf: string }) {
  const { money } = useFinance();
  const q = useQuery({ queryKey: ['finance', 'ledger', 'balance', asOf], queryFn: () => ledgerAPI.balanceSheet(asOf) });
  if (!q.data) return <Loading q={q} />;
  const d = q.data;
  return (
    <table className="w-full"><tbody>
      <Head>What the school has (assets)</Head><Rows rows={d.assets.rows} money={money} to={asOf} /><Total label="Total assets" value={money(d.assets.total)} strong />
      <Head>What the school owes (liabilities)</Head><Rows rows={d.liabilities.rows} money={money} to={asOf} /><Total label="Total liabilities" value={money(d.liabilities.total)} />
      <Head>Owner’s funds (equity)</Head><Rows rows={d.equity.rows} money={money} to={asOf} />
      <tr><td className="py-1.5 pl-4 text-sm">{Number(d.equity.surplus) < 0 ? 'Deficit so far' : 'Surplus so far'} <span className="text-xs text-gray-400">(income less expenditure)</span></td>
        <td className={`py-1.5 text-right text-sm tabular-nums ${Number(d.equity.surplus) < 0 ? 'text-red-600' : ''}`}>{money(d.equity.surplus)}</td></tr>
      <Total label="Total owner’s funds" value={money(d.equity.total)} />
      <Total label="Liabilities + owner’s funds" value={money(d.liabilitiesAndEquity)} strong />
      <tr><td colSpan={2} className="pt-2"><Balanced ok={d.balanced} text="Assets equal liabilities plus owner’s funds." /></td></tr>
    </tbody></table>
  );
}

function TrialBalance({ asOf }: { asOf: string }) {
  const { money } = useFinance();
  const q = useQuery({ queryKey: ['finance', 'ledger', 'trial', asOf], queryFn: () => ledgerAPI.trialBalance(asOf) });
  if (!q.data) return <Loading q={q} />;
  const d = q.data;
  return (
    <>
      <table className="w-full text-sm">
        <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-gray-500"><th className="py-2 font-semibold">Account</th><th className="py-2 text-right font-semibold">Debit</th><th className="py-2 text-right font-semibold">Credit</th></tr></thead>
        <tbody>
          {d.rows.map((r) => (
            <tr key={r.id} className="border-b border-slate-100">
              <td className="py-1.5"><Link href={`/accounting/ledger/${r.id}?to=${asOf}`} className="hover:text-primary-700 hover:underline"><span className="mr-2 font-mono text-xs text-gray-400">{r.code}</span>{r.name}</Link></td>
              <td className="py-1.5 text-right tabular-nums">{Number(r.debit) ? money(r.debit) : ''}</td>
              <td className="py-1.5 text-right tabular-nums">{Number(r.credit) ? money(r.credit) : ''}</td>
            </tr>
          ))}
          {d.rows.length === 0 && <tr><td colSpan={3} className="py-4 text-center text-gray-400">Nothing in the books yet</td></tr>}
        </tbody>
        <tfoot><tr className="border-t-2 border-slate-400 font-bold"><td className="py-2">Total</td><td className="py-2 text-right tabular-nums">{money(d.debit)}</td><td className="py-2 text-right tabular-nums">{money(d.credit)}</td></tr></tfoot>
      </table>
      <div className="mt-2"><Balanced ok={d.balanced} text="Debits equal credits." /></div>
    </>
  );
}

const Balanced = ({ ok, text }: { ok: boolean; text: string }) => (
  <p className={cn('inline-flex items-center gap-1.5 text-xs', ok ? 'text-emerald-700' : 'font-semibold text-red-600')}>
    {ok && <CheckCircle2 className="h-4 w-4" />}{ok ? text : 'The books do not balance. Please report this.'}
  </p>
);

/** Closing a month locks it: nothing dated in it can be added, changed or removed. */
function Closing() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['finance', 'ledger', 'closing'], queryFn: ledgerAPI.closing });
  const [period, setPeriod] = useState('');
  const done = (r: { data: { message: string } }) => { toast.success(r.data.message); qc.invalidateQueries({ queryKey: ['finance'] }); };
  const close = useMutation({ mutationFn: (p: string) => ledgerAPI.close(p), onSuccess: done, onError: financeError });
  const reopen = useMutation({ mutationFn: (p: string) => ledgerAPI.reopen(p), onSuccess: done, onError: financeError });
  if (!data) return null;
  const target = period || data.canCloseThrough || '';
  return (
    <div className="card mx-auto flex w-full max-w-3xl flex-wrap items-center gap-3 print:hidden">
      <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl', data.closedThrough ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500')}>{data.closedThrough ? <Lock className="h-5 w-5" /> : <LockOpen className="h-5 w-5" />}</div>
      <div className="min-w-0 flex-1">
        <h3 className="section-title">Month closing</h3>
        <p className="text-xs text-gray-500">{data.closedThrough ? `The books are closed up to ${data.closedLabel}. Nothing dated in or before that month can be added, changed or removed.` : 'No month is closed yet. Close a month once its figures are final, so they can’t change afterwards.'}</p>
      </div>
      {data.canClose && data.canCloseThrough && (
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (target && window.confirm(`Close the books up to ${formatPeriod(target)}? Only the owner can reopen them.`)) close.mutate(target); }}>
          <input type="month" className="input w-40" aria-label="Close up to" value={target} max={data.canCloseThrough} min={data.closedThrough ?? undefined} onChange={(e) => setPeriod(e.target.value)} />
          <button className="btn-primary" disabled={close.isPending || !target}><Lock className="h-4 w-4" /> Close</button>
        </form>
      )}
      {data.canReopen && data.closedThrough && (
        <button className="btn-secondary" disabled={reopen.isPending} onClick={() => window.confirm(`Reopen ${data.closedLabel}? Entries in that month can then be changed again.`) && reopen.mutate(data.closedThrough!)}><LockOpen className="h-4 w-4" /> Reopen {formatPeriod(data.closedThrough)}</button>
      )}
    </div>
  );
}
