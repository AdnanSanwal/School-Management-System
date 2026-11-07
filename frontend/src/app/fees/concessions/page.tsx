'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Check, X } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Spinner, StatusBadge, Empty } from '@/components/ui/kit';
import { feesAPI, apiError } from '@/lib/api';
import { CAN, can } from '@/lib/roles';
import { formatDate, formatMoney, sectionLabel } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';

export default function ConcessionsPage() {
  const user = useAuthStore((s) => s.user);
  const currency = user?.school?.currency ?? 'PKR';
  const approver = can(user?.role, 'approveConcession');
  const [status, setStatus] = useState('PENDING');
  const qc = useQueryClient();
  const { data = [], isLoading, error } = useQuery({ queryKey: ['concessions', status], queryFn: () => feesAPI.concessions({ status: status || undefined }) });

  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) => feesAPI.decideConcession(id, approve),
    onSuccess: (_r, v) => { toast.success(v.approve ? 'Approved' : 'Rejected'); qc.invalidateQueries({ queryKey: ['concessions'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <DashboardLayout title="Concessions" allowedRoles={CAN.viewFees}
      subtitle={approver ? 'Approve or reject fee concession requests' : 'Requests are approved by the principal. Request one from a student profile.'}
      actions={
        <select className="select w-40" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="PENDING">Pending</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option><option value="">All</option>
        </select>
      }>
      <div className="card">
        {error ? <p className="text-sm text-gray-500">{apiError(error)}</p> : isLoading ? <Spinner /> : data.length === 0 ? <Empty title="Nothing here" /> : (
          <div className="table-container">
            <table className="table">
              <thead><tr><th>Student</th><th>Concession</th><th>Reason</th><th>Valid</th><th>Status</th>{approver && <th />}</tr></thead>
              <tbody>
                {data.map((c: any) => (
                  <tr key={c.id}>
                    <td><Link href={`/students/${c.student.id}`} className="font-medium hover:text-primary-600">{c.student.name}</Link>
                      <p className="text-xs text-gray-400">{c.student.admissionNo} · {sectionLabel(c.student.section)}</p></td>
                    <td className="text-sm">{c.type === 'PERCENT' ? `${Number(c.value)}%` : formatMoney(c.value, currency)} off {c.feeHead?.name ?? 'all fees'}</td>
                    <td className="text-sm text-gray-600">{c.reason}</td>
                    <td className="text-sm">{formatDate(c.validFrom)}{c.validTo ? ` – ${formatDate(c.validTo)}` : ' onward'}</td>
                    <td><StatusBadge status={c.status} /></td>
                    {approver && <td>{c.status === 'PENDING' && (
                      <div className="flex gap-1">
                        <button className="btn-icon btn-ghost text-emerald-600" aria-label="Approve" disabled={decide.isPending} onClick={() => decide.mutate({ id: c.id, approve: true })}><Check className="h-4 w-4" /></button>
                        <button className="btn-icon btn-ghost text-red-600" aria-label="Reject" disabled={decide.isPending} onClick={() => decide.mutate({ id: c.id, approve: false })}><X className="h-4 w-4" /></button>
                      </div>
                    )}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
