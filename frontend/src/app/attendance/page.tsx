'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { CheckCheck, Save } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Spinner, Empty, useSections } from '@/components/ui/kit';
import { attendanceAPI, apiError } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { cn, todayIso } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';

const STATUSES = [
  { key: 'PRESENT', short: 'P', label: 'Present', on: 'bg-emerald-600 text-white border-emerald-600' },
  { key: 'ABSENT', short: 'A', label: 'Absent', on: 'bg-red-600 text-white border-red-600' },
  { key: 'LATE', short: 'L', label: 'Late', on: 'bg-amber-500 text-white border-amber-500' },
  { key: 'LEAVE', short: 'Lv', label: 'Leave', on: 'bg-blue-600 text-white border-blue-600' },
] as const;

export default function MarkAttendancePage() {
  return <Suspense><MarkAttendance /></Suspense>;
}

function MarkAttendance() {
  const role = useAuthStore((s) => s.user?.role);
  const params = useSearchParams();
  const { data: sections = [], isLoading: loadingSections } = useSections();
  const [sectionId, setSectionId] = useState(params.get('section') ?? '');
  const [date, setDate] = useState(todayIso());
  const [marks, setMarks] = useState<Record<string, string>>({});
  const canCorrect = role === 'ADMIN' || role === 'PRINCIPAL';
  const qc = useQueryClient();

  useEffect(() => { if (!sectionId && sections.length) setSectionId(sections[0].id); }, [sections, sectionId]);

  const { data: roster, isLoading } = useQuery({
    queryKey: ['roster', sectionId, date],
    queryFn: () => attendanceAPI.roster(sectionId, date),
    enabled: !!sectionId,
  });

  useEffect(() => {
    if (roster) setMarks(Object.fromEntries(roster.students.filter((s: any) => s.status).map((s: any) => [s.id, s.status])));
  }, [roster]);

  const students: any[] = roster?.students ?? [];
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const v of Object.values(marks)) c[v] = (c[v] ?? 0) + 1;
    return c;
  }, [marks]);
  const unmarked = students.length - Object.keys(marks).length;

  const save = useMutation({
    mutationFn: () => attendanceAPI.mark({
      sectionId, date, records: students.filter((s) => marks[s.id]).map((s) => ({ studentId: s.id, status: marks[s.id] })),
    }),
    onSuccess: (r: any) => {
      toast.success(`Saved ${r.saved} students${r.parentsNotified ? ` · ${r.parentsNotified} parent(s) notified` : ''}`);
      qc.invalidateQueries({ queryKey: ['roster', sectionId, date] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <DashboardLayout title="Mark attendance" allowedRoles={CAN.markAttendance} subtitle="Tap a status for each student, then save">
      <div className="card space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="label">Section</span>
            <select className="select w-48" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
              {sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label">Date</span>
            <input type="date" className="input" value={date} max={todayIso()} disabled={!canCorrect}
              onChange={(e) => setDate(e.target.value)} title={canCorrect ? undefined : 'Teachers mark today only'} />
          </label>
          <div className="flex-1" />
          <button className="btn btn-secondary" onClick={() => setMarks(Object.fromEntries(students.map((s) => [s.id, 'PRESENT'])))} disabled={!students.length}>
            <CheckCheck className="h-4 w-4" /> All present
          </button>
          <button className="btn btn-primary" onClick={() => save.mutate()} disabled={save.isPending || !Object.keys(marks).length}>
            <Save className="h-4 w-4" /> {save.isPending ? 'Saving…' : roster?.marked ? 'Update' : 'Save'}
          </button>
        </div>

        {roster?.holiday && <div className="rounded-xl bg-blue-50 p-3 text-sm text-blue-800">{roster.holiday} — this day is a holiday.</div>}

        {students.length > 0 && (
          <p className="text-sm text-gray-500" aria-live="polite">
            {STATUSES.map((s) => `${s.label} ${counts[s.key] ?? 0}`).join(' · ')}
            {unmarked > 0 && <span className="font-medium text-amber-600"> · {unmarked} not marked</span>}
          </p>
        )}

        {loadingSections || isLoading ? <Spinner /> : !sections.length ? (
          <Empty title="No sections assigned">Ask the office to assign you as class or subject teacher.</Empty>
        ) : students.length === 0 ? <Empty title="No active students in this section" /> : (
          <ul className="divide-y divide-slate-100">
            {students.map((s, i) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="flex items-center gap-3">
                  <span className="w-6 text-right text-xs text-gray-400">{s.rollNo ?? i + 1}</span>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{s.name}</p>
                    <p className="text-xs text-gray-400">{s.admissionNo}</p>
                  </div>
                </div>
                <div className="flex gap-1.5" role="radiogroup" aria-label={`Attendance for ${s.name}`}>
                  {STATUSES.map((st) => (
                    <button key={st.key} type="button" role="radio" aria-checked={marks[s.id] === st.key} title={st.label}
                      onClick={() => setMarks({ ...marks, [s.id]: st.key })}
                      className={cn('h-9 min-w-[40px] rounded-lg border px-2 text-sm font-semibold transition-colors',
                        marks[s.id] === st.key ? st.on : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50')}>
                      {st.short}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </DashboardLayout>
  );
}
