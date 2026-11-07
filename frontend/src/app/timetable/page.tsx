'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Save, Trash2 } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Spinner, Empty, useSections } from '@/components/ui/kit';
import { timetableAPI, academicsAPI, staffAPI, apiError } from '@/lib/api';
import { CAN, can } from '@/lib/roles';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] as const;
const short = (d: string) => d.slice(0, 1) + d.slice(1, 3).toLowerCase();

type Period = { period: number; startTime: string; endTime: string };
type Cell = { subjectId: string; teacherId: string; room: string };

export default function TimetablePage() {
  const role = useAuthStore((s) => s.user?.role);
  const manage = can(role, 'manageTimetable');
  // The role loads from storage after the first render, so derive the default instead of fixing it in useState.
  const [chosen, setView] = useState<'section' | 'mine' | null>(null);
  const view = chosen ?? (role === 'TEACHER' ? 'mine' : 'section');
  const { data: sections = [] } = useSections();
  const [sectionId, setSectionId] = useState('');
  useEffect(() => { if (!sectionId && sections.length) setSectionId(sections[0].id); }, [sections, sectionId]);

  return (
    <DashboardLayout title="Timetable" allowedRoles={CAN.viewTimetable}
      actions={<>
        {role === 'TEACHER' && (
          <div className="flex gap-1" role="tablist">
            <button role="tab" aria-selected={view === 'mine'} className={cn('btn', view === 'mine' ? 'btn-primary' : 'btn-ghost')} onClick={() => setView('mine')}>My week</button>
            <button role="tab" aria-selected={view === 'section'} className={cn('btn', view === 'section' ? 'btn-primary' : 'btn-ghost')} onClick={() => setView('section')}>By class</button>
          </div>
        )}
        {view === 'section' && (
          <select className="select w-44" value={sectionId} onChange={(e) => setSectionId(e.target.value)} aria-label="Section">
            {sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        )}
      </>}>
      {view === 'mine' ? <TeacherWeek /> : sectionId && (manage ? <Editor key={sectionId} sectionId={sectionId} /> : <SectionWeek sectionId={sectionId} />)}
    </DashboardLayout>
  );
}

function Grid({ slots, show }: { slots: any[]; show: 'teacher' | 'section' }) {
  const periods = [...new Map(slots.map((s) => [s.period, { period: s.period, startTime: s.startTime, endTime: s.endTime }])).values()].sort((a, b) => a.period - b.period);
  const days = DAYS.filter((d) => d !== 'SATURDAY' || slots.some((s) => s.dayOfWeek === 'SATURDAY'));
  if (!slots.length) return <div className="card"><Empty title="No timetable yet" /></div>;
  return (
    <div className="card table-container">
      <table className="table">
        <thead><tr><th>Period</th>{days.map((d) => <th key={d}>{short(d)}</th>)}</tr></thead>
        <tbody>
          {periods.map((p) => (
            <tr key={p.period}>
              <td className="whitespace-nowrap text-sm"><b>{p.period}</b> <span className="text-gray-400">{p.startTime}–{p.endTime}</span></td>
              {days.map((d) => {
                const s = slots.find((x) => x.dayOfWeek === d && x.period === p.period);
                return (
                  <td key={d} className="text-sm">
                    {s ? <><p className="font-medium">{s.subject.name}</p><p className="text-xs text-gray-500">{show === 'teacher' ? s.teacher.name : s.section.name}{s.room ? ` · ${s.room}` : ''}</p></> : <span className="text-gray-300">—</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TeacherWeek() {
  const q = useQuery({ queryKey: ['timetable', 'me'], queryFn: () => timetableAPI.teacher('me') });
  return q.isLoading ? <Spinner /> : <Grid slots={q.data ?? []} show="section" />;
}

function SectionWeek({ sectionId }: { sectionId: string }) {
  const q = useQuery({ queryKey: ['timetable', sectionId], queryFn: () => timetableAPI.section(sectionId) });
  return q.isLoading ? <Spinner /> : <Grid slots={q.data ?? []} show="teacher" />;
}

const DEFAULT_PERIODS: Period[] = Array.from({ length: 6 }, (_, i) => {
  const start = 8 * 60 + i * 45;
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return { period: i + 1, startTime: fmt(start), endTime: fmt(start + 40) };
});

function Editor({ sectionId }: { sectionId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['timetable', sectionId], queryFn: () => timetableAPI.section(sectionId) });
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: academicsAPI.subjects });
  const teachers = useQuery({ queryKey: ['teachers'], queryFn: () => staffAPI.list({ teachers: 'true', limit: 200 }) });
  // When each teacher is already in another class, and who teaches each subject in this section.
  const busy = useQuery({ queryKey: ['timetable-busy', sectionId], queryFn: () => timetableAPI.busy(sectionId) });
  const assigned = useQuery({ queryKey: ['section-subjects', sectionId], queryFn: () => academicsAPI.sectionSubjects(sectionId) });
  const [periods, setPeriods] = useState<Period[]>([]);
  const [cells, setCells] = useState<Record<string, Cell>>({});
  const [saturday, setSaturday] = useState(false);

  useEffect(() => {
    if (!q.data) return;
    const ps = [...new Map(q.data.map((s: any) => [s.period, { period: s.period, startTime: s.startTime, endTime: s.endTime }])).values()] as Period[];
    setPeriods(ps.length ? ps.sort((a, b) => a.period - b.period) : DEFAULT_PERIODS);
    setCells(Object.fromEntries(q.data.map((s: any) => [`${s.dayOfWeek}:${s.period}`, { subjectId: s.subject.id, teacherId: s.teacher.id, room: s.room ?? '' }])));
    setSaturday(q.data.some((s: any) => s.dayOfWeek === 'SATURDAY'));
  }, [q.data]);

  const days = DAYS.filter((d) => d !== 'SATURDAY' || saturday);
  const slots = useMemo(() => Object.entries(cells).flatMap(([k, c]) => {
    const [dayOfWeek, p] = k.split(':');
    const per = periods.find((x) => x.period === Number(p));
    if (!per || !c.subjectId || !c.teacherId || !days.includes(dayOfWeek as any)) return [];
    return [{ dayOfWeek, period: per.period, startTime: per.startTime, endTime: per.endTime, subjectId: c.subjectId, teacherId: c.teacherId, room: c.room || null }];
  }), [cells, periods, days]);

  const save = useMutation({
    mutationFn: () => timetableAPI.save(sectionId, slots),
    onSuccess: () => { toast.success('Timetable saved'); qc.invalidateQueries({ queryKey: ['timetable'] }); qc.invalidateQueries({ queryKey: ['timetable-busy'] }); },
    onError: (e) => toast.error(apiError(e), { duration: 6000 }),
  });
  const setCell = (k: string, patch: Partial<Cell>) => setCells((all) => ({ ...all, [k]: { ...(all[k] ?? { subjectId: '', teacherId: '', room: '' }), ...patch } }));
  const teacherList: any[] = teachers.data?.data ?? [];
  const nameOf = (id: string) => teacherList.find((t) => t.id === id)?.name ?? 'This teacher';

  /** The other class a teacher is in at this day/period, or null when free. */
  const busyIn = (teacherId: string, day: string, per?: Period) => {
    if (!teacherId || !per) return null;
    const hit = (busy.data ?? []).find((b) => b.teacherId === teacherId && b.dayOfWeek === day && b.startTime < per.endTime && per.startTime < b.endTime);
    return hit ? `${hit.section} ${hit.startTime}–${hit.endTime}` : null;
  };

  const pickSubject = (k: string, day: string, per: Period, subjectId: string) => {
    const current = cells[k]?.teacherId ?? '';
    // Pre-fill this section's subject teacher when they're free; keep a manual choice otherwise.
    const usual = (assigned.data ?? []).find((a: any) => a.subjectId === subjectId)?.teacherId as string | undefined;
    let teacherId = current;
    if (!subjectId) teacherId = '';
    else if (usual && usual !== current) {
      const clash = busyIn(usual, day, per);
      if (clash) toast(`${nameOf(usual)} usually teaches this subject but is in ${clash}. Pick another teacher.`, { icon: '⚠️' });
      else teacherId = usual;
    }
    setCell(k, { subjectId, teacherId });
  };

  // Changing a period's time can make a chosen teacher clash with another class: clear them and say why.
  useEffect(() => {
    if (!busy.data || !teacherList.length) return;
    const cleared: string[] = [];
    const next = { ...cells };
    for (const [k, c] of Object.entries(cells)) {
      const [day, p] = k.split(':');
      const clash = busyIn(c.teacherId, day, periods.find((x) => x.period === Number(p)));
      if (clash) { next[k] = { ...c, teacherId: '' }; cleared.push(`${nameOf(c.teacherId)} (${short(day)} period ${p}, in ${clash})`); }
    }
    if (cleared.length) {
      setCells(next);
      toast(`Removed teacher${cleared.length > 1 ? 's' : ''} already in another class: ${cleared.slice(0, 3).join('; ')}${cleared.length > 3 ? '…' : ''}`, { icon: '⚠️', duration: 7000 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-check only when times or bookings change
  }, [periods, busy.data, teacherList.length]);

  if (q.isLoading) return <Spinner />;
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={saturday} onChange={(e) => setSaturday(e.target.checked)} /> Saturday is a school day</label>
        <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}><Save className="h-4 w-4" /> Save timetable</button>
      </div>
      <p className="text-xs text-gray-500">Teachers already teaching another class at that time are greyed out. The section’s subject teacher is filled in automatically when free.</p>
      <div className="table-container">
        <table className="table">
          <thead><tr><th>Period</th>{days.map((d) => <th key={d}>{short(d)}</th>)}</tr></thead>
          <tbody>
            {periods.map((p, i) => (
              <tr key={p.period}>
                <td className="min-w-[150px] align-top">
                  <div className="flex items-center gap-1">
                    <b className="w-4">{p.period}</b>
                    <input type="time" className="input w-[90px] px-1 py-1 text-xs" value={p.startTime} onChange={(e) => setPeriods(periods.map((x, j) => (j === i ? { ...x, startTime: e.target.value } : x)))} aria-label={`Period ${p.period} start`} />
                    <input type="time" className="input w-[90px] px-1 py-1 text-xs" value={p.endTime} onChange={(e) => setPeriods(periods.map((x, j) => (j === i ? { ...x, endTime: e.target.value } : x)))} aria-label={`Period ${p.period} end`} />
                    {i === periods.length - 1 && periods.length > 1 && (
                      <button className="btn-icon btn-ghost h-7 w-7 text-red-500" aria-label="Remove last period" onClick={() => setPeriods(periods.slice(0, -1))}><Trash2 className="h-3.5 w-3.5" /></button>
                    )}
                  </div>
                </td>
                {days.map((d) => {
                  const k = `${d}:${p.period}`;
                  const c = cells[k] ?? { subjectId: '', teacherId: '', room: '' };
                  return (
                    <td key={d} className={cn('min-w-[140px] space-y-1 align-top', c.subjectId && 'bg-primary-50/40')}>
                      <select className="select h-8 py-0 text-xs" value={c.subjectId} onChange={(e) => pickSubject(k, d, p, e.target.value)} aria-label={`${short(d)} period ${p.period} subject`}>
                        <option value="">—</option>
                        {(subjects.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                      {c.subjectId && (
                        <select className={cn('select h-8 py-0 text-xs', !c.teacherId && 'border-amber-300')} value={c.teacherId} onChange={(e) => setCell(k, { teacherId: e.target.value })} aria-label={`${short(d)} period ${p.period} teacher`}>
                          <option value="">Teacher…</option>
                          {teacherList.map((t) => {
                            const clash = busyIn(t.id, d, p);
                            return <option key={t.id} value={t.id} disabled={!!clash}>{t.name}{clash ? ` — busy (${clash})` : ''}</option>;
                          })}
                        </select>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn btn-ghost" onClick={() => {
        const last = periods[periods.length - 1];
        const [h, m] = (last?.endTime ?? '07:55').split(':').map(Number);
        const start = h * 60 + m + 5;
        const fmt = (x: number) => `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
        setPeriods([...periods, { period: (last?.period ?? 0) + 1, startTime: fmt(start), endTime: fmt(start + 40) }]);
      }}><Plus className="h-4 w-4" /> Add period</button>
    </div>
  );
}
