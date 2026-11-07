'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Spinner, Stat } from '@/components/ui/kit';
import { attendanceAPI, apiError } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import toast from 'react-hot-toast';
import { CAN, can } from '@/lib/roles';
import { todayIso } from '@/lib/utils';
import { CheckCircle2, XCircle, ClipboardList } from 'lucide-react';

export default function AttendanceSummaryPage() {
  const [date, setDate] = useState(todayIso());
  const { data, isLoading } = useQuery({ queryKey: ['att-summary', date], queryFn: () => attendanceAPI.summary(date) });
  const role = useAuthStore((s) => s.user?.role);
  const alerts = useMutation({
    mutationFn: attendanceAPI.lowAttendanceAlerts,
    onSuccess: (r: any) => toast.success(`${r.students} student(s) below ${r.threshold}% · ${r.parentsNotified} parent(s) alerted`),
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <DashboardLayout title="Attendance today" allowedRoles={CAN.viewAttendanceSummary}
      subtitle="Which sections are marked, and how many are present"
      actions={<>
        {can(role, 'lowAttendanceAlerts') && <button className="btn btn-secondary" disabled={alerts.isPending} title="Notify parents of students below the attendance threshold this month"
          onClick={() => alerts.mutate()}>Send low-attendance alerts</button>}
        <input type="date" className="input" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
      </>}>
      {isLoading || !data ? <Spinner /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat icon={ClipboardList} label="Sections marked" value={`${data.sectionsMarked}/${data.sectionsTotal}`} />
            <Stat icon={CheckCircle2} tone="good" label="Present (incl. late)" value={(data.total.PRESENT ?? 0) + (data.total.LATE ?? 0)}
              sub={data.total.percent !== null ? `${data.total.percent}%` : undefined} />
            <Stat icon={XCircle} tone="bad" label="Absent" value={data.total.ABSENT ?? 0} />
          </div>
          <div className="card">
            <div className="table-container">
              <table className="table">
                <thead><tr><th>Section</th><th>Class teacher</th><th>Strength</th><th>Present</th><th>Absent</th><th>Late</th><th>Leave</th><th>%</th><th /></tr></thead>
                <tbody>
                  {data.sections.map((s: any) => (
                    <tr key={s.sectionId}>
                      <td className="font-medium">{s.name}</td>
                      <td className="text-sm text-gray-600">{s.classTeacher ?? '—'}</td>
                      <td>{s.strength}</td>
                      {s.marked ? <>
                        <td>{s.PRESENT ?? 0}</td><td className={s.ABSENT ? 'text-red-600' : ''}>{s.ABSENT ?? 0}</td>
                        <td>{s.LATE ?? 0}</td><td>{s.LEAVE ?? 0}</td>
                        <td className={s.percent < 75 ? 'font-semibold text-amber-600' : ''}>{s.percent}%</td>
                      </> : <td colSpan={5}><span className="badge badge-yellow">Not marked</span></td>}
                      <td><Link className="text-sm text-primary-600 hover:underline" href={`/attendance?section=${s.sectionId}`}>{s.marked ? 'Open' : 'Mark'}</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </DashboardLayout>
  );
}
