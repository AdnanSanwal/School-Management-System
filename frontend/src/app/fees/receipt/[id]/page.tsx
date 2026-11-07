'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Printer, ArrowLeft } from 'lucide-react';
import { Spinner } from '@/components/ui/kit';
import { feesAPI, apiError } from '@/lib/api';
import { formatDateTime, formatMoney, formatPeriod, sectionLabel } from '@/lib/utils';

// Printable fee receipt. Standalone page (no sidebar) so it prints cleanly.
export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const { data: r, isLoading, error } = useQuery({ queryKey: ['receipt', id], queryFn: () => feesAPI.receipt(id) });
  if (isLoading) return <Spinner />;
  if (error || !r) return <p className="p-8 text-red-600">{apiError(error, 'Receipt not found')}</p>;
  const cur = r.school.currency;

  return (
    <div className="min-h-screen bg-slate-100 py-8 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-xl justify-between print:hidden">
        <Link href={`/fees?student=${r.student.id}`} className="btn btn-ghost"><ArrowLeft className="h-4 w-4" /> Back</Link>
        <button className="btn btn-primary" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</button>
      </div>
      <article className="mx-auto max-w-xl rounded-2xl bg-white p-8 shadow-sm print:max-w-none print:rounded-none print:shadow-none">
        <header className="border-b border-slate-200 pb-4 text-center">
          <h1 className="text-xl font-bold">{r.school.name}</h1>
          {r.school.address && <p className="text-sm text-gray-500">{r.school.address}</p>}
          {r.school.phone && <p className="text-sm text-gray-500">{r.school.phone}</p>}
          <p className="mt-3 text-sm font-semibold uppercase tracking-widest text-gray-700">Fee receipt</p>
        </header>
        <dl className="grid grid-cols-2 gap-y-1.5 py-4 text-sm">
          <dt className="text-gray-500">Receipt no.</dt><dd className="text-right font-mono font-semibold">{r.receiptNo}</dd>
          <dt className="text-gray-500">Date</dt><dd className="text-right">{formatDateTime(r.paidAt)}</dd>
          <dt className="text-gray-500">Student</dt><dd className="text-right font-medium">{r.student.name}</dd>
          <dt className="text-gray-500">Admission no.</dt><dd className="text-right">{r.student.admissionNo}</dd>
          <dt className="text-gray-500">Class</dt><dd className="text-right">{sectionLabel(r.student.section)}</dd>
          <dt className="text-gray-500">Paid by</dt><dd className="text-right">{r.method.replace('_', ' ').toLowerCase()}{r.reference ? ` · ${r.reference}` : ''}</dd>
        </dl>
        <table className="w-full border-t border-slate-200 text-sm">
          <thead><tr className="text-left text-gray-500"><th className="py-2 font-medium">Month</th><th className="py-2 font-medium">Details</th><th className="py-2 text-right font-medium">Paid</th></tr></thead>
          <tbody>
            {r.allocations.map((a: any) => (
              <tr key={a.invoiceId} className="border-t border-slate-100 align-top">
                <td className="py-2">{formatPeriod(a.invoice.period)}</td>
                <td className="py-2 text-gray-500">
                  {a.invoice.items.map((it: any) => `${it.feeHead.name} ${formatMoney(it.amount, cur)}${Number(it.discount) ? ` − ${formatMoney(it.discount, cur)}` : ''}`).join(', ')}
                  {a.invoice.status === 'PARTIAL' && <span className="ml-1 text-amber-600">(part payment)</span>}
                </td>
                <td className="py-2 text-right">{formatMoney(a.amount, cur)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300 font-semibold"><td className="py-2" colSpan={2}>Total received</td><td className="py-2 text-right">{formatMoney(r.amount, cur)}</td></tr>
            <tr className="text-gray-600"><td className="py-1" colSpan={2}>Remaining balance</td><td className="py-1 text-right">{formatMoney(r.remainingBalance, cur)}</td></tr>
          </tfoot>
        </table>
        <footer className="mt-8 flex justify-between text-xs text-gray-500">
          <span>Received by: {r.collectedBy ?? '—'}</span>
          <span>Computer-generated receipt</span>
        </footer>
      </article>
    </div>
  );
}
