'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Spinner, Empty, Stat } from '@/components/ui/kit';
import { SearchInput, NoMatches, matchesSearch } from '@/components/ui/SearchInput';
import { hrAPI, apiError } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { formatDate, formatMoney } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';

/** Salary sheet: what every active staff member is paid per month today. */
export default function SalariesPage() {
  const currency = useAuthStore((s) => s.user?.school?.currency ?? 'PKR');
  const { data, isLoading, error } = useQuery({ queryKey: ['hr', 'salaries'], queryFn: hrAPI.salaries });
  const [search, setSearch] = useState('');
  const [only, setOnly] = useState<'all' | 'missing'>('all');
  const term = search.trim();
  const rows: any[] = useMemo(() => (data?.rows ?? [])
    .filter((r: any) => only === 'all' || !r.salary)
    .filter((r: any) => matchesSearch(term, r.name, r.employeeNo, r.designation, r.department)), [data, term, only]);
  const t = data?.totals;
  const money = (v: unknown) => formatMoney(v as string, currency);

  return (
    <DashboardLayout title="Salaries" allowedRoles={CAN.viewSalary} subtitle={data ? `Monthly pay of active staff as of ${formatDate(data.asOf)}` : undefined}>
      {isLoading ? <Spinner /> : error ? <div className="card text-sm text-red-600">{apiError(error)}</div> : data && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Monthly net payroll" value={money(t.net)} sub={`Gross ${money(t.gross)}`} tone="good" />
            <Stat label="Fixed deductions" value={money(t.deductions)} sub="Tax, EOBI and similar" />
            <Stat label="Staff with salary set" value={`${t.withSalary}/${t.staff}`} tone={t.withSalary < t.staff ? 'warn' : 'default'}
              sub={t.withSalary < t.staff ? `${t.staff - t.withSalary} still need a salary` : 'Everyone is set'} />
          </div>
          <div className="card space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SearchInput className="w-72 max-w-full" placeholder="Name, employee no., designation" value={search} onChange={setSearch} aria-label="Search staff" />
              <select className="select w-48" value={only} onChange={(e) => setOnly(e.target.value as 'all' | 'missing')} aria-label="Show">
                <option value="all">All active staff</option><option value="missing">Without a salary</option>
              </select>
            </div>
            {rows.length === 0 ? (term ? <NoMatches term={term} what="staff" onClear={() => setSearch('')} /> : <Empty title={only === 'missing' ? 'Everyone has a salary set' : 'No active staff'} />) : (
              <div className="table-container">
                <table className="table">
                  <thead><tr><th>Staff</th><th>Designation</th><th>Bank</th><th className="text-right">Basic</th><th className="text-right">Allowances</th><th className="text-right">Deductions</th><th className="text-right">Net / month</th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td><Link href={`/staff/${r.id}`} className="font-medium text-primary-700 hover:underline">{r.name}</Link><span className="block text-xs text-gray-500">{r.employeeNo}</span></td>
                        <td className="text-sm">{r.designation ?? '—'}{r.department ? <span className="block text-xs text-gray-500">{r.department}</span> : null}</td>
                        <td className="text-sm">{r.bankName ?? '—'}{r.bankAccountNo ? <span className="block font-mono text-xs text-gray-500">{r.bankAccountNo}</span> : null}</td>
                        {r.salary ? <>
                          <td className="text-right tabular-nums">{money(r.salary.basic)}</td>
                          <td className="text-right tabular-nums">{money(r.salary.allowances)}</td>
                          <td className="text-right tabular-nums text-red-600">{Number(r.salary.deductions) ? `− ${money(r.salary.deductions)}` : '—'}</td>
                          <td className="text-right font-semibold tabular-nums">{money(r.salary.net)}</td>
                        </> : <td colSpan={4} className="text-right text-sm"><Link href={`/staff/${r.id}`} className="text-amber-700 hover:underline">No salary set — open profile</Link></td>}
                      </tr>
                    ))}
                  </tbody>
                  {only === 'all' && !term && (
                    <tfoot><tr className="bg-slate-50 font-semibold">
                      <td className="px-4 py-3 text-sm" colSpan={3}>Total ({t.withSalary} staff)</td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums">{money(t.basic)}</td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums">{money(t.allowances)}</td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums">{money(t.deductions)}</td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums">{money(t.net)}</td>
                    </tr></tfoot>
                  )}
                </table>
              </div>
            )}
            <p className="text-xs text-gray-500">Absence and unpaid-leave deductions are not included here; payroll works them out each month.</p>
          </div>
        </>
      )}
    </DashboardLayout>
  );
}
