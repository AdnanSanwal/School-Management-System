'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Save } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Spinner, Empty } from '@/components/ui/kit';
import { examsAPI, apiError } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { cn, formatDate } from '@/lib/utils';

type Task = { examId: string; exam: string; subjectId: string; subject: string; sectionId: string; section: string; date: string | null; totalMarks: number; students: number; entered: number };
type Entry = { obtained: string; isAbsent: boolean };

// Spec §8 Marks Entry: select exam + class + subject → enter marks → save (grades are automatic).
export default function MarksPage() {
  const { data: tasks = [], isLoading } = useQuery({ queryKey: ['marks-tasks'], queryFn: examsAPI.assignments });
  const [current, setCurrent] = useState<Task | null>(null);
  useEffect(() => { if (!current && tasks.length) setCurrent(tasks.find((t: Task) => t.entered < t.students) ?? tasks[0]); }, [tasks, current]);

  return (
    <DashboardLayout title="Marks entry" allowedRoles={CAN.enterMarks} subtitle="Papers you teach in exams that are open for marks">
      {isLoading ? <Spinner /> : tasks.length === 0 ? (
        <div className="card"><Empty title="Nothing to enter">Marks open once the principal approves an exam's schedule.</Empty></div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <ul className="card h-fit space-y-1 p-2">
            {tasks.map((t: Task) => {
              const key = `${t.examId}:${t.sectionId}:${t.subjectId}`;
              const active = current && key === `${current.examId}:${current.sectionId}:${current.subjectId}`;
              const done = t.entered >= t.students && t.students > 0;
              return (
                <li key={key}>
                  <button onClick={() => setCurrent(t)} className={cn('w-full rounded-xl px-3 py-2 text-left text-sm', active ? 'bg-primary-50 ring-1 ring-primary-200' : 'hover:bg-slate-50')}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{t.subject} · {t.section}</span>
                      <span className={cn('badge', done ? 'badge-green' : t.entered ? 'badge-yellow' : 'badge-gray')}>{t.entered}/{t.students}</span>
                    </div>
                    <p className="text-xs text-gray-500">{t.exam}{t.date ? ` · ${formatDate(t.date)}` : ''}</p>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="lg:col-span-2">{current && <Grid key={`${current.examId}:${current.sectionId}:${current.subjectId}`} task={current} />}</div>
        </div>
      )}
    </DashboardLayout>
  );
}

function Grid({ task }: { task: Task }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['marks', task.examId, task.sectionId, task.subjectId], queryFn: () => examsAPI.marks(task.examId, task.sectionId, task.subjectId) });
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  useEffect(() => {
    if (q.data) setEntries(Object.fromEntries(q.data.students.map((s: any) => [s.id, { obtained: s.obtained === null ? '' : String(s.obtained), isAbsent: s.isAbsent }])));
  }, [q.data]);

  const total = q.data?.paper.totalMarks ?? task.totalMarks;
  const invalid = Object.values(entries).some((e) => !e.isAbsent && e.obtained !== '' && (Number(e.obtained) < 0 || Number(e.obtained) > total || Number.isNaN(Number(e.obtained))));
  const save = useMutation({
    mutationFn: () => examsAPI.saveMarks(task.examId, {
      sectionId: task.sectionId, subjectId: task.subjectId,
      records: Object.entries(entries).map(([studentId, e]) => ({ studentId, isAbsent: e.isAbsent, obtained: e.isAbsent || e.obtained === '' ? null : Number(e.obtained) })),
    }),
    onSuccess: (r: any) => { toast.success(`Saved ${r.saved} marks`); qc.invalidateQueries({ queryKey: ['marks-tasks'] }); qc.invalidateQueries({ queryKey: ['marks', task.examId, task.sectionId, task.subjectId] }); },
    onError: (e) => toast.error(apiError(e)),
  });

  if (q.isLoading) return <div className="card"><Spinner /></div>;
  if (q.error) return <div className="card text-sm text-red-600">{apiError(q.error)}</div>;
  const d = q.data;
  const locked = d.locked;

  return (
    <form className="card space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="section-title">{d.paper.subject} · {task.section}</h3>
          <p className="text-xs text-gray-500">{d.exam.name} · out of {d.paper.totalMarks}, pass {d.paper.passingMarks}</p>
        </div>
        {!locked && <button className="btn btn-primary" disabled={save.isPending || invalid}><Save className="h-4 w-4" /> Save marks</button>}
      </div>
      {locked && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Marks are locked — results have been published.</p>}
      <div className="table-container">
        <table className="table">
          <thead><tr><th>#</th><th>Student</th><th>Marks</th><th>Absent</th></tr></thead>
          <tbody>
            {d.students.map((s: any, i: number) => {
              const e = entries[s.id] ?? { obtained: '', isAbsent: false };
              const n = Number(e.obtained);
              const bad = !e.isAbsent && e.obtained !== '' && (Number.isNaN(n) || n < 0 || n > total);
              const failing = !e.isAbsent && e.obtained !== '' && !bad && n < d.paper.passingMarks;
              return (
                <tr key={s.id}>
                  <td className="text-gray-400">{s.rollNo ?? i + 1}</td>
                  <td className="font-medium">{s.name}</td>
                  <td>
                    <input type="number" inputMode="decimal" min="0" max={total} step="0.25" disabled={locked || e.isAbsent}
                      className={cn('input w-24', bad && 'input-error', failing && 'text-red-600')} value={e.isAbsent ? '' : e.obtained}
                      onChange={(ev) => setEntries({ ...entries, [s.id]: { ...e, obtained: ev.target.value } })}
                      aria-label={`Marks for ${s.name}`} aria-invalid={bad} />
                  </td>
                  <td><input type="checkbox" disabled={locked} checked={e.isAbsent} onChange={(ev) => setEntries({ ...entries, [s.id]: { obtained: '', isAbsent: ev.target.checked } })} aria-label={`${s.name} absent`} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {invalid && <p className="text-sm text-red-600">Marks must be between 0 and {total}.</p>}
    </form>
  );
}
