'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Spinner, Empty } from '@/components/ui/kit';
import { hrAPI, apiError } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { LEAVE_LABEL } from '@/components/hr/LeaveCard';

/** Everyone's leave for the academic year: used / allowed per type, and unpaid days. */
export default function LeaveBalancesPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['hr', 'leave-balances'], queryFn: hrAPI.leaveBalances });
  const [search, setSearch] = useState('');
  const types = (data?.staff[0]?.balances ?? []).filter((b) => b.isPaid).map((b) => b.type);
  const term = search.trim().toLowerCase();
  const rows = (data?.staff ?? []).filter((s) => !term || `${s.name} ${s.employeeNo} ${s.designation ?? ''}`.toLowerCase().includes(term));

  return (
    <DashboardLayout title="Leave balances" allowedRoles={CAN.viewLeaveBalances} subtitle={data ? `Academic year ${data.year} · used / allowed` : undefined}>
      <div className="card space-y-3">
        <input className="input max-w-xs" placeholder="Search staff" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search staff" />
        {isLoading ? <Spinner /> : error ? <p className="text-sm text-red-600">{apiError(error)}</p> : rows.length === 0 ? <Empty title="No staff found" /> : (
          <div className="table-container">
            <table className="table">
              <thead><tr><th>Staff</th>{types.map((t) => <th key={t} className="text-right">{LEAVE_LABEL[t] ?? t}</th>)}<th className="text-right">Pending</th><th className="text-right">Unpaid days</th></tr></thead>
              <tbody>
                {rows.map((s) => {
                  const unpaid = s.balances.reduce((n, b) => n + b.unpaid, 0);
                  const pending = s.balances.reduce((n, b) => n + b.pending, 0);
                  return (
                    <tr key={s.id}>
                      <td><Link href={`/staff/${s.id}`} className="font-medium text-primary-700 hover:underline">{s.name}</Link><span className="block text-xs text-gray-500">{s.employeeNo}{s.designation ? ` · ${s.designation}` : ''}</span></td>
                      {types.map((t) => {
                        const b = s.balances.find((x) => x.type === t)!;
                        return <td key={t} className={`text-right tabular-nums ${b.used > b.allowed ? 'font-semibold text-red-600' : ''}`}>{b.used} / {b.allowed}</td>;
                      })}
                      <td className="text-right tabular-nums">{pending || '—'}</td>
                      <td className="text-right tabular-nums">{unpaid ? <span className="badge badge-red">{unpaid}</span> : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-gray-500">Unpaid days are approved leave beyond the allowance, plus any leave of an unpaid type. They are deducted in payroll.</p>
      </div>
    </DashboardLayout>
  );
}
