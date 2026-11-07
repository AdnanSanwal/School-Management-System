'use client';

import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Check, X, Image as ImageIcon } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Spinner, Empty } from '@/components/ui/kit';
import { approvalsAPI, leaveAPI, feesAPI, paymentsAPI, apiError } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { formatDate, formatDateTime, formatMoney } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';

// Everything waiting for a decision (spec §6 Principal → Approvals; Accountant → online payments).
export default function ApprovalsPage() {
  const currency = useAuthStore((s) => s.user?.school?.currency ?? 'PKR');
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['approvals'], queryFn: approvalsAPI.inbox, refetchInterval: 60_000 });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['approvals'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); };

  const decide = useMutation({
    mutationFn: async ({ kind, id, approve }: { kind: 'leave' | 'concession' | 'claim'; id: string; approve: boolean }) => {
      const note = approve ? undefined : window.prompt('Reason (shown to the person)') ?? undefined;
      if (kind === 'leave') return leaveAPI.decide(id, approve, note);
      if (kind === 'concession') return feesAPI.decideConcession(id, approve);
      return paymentsAPI.decideClaim(id, approve, note);
    },
    onSuccess: (_r, v) => { toast.success(v.approve ? 'Approved' : 'Rejected'); refresh(); },
    onError: (e) => toast.error(apiError(e)),
  });
  const Buttons = ({ kind, id }: { kind: 'leave' | 'concession' | 'claim'; id: string }) => (
    <div className="flex gap-1">
      <button className="btn btn-primary px-3 py-1.5 text-sm" disabled={decide.isPending} onClick={() => decide.mutate({ kind, id, approve: true })}><Check className="h-4 w-4" /> {kind === 'claim' ? 'Verify' : 'Approve'}</button>
      <button className="btn btn-secondary px-3 py-1.5 text-sm" disabled={decide.isPending} onClick={() => decide.mutate({ kind, id, approve: false })}><X className="h-4 w-4" /> Reject</button>
    </div>
  );

  return (
    <DashboardLayout title="Approvals" allowedRoles={CAN.approvals} subtitle={data ? `${data.total} waiting` : undefined}>
      {isLoading ? <Spinner /> : data.total === 0 ? <div className="card"><Empty title="All caught up" /></div> : (
        <div className="space-y-6">
          {data.paymentClaims?.length > 0 && (
            <section className="card">
              <h3 className="section-title mb-1">Online payments to verify</h3>
              <p className="mb-3 text-xs text-gray-500">Check the transaction ID in the school&apos;s JazzCash / Easypaisa / bank statement before verifying. Verifying issues the receipt.</p>
              <ul className="divide-y divide-slate-100">
                {data.paymentClaims.map((c: any) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="text-sm">
                      <p><Link href={`/students/${c.student.id}`} className="font-medium hover:text-primary-600">{c.student.name}</Link> <span className="text-gray-400">{c.student.admissionNo}</span></p>
                      <p><b>{formatMoney(c.amount, currency)}</b> via {c.method.replace('_', ' ').toLowerCase()} · ref <code>{c.reference}</code></p>
                      <p className="text-xs text-gray-500">Submitted {formatDateTime(c.createdAt)}{c.note ? ` · “${c.note}”` : ''}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {c.proof && <a href={c.proof} target="_blank" rel="noreferrer noopener" className="btn btn-ghost px-2 py-1 text-sm"><ImageIcon className="h-4 w-4" /> Proof</a>}
                      <Buttons kind="claim" id={c.id} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {data.leaves?.length > 0 && (
            <section className="card">
              <h3 className="section-title mb-3">Leave requests</h3>
              <ul className="divide-y divide-slate-100">
                {data.leaves.map((l: any) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                    <div>
                      <p><b>{l.staff.name}</b> <span className="text-gray-500">{l.staff.designation ?? ''}</span></p>
                      <p>{l.type.toLowerCase()} · {formatDate(l.fromDate)}{l.toDate !== l.fromDate ? ` – ${formatDate(l.toDate)}` : ''}</p>
                      <p className="text-gray-500">{l.reason}</p>
                    </div>
                    <Buttons kind="leave" id={l.id} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {data.concessions?.length > 0 && (
            <section className="card">
              <h3 className="section-title mb-3">Fee concessions</h3>
              <ul className="divide-y divide-slate-100">
                {data.concessions.map((c: any) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                    <div>
                      <p><Link href={`/students/${c.student.id}`} className="font-medium hover:text-primary-600">{c.student.name}</Link></p>
                      <p>{c.type === 'PERCENT' ? `${Number(c.value)}%` : formatMoney(c.value, currency)} off {c.feeHead?.name ?? 'all fees'} from {formatDate(c.validFrom)}</p>
                      <p className="text-gray-500">{c.reason}</p>
                    </div>
                    <Buttons kind="concession" id={c.id} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </DashboardLayout>
  );
}

