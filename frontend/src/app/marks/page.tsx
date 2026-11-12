'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, BookOpen, CalendarDays, Info, RefreshCw, Trophy, Users } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Empty, Spinner } from '@/components/ui/kit';
import { MarkSheet, type SheetTab } from '@/components/marks/MarkSheet';
import { apiError, examsAPI } from '@/lib/api';
import { EXAM_STATUS } from '@/lib/exams';
import { marksAPI, type MarksOptions } from '@/lib/marksApi';
import { CAN } from '@/lib/roles';
import { cn } from '@/lib/utils';

type Task = { examId: string; exam: string; subjectId: string; subject: string; sectionId: string; section: string; totalMarks: number; students: number; entered: number };
type Loaded = { examId: string; sectionId: string };

/** Filter select with a leading icon, as in the CR-07 design. */
function FilterSelect({ label, icon: Icon, value, onChange, children, disabled }: {
  label: string; icon: React.ElementType; value: string; onChange: (v: string) => void; children: React.ReactNode; disabled?: boolean;
}) {
  return (
    <label className="block min-w-0">
      <span className="label">{label}</span>
      <span className="relative block">
        <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary-600" />
        <select className="select pl-9" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-label={label}>
          {children}
        </select>
      </span>
    </label>
  );
}

// CR-07 Marks entry dashboard: Academic year → exam → class → section → load the whole sheet.
export default function MarksPage() {
  const qc = useQueryClient();
  const [yearId, setYearId] = useState('');
  const [examId, setExamId] = useState('');
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [tab, setTab] = useState<SheetTab>('enter');
  const dirtyRef = useRef(false);
  const onDirty = useCallback((d: boolean) => { dirtyRef.current = d; }, []);

  const opts = useQuery({ queryKey: ['marks-options', yearId], queryFn: () => marksAPI.options(yearId || undefined) });
  const o: MarksOptions | undefined = opts.data;

  // Effective selections: fall back to the first sensible choice so the filters are never empty.
  const year = yearId || o?.academicYearId || '';
  const exams = useMemo(() => o?.exams ?? [], [o]);
  const exam = exams.find((e) => e.id === examId) ?? exams.find((e) => e.status === 'SCHEDULED') ?? exams[0];
  const cls = exam?.classes.find((c) => c.id === classId) ?? exam?.classes[0];
  const section = cls?.sections.find((s) => s.id === sectionId) ?? cls?.sections[0];

  const tasks = useQuery({ queryKey: ['marks-tasks'], queryFn: examsAPI.assignments, enabled: !!o && !o.canManage });

  const sheet = useQuery({
    queryKey: ['mark-sheet', loaded?.examId, loaded?.sectionId],
    queryFn: () => marksAPI.sheet(loaded!.examId, loaded!.sectionId),
    enabled: !!loaded,
    staleTime: Infinity, // never refetch behind the user's back: that would drop unsaved marks
    retry: false,
  });

  const confirmDiscard = () => !dirtyRef.current || window.confirm('You have unsaved marks. Discard them?');

  function load(next?: Loaded) {
    const target = next ?? (exam && section ? { examId: exam.id, sectionId: section.id } : null);
    if (!target || !confirmDiscard()) return;
    dirtyRef.current = false;
    const key = ['mark-sheet', target.examId, target.sectionId];
    // Always show what is on the server now: refetch the open sheet, drop a cached older copy.
    if (loaded && loaded.examId === target.examId && loaded.sectionId === target.sectionId) qc.invalidateQueries({ queryKey: key });
    else qc.removeQueries({ queryKey: key, exact: true });
    setLoaded(target);
  }

  function pickTask(t: Task) {
    const c = o?.exams.find((e) => e.id === t.examId)?.classes.find((x) => x.sections.some((s) => s.id === t.sectionId));
    setExamId(t.examId);
    if (c) setClassId(c.id);
    setSectionId(t.sectionId);
    load({ examId: t.examId, sectionId: t.sectionId });
  }

  const onSaved = () => {
    dirtyRef.current = false;
    qc.invalidateQueries({ queryKey: ['mark-sheet', loaded?.examId, loaded?.sectionId] });
    qc.invalidateQueries({ queryKey: ['marks-options'] });
    qc.invalidateQueries({ queryKey: ['marks-tasks'] });
  };

  // Teacher's quick list: one chip per exam × section they teach in (open exams, this year).
  const myPapers = useMemo(() => {
    const m = new Map<string, Task & { subjects: string[]; done: number; total: number }>();
    for (const t of (tasks.data ?? []) as Task[]) {
      const k = `${t.examId}:${t.sectionId}`;
      const cur = m.get(k) ?? { ...t, subjects: [], done: 0, total: 0 };
      cur.subjects.push(t.subject);
      cur.done += Math.min(t.entered, t.students);
      cur.total += t.students;
      m.set(k, cur);
    }
    return [...m.values()];
  }, [tasks.data]);

  const d = sheet.data;
  const examStatus = d ? EXAM_STATUS[d.exam.status] : null;

  return (
    <DashboardLayout
      title="Marks Entry" allowedRoles={CAN.enterMarks} subtitle="Enter and manage marks for students"
      actions={<Link href="/exams" className="btn-secondary"><BarChart3 className="h-4 w-4" /> View Reports</Link>}
    >
      <div className="space-y-4">
        {/* Filters */}
        <div className="card space-y-4 p-4 sm:p-5">
          {opts.isLoading ? <Spinner /> : opts.error ? (
            <p className="text-sm text-red-600">{apiError(opts.error, 'Could not load exams')}</p>
          ) : (
            <>
              <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1.2fr_1fr_1fr_auto]">
                <FilterSelect label="Academic Year" icon={CalendarDays} value={year}
                  onChange={(v) => { setYearId(v); setExamId(''); setClassId(''); setSectionId(''); }}>
                  {(o?.years ?? []).map((y) => <option key={y.id} value={y.id}>{y.name}{y.isCurrent ? ' (current)' : ''}</option>)}
                </FilterSelect>
                <FilterSelect label="Exam Type" icon={Trophy} value={exam?.id ?? ''} disabled={!exams.length}
                  onChange={(v) => { setExamId(v); setClassId(''); setSectionId(''); }}>
                  {!exams.length && <option value="">No exams</option>}
                  {exams.map((e) => <option key={e.id} value={e.id}>{e.name}{e.status !== 'SCHEDULED' ? ` · ${EXAM_STATUS[e.status]?.label ?? e.status}` : ''}</option>)}
                </FilterSelect>
                <FilterSelect label="Class" icon={BookOpen} value={cls?.id ?? ''} disabled={!exam?.classes.length}
                  onChange={(v) => { setClassId(v); setSectionId(''); }}>
                  {!exam?.classes.length && <option value="">No classes</option>}
                  {exam?.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </FilterSelect>
                <FilterSelect label="Section" icon={Users} value={section?.id ?? ''} disabled={!cls?.sections.length} onChange={setSectionId}>
                  {!cls?.sections.length && <option value="">No sections</option>}
                  {cls?.sections.map((s) => (
                    <option key={s.id} value={s.id}>Section {s.name}{s.sheetStatus === 'SUBMITTED' ? ' · submitted' : s.sheetStatus === 'DRAFT' ? ' · draft' : ''}</option>
                  ))}
                </FilterSelect>
                <button type="button" className="btn-primary" disabled={!section || sheet.isFetching} onClick={() => load()}>
                  <RefreshCw className={cn('h-4 w-4', sheet.isFetching && 'animate-spin')} /> Load Students
                </button>
              </div>
              {!exams.length && (
                <p className="text-sm text-gray-500">
                  {o?.canManage ? 'No exams in this academic year yet. Create one under Exams & results.' : 'No exams with papers you teach in this academic year. Marks open once the principal approves an exam’s schedule.'}
                </p>
              )}

              {d && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-primary-50/70 px-4 py-3 text-sm text-gray-700">
                  <Info className="h-4 w-4 text-primary-600" />
                  <span>Total Students: <b>{d.students.length}</b></span>
                  <span className="text-gray-300">|</span>
                  <span>Class: <b>{d.section.className}</b></span>
                  <span className="text-gray-300">|</span>
                  <span>Section: <b>{d.section.name}</b></span>
                  <span className="text-gray-300">|</span>
                  <span>{d.exam.name} · {d.exam.academicYear}</span>
                  <span className="ml-auto flex gap-2">
                    {examStatus && <span className={cn('badge', examStatus.cls)}>{examStatus.label}</span>}
                    <span className={cn('badge', d.sheet.status === 'SUBMITTED' ? 'badge-green' : 'badge-gray')}>{d.sheet.status === 'SUBMITTED' ? 'Submitted' : 'Draft'}</span>
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Teacher's papers (the old to-do list) */}
        {o && !o.canManage && myPapers.length > 0 && (
          <div className="card p-4">
            <p className="mb-2 text-sm font-medium text-gray-700">Papers you teach in exams open for marks</p>
            <div className="flex flex-wrap gap-2">
              {myPapers.map((t) => {
                const active = loaded?.examId === t.examId && loaded?.sectionId === t.sectionId;
                const done = t.total > 0 && t.done >= t.total;
                return (
                  <button key={`${t.examId}:${t.sectionId}`} type="button" onClick={() => pickTask(t)}
                    className={cn('rounded-xl border px-3 py-2 text-left text-sm transition', active ? 'border-primary-300 bg-primary-50' : 'border-gray-200 hover:bg-slate-50')}>
                    <span className="font-medium">{t.section}</span> <span className="text-gray-500">· {t.exam}</span>
                    <span className="ml-2 inline-flex items-center gap-1">
                      <span className="text-xs text-gray-500">{t.subjects.join(', ')}</span>
                      <span className={cn('badge', done ? 'badge-green' : t.done ? 'badge-yellow' : 'badge-gray')}>{t.done}/{t.total}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Sheet */}
        {!loaded ? (
          <div className="card"><Empty title="Choose an exam, class and section">Then press <b>Load Students</b> to enter marks for every subject at once.</Empty></div>
        ) : sheet.isLoading ? (
          <div className="card"><Spinner label="Loading students…" /></div>
        ) : sheet.error ? (
          <div className="card text-sm text-red-600">{apiError(sheet.error, 'Could not load the marks sheet')}</div>
        ) : d ? (
          <MarkSheet
            key={`${loaded.examId}:${loaded.sectionId}:${sheet.dataUpdatedAt}`}
            data={d} canManage={!!o?.canManage} tab={tab} onTab={setTab} onSaved={onSaved} onDirty={onDirty}
          />
        ) : null}
      </div>
    </DashboardLayout>
  );
}
