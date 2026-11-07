'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Spinner, Empty, Stat } from '@/components/ui/kit';
import { feesAPI, academicsAPI, apiError } from '@/lib/api';
import { CAN, can } from '@/lib/roles';
import { formatMoney, formatPeriod } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { AlertTriangle, Users, BellRing } from 'lucide-react';

export default function DefaultersPage() {
  const user = useAuthStore((s) => s.user);
  const currency = user?.school?.currency ?? 'PKR';
  const [classId, setClassId] = useState('');
  const [minDays, setMinDays] = useState('0');
  const classes = useQuery({ queryKey: ['classes'], queryFn: academicsAPI.classes });
  const { data, isLoading } = useQuery({
    queryKey: ['defaulters', classId, minDays],
    queryFn: () => feesAPI.defaulters({ classId: classId || undefined, minDaysOverdue: minDays }),
  });

  const remind = useMutation({
    mutationFn: () => feesAPI.sendReminders({ daysAhead: 3, classId: classId || undefined }),
    onSuccess: (r: any) => toast.success(`Reminders sent to ${r.parentsReminded} parent(s)` + (r.skippedAlreadyRemindedToday ? ` · ${r.skippedAlreadyRemindedToday} already reminded today` : '')),
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <DashboardLayout title="Defaulters" allowedRoles={CAN.viewFees} subtitle="Students with overdue fee"
      actions={can(user?.role, 'sendFeeReminders') && (
        <button className="btn btn-primary" disabled={remind.isPending} title="Push reminder to parents with fee overdue or due in the next 3 days"
          onClick={() => confirm('Send a fee reminder to parents with overdue fee or fee due in the next 3 days?') && remind.mutate()}>
          <BellRing className="h-4 w-4" /> Send reminders
        </button>
      )}>
      <div className="card flex flex-wrap items-end gap-3">
        <label><span className="label">Class</span>
          <select className="select w-44" value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">All classes</option>
            {(classes.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label><span className="label">Overdue by</span>
          <select className="select w-44" value={minDays} onChange={(e) => setMinDays(e.target.value)}>
            <option value="0">Any time past due</option><option value="15">More than 15 days</option>
            <option value="30">More than 30 days</option><option value="60">More than 60 days</option>
          </select>
        </label>
      </div>
      {isLoading || !data ? <Spinner /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Stat icon={Users} tone="warn" label="Students" value={data.count} />
            <Stat icon={AlertTriangle} tone="bad" label="Overdue amount" value={formatMoney(data.totalPending, currency)} />
          </div>
          <div className="card">
            {data.students.length === 0 ? <Empty title="No defaulters 🎉" /> : (
              <div className="table-container">
                <table className="table">
                  <thead><tr><th>Student</th><th>Class</th><th>Parent</th><th>Months</th><th>Days overdue</th><th className="text-right">Pending</th><th /></tr></thead>
                  <tbody>
                    {data.students.map((s: any) => (
                      <tr key={s.studentId}>
                        <td><Link href={`/students/${s.studentId}`} className="font-medium hover:text-primary-600">{s.name}</Link><p className="text-xs text-gray-400">{s.admissionNo}</p></td>
                        <td className="text-sm">{s.section ?? '—'}</td>
                        <td className="text-sm">{s.guardian ? <>{s.guardian.name}<p className="text-xs text-gray-500"><a href={`tel:${s.guardian.phone}`}>{s.guardian.phone}</a></p></> : '—'}</td>
                        <td className="text-sm">{s.months.map(formatPeriod).join(', ')}</td>
                        <td className={s.daysOverdue > 30 ? 'font-semibold text-red-600' : ''}>{s.daysOverdue}</td>
                        <td className="text-right font-semibold">{formatMoney(s.pending, currency)}</td>
                        <td>{can(user?.role, 'collectFees') && <Link href={`/fees?student=${s.studentId}`} className="text-sm text-primary-600 hover:underline">Collect</Link>}</td>
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
