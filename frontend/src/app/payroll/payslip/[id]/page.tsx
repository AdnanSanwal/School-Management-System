'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { Spinner } from '@/components/ui/kit';
import { payrollAPI, apiError, PayPart } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/utils';
import { days } from '@/components/payroll/shared';

// Printable payslip. Standalone page (no sidebar) so it prints cleanly; "Save as PDF" in the print dialog gives a PDF.
export default function PayslipPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: p, isLoading, error } = useQuery({ queryKey: ['payroll', 'payslip', id], queryFn: () => payrollAPI.payslip(id) });
  if (isLoading) return <Spinner />;
  if (error || !p) return <p className="p-8 text-red-600">{apiError(error, 'Payslip not found')}</p>;
  const money = (v: unknown) => formatMoney(v as string, p.school.currency);
  const earnings: [string, unknown][] = [['Basic salary', p.basic], ...p.allowances.map((a: PayPart) => [a.name, a.amount] as [string, unknown]), ...(Number(p.bonus) ? [['Bonus / extra pay', p.bonus] as [string, unknown]] : [])];
  const deductions: [string, unknown][] = [
    ...p.fixedDeductions.map((a: PayPart) => [a.name, a.amount] as [string, unknown]),
    ...(Number(p.absenceDeduction) ? [[`Absence (${days(p.deductDays)} day${Number(p.deductDays) === 1 ? '' : 's'})`, p.absenceDeduction] as [string, unknown]] : []),
    ...(Number(p.loanDeduction) ? [['Advance / loan recovery', p.loanDeduction] as [string, unknown]] : []),
    ...(Number(p.otherDeduction) ? [['Other deduction', p.otherDeduction] as [string, unknown]] : []),
  ];
  const rows = Math.max(earnings.length, deductions.length);

  return (
    <div className="min-h-screen bg-slate-100 py-8 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-2xl justify-between print:hidden">
        <button className="btn btn-ghost" onClick={() => (window.history.length > 1 ? router.back() : router.push('/payroll/my'))}><ArrowLeft className="h-4 w-4" /> Back</button>
        <button className="btn btn-primary" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print / save as PDF</button>
      </div>
      <article className="mx-auto max-w-2xl rounded-2xl bg-white p-8 shadow-sm print:max-w-none print:rounded-none print:shadow-none">
        <header className="border-b border-slate-200 pb-4 text-center">
          <h1 className="text-xl font-bold">{p.school.name}</h1>
          {p.school.address && <p className="text-sm text-gray-500">{p.school.address}</p>}
          <p className="mt-3 text-sm font-semibold uppercase tracking-widest text-gray-700">Payslip — {p.label}</p>
          {p.status !== 'PAID' && <p className="mt-1 text-xs font-medium uppercase text-amber-600">Not paid yet — {p.status.toLowerCase()}</p>}
        </header>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-1.5 py-4 text-sm sm:grid-cols-4">
          <dt className="text-gray-500">Name</dt><dd className="font-medium">{p.name}</dd>
          <dt className="text-gray-500">Employee no.</dt><dd>{p.employeeNo}</dd>
          <dt className="text-gray-500">Designation</dt><dd>{p.designation ?? '—'}</dd>
          <dt className="text-gray-500">Department</dt><dd>{p.department ?? '—'}</dd>
          <dt className="text-gray-500">Days paid</dt><dd>{days(p.paidDays)} of {p.daysInMonth}</dd>
          <dt className="text-gray-500">Paid on</dt><dd>{p.paymentDate ? formatDate(p.paymentDate) : '—'}</dd>
          <dt className="text-gray-500">Paid to</dt><dd className="col-span-3">{p.bankAccountNo ? `${p.bankName ?? 'Bank'} · ${p.bankAccountNo}` : 'Cash'}</dd>
        </dl>
        <table className="w-full border-t border-slate-200 text-sm">
          <thead><tr className="text-left text-gray-500">
            <th className="py-2 font-medium">Earnings</th><th className="py-2 pr-6 text-right font-medium">Amount</th>
            <th className="py-2 pl-6 font-medium">Deductions</th><th className="py-2 text-right font-medium">Amount</th>
          </tr></thead>
          <tbody>
            {Array.from({ length: rows }, (_, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="py-2">{earnings[i]?.[0] ?? ''}</td><td className="py-2 pr-6 text-right tabular-nums">{earnings[i] ? money(earnings[i][1]) : ''}</td>
                <td className="border-l border-slate-100 py-2 pl-6">{deductions[i]?.[0] ?? ''}</td><td className="py-2 text-right tabular-nums">{deductions[i] ? money(deductions[i][1]) : ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300 font-semibold">
              <td className="py-2">Total earnings</td><td className="py-2 pr-6 text-right tabular-nums">{money(Number(p.gross) + Number(p.bonus))}</td>
              <td className="border-l border-slate-100 py-2 pl-6">Total deductions</td><td className="py-2 text-right tabular-nums">{money(p.totalDeductions)}</td>
            </tr>
          </tfoot>
        </table>
        <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 print:border print:border-slate-300 print:bg-white">
          <span className="text-sm font-semibold uppercase tracking-wide text-gray-600">Net pay</span>
          <span className="text-2xl font-bold tabular-nums">{money(p.net)}</span>
        </div>
        {p.remarks && <p className="mt-3 text-sm text-gray-600">Note: {p.remarks}</p>}
        <footer className="mt-12 flex justify-between text-xs text-gray-500">
          <span className="border-t border-slate-300 px-6 pt-1">Accountant</span>
          <span>Computer-generated payslip</span>
          <span className="border-t border-slate-300 px-6 pt-1">Received by</span>
        </footer>
      </article>
    </div>
  );
}
