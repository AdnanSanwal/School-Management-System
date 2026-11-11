'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Empty, Spinner } from '@/components/ui/kit';
import { payrollAPI, apiError } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { formatDate, formatMoney } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';

/** A staff member's own payslips and what they still owe in advances or loans. */
export default function MyPayslipsPage() {
  const currency = useAuthStore((s) => s.user?.school?.currency ?? 'PKR');
  const { data, isLoading, error } = useQuery({ queryKey: ['payroll', 'my'], queryFn: payrollAPI.my });
  const money = (v: unknown) => formatMoney(v as string, currency);

  return (
    <DashboardLayout title="My payslips" allowedRoles={CAN.myPayslips} subtitle={data?.staff ? `${data.staff.name} · ${data.staff.employeeNo}` : undefined}>
      {isLoading ? <Spinner /> : error ? <div className="card text-sm text-red-600">{apiError(error)}</div> : !data?.staff ? (
        <div className="card"><Empty title="No staff record is linked to your login">Ask the office to link your login to your staff record.</Empty></div>
      ) : (
        <>
          {data.loans.length > 0 && (
            <div className="card space-y-2">
              <h3 className="section-title">Advances and loans you still owe</h3>
              <ul className="divide-y divide-slate-100 text-sm">
                {data.loans.map((l: any) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>{l.kind === 'ADVANCE' ? 'Salary advance' : 'Loan'} of {money(l.amount)} <span className="text-gray-500">· given {formatDate(l.issuedOn)} · {money(l.installment)} from each salary</span></span>
                    <span className="font-semibold tabular-nums">{money(l.outstanding)} left</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="card">
            {data.payslips.length === 0 ? <Empty title="No payslips yet">A payslip appears here once that month’s salary has been paid.</Empty> : (
              <div className="table-container">
                <table className="table">
                  <thead><tr><th>Month</th><th>Paid on</th><th className="text-right">Earnings</th><th className="text-right">Deductions</th><th className="text-right">Net pay</th><th /></tr></thead>
                  <tbody>
                    {data.payslips.map((p: any) => (
                      <tr key={p.id}>
                        <td className="font-medium">{p.label}</td>
                        <td className="text-sm">{p.paymentDate ? formatDate(p.paymentDate) : '—'}</td>
                        <td className="text-right tabular-nums">{money(Number(p.gross) + Number(p.bonus))}</td>
                        <td className="text-right tabular-nums text-red-600">{money(p.totalDeductions)}</td>
                        <td className="text-right font-semibold tabular-nums">{money(p.net)}</td>
                        <td className="text-right"><Link href={`/payroll/payslip/${p.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary-700 hover:underline"><Printer className="h-4 w-4" /> Payslip</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </DashboardLayout>
  );
}
