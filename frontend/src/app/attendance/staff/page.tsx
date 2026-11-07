'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { CheckCheck, Save } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Spinner, Empty, StatusBadge } from '@/components/ui/kit';
import { attendanceAPI, apiError } from '@/lib/api';
import { CAN, can } from '@/lib/roles';
import { cn, todayIso } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';

const STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'LEAVE', 'HALF_DAY'] as const;

export default function StaffAttendancePage() {
  const role = useAuthStore((s) => s.user?.role);
  const editable = can(role, 'markStaffAttendance');
  const [date, setDate] = useState(todayIso());
  const [marks, setMarks] = useState<Record<string, string>>({});
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['staff-att', date], queryFn: () => attendanceAPI.staff(date) });

  useEffect(() => {
    if (!data) return;
    // Pre-fill approved leave so the office doesn't mark those people absent.
    setMarks(Object.fromEntries(data.staff.map((s: any) => [s.id, s.status ?? (s.approvedLeave ? 'LEAVE' : '')]).filter(([, v]: any) => v)));
  }, [data]);

  const save = useMutation({
    mutationFn: () => attendanceAPI.markStaff({ date, records: Object.entries(marks).map(([staffId, status]) => ({ staffId, status })) }),
    onSuccess: (r: any) => { toast.success(`Saved ${r.saved} staff`); qc.invalidateQueries({ queryKey: ['staff-att', date] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); },
    onError: (e) => toast.error(apiError(e)),
  });
  const staff: any[] = data?.staff ?? [];

  return (
    <DashboardLayout title="Staff attendance" allowedRoles={CAN.staffAttendance}
      actions={<>
        <input type="date" className="input" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
        {editable && <>
          <button className="btn btn-secondary" onClick={() => setMarks(Object.fromEntries(staff.map((s) => [s.id, marks[s.id] === 'LEAVE' ? 'LEAVE' : 'PRESENT'])))}>
            <CheckCheck className="h-4 w-4" /> All present
          </button>
          <button className="btn btn-primary" disabled={save.isPending || !Object.keys(marks).length} onClick={() => save.mutate()}><Save className="h-4 w-4" /> Save</button>
        </>}
      </>}>
      <div className="card">
        {isLoading ? <Spinner /> : staff.length === 0 ? <Empty title="No active staff" /> : (
          <ul className="divide-y divide-slate-100">
            {staff.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div>
                  <p className="text-sm font-medium">{s.name} {s.approvedLeave && <span className="badge badge-blue ml-1">approved leave</span>}</p>
                  <p className="text-xs text-gray-400">{s.employeeNo} · {s.designation ?? (s.isTeacher ? 'Teacher' : 'Staff')}</p>
                </div>
                {editable ? (
                  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`Attendance for ${s.name}`}>
                    {STATUSES.map((st) => (
                      <button key={st} type="button" role="radio" aria-checked={marks[s.id] === st} onClick={() => setMarks({ ...marks, [s.id]: st })}
                        className={cn('h-8 rounded-lg border px-2.5 text-xs font-medium',
                          marks[s.id] === st ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-200 text-slate-500 hover:bg-slate-50')}>
                        {st.replace('_', ' ').toLowerCase()}
                      </button>
                    ))}
                  </div>
                ) : s.status ? <StatusBadge status={s.status} /> : <span className="text-xs text-gray-400">Not marked</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </DashboardLayout>
  );
}
