'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Spinner, Stat, Empty } from '@/components/ui/kit';
import { SearchInput, NoMatches, cleanTerm, useDebounced } from '@/components/ui/SearchInput';
import { feesAPI } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { formatDateTime, formatMoney, sectionLabel, todayIso } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { Wallet } from 'lucide-react';

export default function CollectionsPage() {
  const currency = useAuthStore((s) => s.user?.school?.currency ?? 'PKR');
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const [method, setMethod] = useState('');
  const [search, setSearch] = useState('');
  const term = useDebounced(cleanTerm(search), 250);
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['payments', from, to, method, term, page],
    queryFn: () => feesAPI.payments({ from, to, method: method || undefined, search: term || undefined, page, limit: 50 }),
    placeholderData: keepPreviousData,
  });
  const rows: any[] = data?.data ?? [];

  return (
    <DashboardLayout title="Collections" allowedRoles={CAN.viewFees} subtitle="Daily collection report">
      <div className="card flex flex-wrap items-end gap-3">
        <label><span className="label">From</span><input type="date" className="input" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></label>
        <label><span className="label">To</span><input type="date" className="input" value={to} min={from} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></label>
        <label><span className="label">Method</span>
          <select className="select" value={method} onChange={(e) => { setMethod(e.target.value); setPage(1); }}>
            <option value="">All</option><option value="CASH">Cash</option><option value="BANK_TRANSFER">Bank transfer</option>
            <option value="JAZZCASH">JazzCash</option><option value="EASYPAISA">Easypaisa</option><option value="CHEQUE">Cheque</option><option value="CARD">Card</option><option value="ONLINE">Online</option>
          </select>
        </label>
        <label className="min-w-[14rem] flex-1"><span className="label">Search</span>
          <SearchInput placeholder="Receipt no., student, admission no., reference" value={search} onChange={(v) => { setSearch(v); setPage(1); }} aria-label="Search payments" />
        </label>
      </div>
      {data?.totals && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat icon={Wallet} tone="good" label="Total collected" value={formatMoney(data.totals.amount, currency)} sub={`${data.pagination.total} receipts`} />
          {data.totals.byMethod.map((m: any) => (
            <Stat key={m.method} label={m.method.replace('_', ' ').toLowerCase()} value={formatMoney(m.amount, currency)} sub={`${m.count} receipts`} />
          ))}
        </div>
      )}
      <div className="card">
        {isLoading ? <Spinner /> : rows.length === 0 ? (term ? <NoMatches term={term} what="payments" onClear={() => setSearch('')}>Only payments between the dates above are searched.</NoMatches> : <Empty title="No payments in this period" />) : (
          <div className="table-container">
            <table className="table">
              <thead><tr><th>Receipt</th><th>Time</th><th>Student</th><th>Class</th><th>Method</th><th className="text-right">Amount</th><th /></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td className="font-mono text-sm">{p.receiptNo}</td>
                    <td className="text-sm text-gray-600">{formatDateTime(p.paidAt)}</td>
                    <td><Link href={`/students/${p.student.id}`} className="font-medium hover:text-primary-600">{p.student.name}</Link></td>
                    <td className="text-sm">{sectionLabel(p.student.section)}</td>
                    <td className="text-sm capitalize">{p.method.replace('_', ' ').toLowerCase()}</td>
                    <td className="text-right font-medium">{formatMoney(p.amount, currency)}</td>
                    <td><Link href={`/fees/receipt/${p.id}`} className="btn-icon btn-ghost" aria-label="Receipt"><Printer className="h-4 w-4" /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data?.pagination?.pages > 1 && (
          <div className="mt-3 flex justify-end gap-2">
            <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <button className="btn btn-ghost" disabled={page >= (data?.pagination?.pages ?? 1)} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
