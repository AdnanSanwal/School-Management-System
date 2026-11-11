'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Empty, Field, Modal, Spinner } from '@/components/ui/kit';
import { payrollAPI, apiError } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { formatDate, todayIso } from '@/lib/utils';
import { useFinance, financeError } from '@/components/finance/shared';
import { PayrollBadge, usePayrollRole } from '@/components/payroll/shared';

/** Every month's payroll and where it stands. */
export default function PayrollPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { money } = useFinance();
  const { canManage } = usePayrollRole();
  const { data, isLoading, error } = useQuery({ queryKey: ['payroll', 'runs'], queryFn: payrollAPI.runs });
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState(todayIso().slice(0, 7));
  const prepare = useMutation({
    mutationFn: () => payrollAPI.prepare(period),
    onSuccess: (r) => { toast.success(r.data.message, { duration: 6000 }); qc.invalidateQueries({ queryKey: ['payroll'] }); router.push(`/payroll/${r.data.data.id}`); },
    onError: financeError,
  });

  return (
    <DashboardLayout title="Payroll" allowedRoles={CAN.viewPayroll} subtitle="Prepared by the accountant, approved by the owner, then paid"
      actions={canManage ? <button className="btn-primary" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Prepare payroll</button> : undefined}>
      <div className="card">
        {isLoading ? <Spinner /> : error ? <p className="text-sm text-red-600">{apiError(error)}</p> : !data?.length ? (
          <Empty title="No payroll yet">{canManage ? 'Choose “Prepare payroll” to work out this month’s salaries.' : 'The accountant has not prepared a payroll yet.'}</Empty>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead><tr><th>Month</th><th>Status</th><th className="text-right">Staff</th><th className="text-right">Gross</th><th className="text-right">Deductions</th><th className="text-right">Net pay</th><th>Paid on</th><th /></tr></thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium">{r.label}</td>
                    <td><PayrollBadge status={r.status} /></td>
                    <td className="text-right tabular-nums">{r.staff}</td>
                    <td className="text-right tabular-nums">{money(r.gross)}</td>
                    <td className="text-right tabular-nums text-red-600">{money(r.deductions)}</td>
                    <td className="text-right font-semibold tabular-nums">{money(r.net)}</td>
                    <td className="text-sm">{r.paymentDate ? formatDate(r.paymentDate) : '—'}</td>
                    <td className="text-right"><Link href={`/payroll/${r.id}`} className="text-sm font-medium text-primary-700 hover:underline">Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Prepare payroll">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); prepare.mutate(); }}>
          <Field label="Month" hint="Salaries, absences, unpaid leave and loan instalments are worked out for this month. You can review and change every line before sending it to the owner.">
            <input type="month" required className="input" value={period} max={todayIso().slice(0, 7)} onChange={(e) => setPeriod(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button><button className="btn-primary" disabled={prepare.isPending}>Prepare</button></div>
        </form>
      </Modal>
    </DashboardLayout>
  );
}
