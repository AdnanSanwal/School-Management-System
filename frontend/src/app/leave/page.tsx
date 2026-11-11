'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Send } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Field, Spinner, Empty, StatusBadge } from '@/components/ui/kit';
import { leaveAPI, apiError } from '@/lib/api';
import { CAN, can } from '@/lib/roles';
import { formatDate, todayIso } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { LeaveCard, LEAVE_LABEL } from '@/components/hr/LeaveCard';

export default function LeavePage() {
  const role = useAuthStore((s) => s.user?.role);
  const qc = useQueryClient();
  const mine = useQuery({ queryKey: ['leave', 'mine'], queryFn: leaveAPI.mine });
  const all = useQuery({ queryKey: ['leave', 'all'], queryFn: () => leaveAPI.list(), enabled: role === 'PRINCIPAL' });
  const [f, setF] = useState({ type: 'CASUAL', fromDate: todayIso(), toDate: todayIso(), reason: '' });
  const apply = useMutation({
    mutationFn: () => leaveAPI.apply(f),
    onSuccess: () => { toast.success('Sent to the principal'); setF({ ...f, reason: '' }); qc.invalidateQueries({ queryKey: ['leave'] }); qc.invalidateQueries({ queryKey: ['hr'] }); },
    onError: (e) => toast.error(apiError(e)),
  });
  const cancel = useMutation({
    mutationFn: leaveAPI.cancel,
    onSuccess: () => { toast.success('Withdrawn'); qc.invalidateQueries({ queryKey: ['leave'] }); },
    onError: (e) => toast.error(apiError(e)),
  });
  // How much of this request would go beyond the allowance (shown before sending).
  const chosen = (mine.data?.balances ?? []).find((b: any) => b.type === f.type);
  const days = Math.max(1, Math.round((new Date(f.toDate).getTime() - new Date(f.fromDate).getTime()) / 86_400_000) + 1);
  const overBy = chosen?.isPaid ? Math.min(days, Math.max(0, chosen.used + chosen.pending + days - chosen.allowed)) : 0;

  return (
    <DashboardLayout title="Leave" allowedRoles={CAN.applyLeave}>
      <div className="grid gap-4 lg:grid-cols-3">
        <form className="card h-fit space-y-3" onSubmit={(e) => { e.preventDefault(); apply.mutate(); }}>
          <h3 className="section-title">Apply for leave</h3>
          <Field label="Type">
            <select className="select" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              {(mine.data?.balances ?? [{ type: 'CASUAL' }, { type: 'SICK' }, { type: 'OTHER' }]).map((b: any) => (
                <option key={b.type} value={b.type}>{LEAVE_LABEL[b.type] ?? b.type}{b.isPaid === false ? ' (unpaid)' : b.allowed !== undefined ? ` (${b.remaining} of ${b.allowed} left)` : ''}</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="From"><input type="date" className="input" required value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value, toDate: e.target.value > f.toDate ? e.target.value : f.toDate })} /></Field>
            <Field label="To"><input type="date" className="input" required min={f.fromDate} value={f.toDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} /></Field>
          </div>
          <Field label="Reason"><textarea className="input" rows={3} required minLength={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
          <button className="btn btn-primary w-full" disabled={apply.isPending}><Send className="h-4 w-4" /> Send request</button>
          {overBy > 0 && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{overBy} of these {days} day(s) are beyond your {(LEAVE_LABEL[f.type] ?? f.type).toLowerCase()} allowance and would be unpaid.</p>}
          {chosen?.isPaid === false && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">This leave type is unpaid: {days} day(s) would be deducted from salary.</p>}
        </form>
        <div className="space-y-4 lg:col-span-2">
          {mine.data?.balances && <LeaveCard title="My leave balance" year={mine.data.year} balances={mine.data.balances} />}
        <div className="card">
          <h3 className="section-title mb-3">My requests</h3>
          {mine.isLoading ? <Spinner /> : mine.error ? <p className="text-sm text-gray-500">{apiError(mine.error)}</p> : !mine.data.requests.length ? <Empty title="No leave requests" /> : (
            <table className="table">
              <thead><tr><th>Dates</th><th>Type</th><th>Days</th><th>Reason</th><th>Status</th><th /></tr></thead>
              <tbody>
                {mine.data.requests.map((l: any) => (
                  <tr key={l.id}>
                    <td className="text-sm">{formatDate(l.fromDate)}{l.toDate !== l.fromDate ? ` – ${formatDate(l.toDate)}` : ''}</td>
                    <td className="text-sm">{l.type.toLowerCase()}</td><td>{l.days}</td>
                    <td className="text-sm text-gray-600">{l.reason}{l.decisionNote ? <span className="block text-xs text-gray-400">Principal: {l.decisionNote}</span> : null}</td>
                    <td><StatusBadge status={l.status} /></td>
                    <td>{l.status === 'PENDING' && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => cancel.mutate(l.id)}>Withdraw</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        </div>
      </div>
      {all.data && can(role, 'reports') && (
        <div className="card">
          <h3 className="section-title mb-3">All staff leave</h3>
          <table className="table">
            <thead><tr><th>Staff</th><th>Dates</th><th>Type</th><th>Days</th><th>Status</th></tr></thead>
            <tbody>
              {all.data.map((l: any) => (
                <tr key={l.id}><td className="font-medium">{l.staff.name}</td>
                  <td className="text-sm">{formatDate(l.fromDate)}{l.toDate !== l.fromDate ? ` – ${formatDate(l.toDate)}` : ''}</td>
                  <td className="text-sm">{l.type.toLowerCase()}</td><td>{l.days}</td><td><StatusBadge status={l.status} /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DashboardLayout>
  );
}
