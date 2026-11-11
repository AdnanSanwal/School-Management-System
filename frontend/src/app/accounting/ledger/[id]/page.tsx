'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Empty, Spinner } from '@/components/ui/kit';
import { ledgerAPI, apiError } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { formatDate, todayIso } from '@/lib/utils';
import { useFinance } from '@/components/finance/shared';

export default function AccountLedgerPage() {
  return <Suspense fallback={null}><AccountLedger /></Suspense>;
}

/** One account's ledger: every posting in the dates with a running balance. */
function AccountLedger() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const { money } = useFinance();
  const today = todayIso();
  const [to, setTo] = useState(params.get('to') ?? today);
  const [from, setFrom] = useState(params.get('from') ?? `${(params.get('to') ?? today).slice(0, 7)}-01`);
  const { data, isLoading, error } = useQuery({ queryKey: ['finance', 'ledger', 'account', id, from, to], queryFn: () => ledgerAPI.accountLedger(id, { from, to }), enabled: from <= to });

  return (
    <DashboardLayout title={data ? `${data.account.code} · ${data.account.name}` : 'Account ledger'} allowedRoles={CAN.viewFinance}
      subtitle={data ? `${formatDate(data.from)} to ${formatDate(data.to)}` : undefined}
      actions={<>
        <Link href="/accounting/chart" className="btn-secondary print:hidden"><ArrowLeft className="h-4 w-4" /> Chart of accounts</Link>
        <button className="btn-secondary print:hidden" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</button>
      </>}>
      <div className="card space-y-3">
        <div className="flex flex-wrap items-end gap-2 print:hidden">
          <label><span className="label">From</span><input type="date" className="input" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
          <label><span className="label">To</span><input type="date" className="input" value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
        </div>
        {isLoading ? <Spinner /> : error ? <p className="text-sm text-red-600">{apiError(error)}</p> : data && (
          <div className="table-container">
            <table className="table">
              <thead><tr><th>Date</th><th>Details</th><th>Other account</th><th>Reference</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th className="text-right">Balance</th></tr></thead>
              <tbody>
                <tr className="bg-slate-50 text-sm font-medium"><td colSpan={6}>Opening balance</td><td className="text-right tabular-nums">{money(data.opening)}</td></tr>
                {data.rows.map((r: any) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap text-sm">{formatDate(r.date)}</td>
                    <td className="text-sm">{r.description}</td>
                    <td className="text-sm text-gray-500">{r.against}</td>
                    <td className="font-mono text-xs text-gray-500">{r.reference ?? ''}</td>
                    <td className="text-right tabular-nums">{Number(r.debit) ? money(r.debit) : ''}</td>
                    <td className="text-right tabular-nums">{Number(r.credit) ? money(r.credit) : ''}</td>
                    <td className="text-right tabular-nums">{money(r.balance)}</td>
                  </tr>
                ))}
                {data.rows.length === 0 && <tr><td colSpan={7}><Empty title="No postings in these dates" /></td></tr>}
              </tbody>
              <tfoot><tr className="bg-slate-50 font-semibold">
                <td className="px-4 py-3 text-sm" colSpan={4}>Closing balance</td>
                <td className="px-4 py-3 text-right text-sm tabular-nums">{money(data.debit)}</td>
                <td className="px-4 py-3 text-right text-sm tabular-nums">{money(data.credit)}</td>
                <td className="px-4 py-3 text-right text-sm tabular-nums">{money(data.closing)}</td>
              </tr></tfoot>
            </table>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
