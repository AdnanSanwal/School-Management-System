'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { CheckCircle2, Send, EyeOff, Trash2, Plus, FileDown, Save } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Spinner, Empty, Stat, useSections } from '@/components/ui/kit';
import { examsAPI, academicsAPI, apiError } from '@/lib/api';
import { CAN, can } from '@/lib/roles';
import { cn, formatDate } from '@/lib/utils';
import { EXAM_STATUS, openReportCard } from '@/lib/exams';
import { useAuthStore } from '@/store/authStore';

type Tab = 'datesheet' | 'results' | 'analysis';

export default function ExamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const role = useAuthStore((s) => s.user?.role);
  const qc = useQueryClient();
  const { data: exam, isLoading, error } = useQuery({ queryKey: ['exam', id], queryFn: () => examsAPI.get(id) });
  const [tab, setTab] = useState<Tab>('datesheet');
  const refresh = () => { qc.invalidateQueries({ queryKey: ['exam', id] }); qc.invalidateQueries({ queryKey: ['exams'] }); };

  const action = useMutation({
    mutationFn: async (a: 'approve' | 'publish' | 'unpublish' | 'delete') => {
      if (a === 'delete') { await examsAPI.remove(id); return { message: 'Exam deleted' }; }
      const r: any = await examsAPI[a](id);
      return { message: a === 'publish' ? `Results published — ${r?.notified ?? 0} families notified` : a === 'approve' ? 'Schedule approved' : 'Results hidden for corrections' };
    },
    onSuccess: (r, a) => { toast.success(r.message); if (a === 'delete') router.push('/exams'); else refresh(); },
    onError: (e) => toast.error(apiError(e)),
  });

  const approver = can(role, 'approveExams');
  const manage = can(role, 'manageExams');

  return (
    <DashboardLayout title={exam?.name ?? 'Exam'} allowedRoles={CAN.viewExams}
      subtitle={exam ? `${exam.academicYear.name}${exam.startDate ? ` · ${formatDate(exam.startDate)}${exam.endDate ? ` – ${formatDate(exam.endDate)}` : ''}` : ''}` : undefined}
      actions={exam && <>
        <span className={`badge ${EXAM_STATUS[exam.status].cls}`}>{EXAM_STATUS[exam.status].label}</span>
        {approver && exam.status === 'DRAFT' && <button className="btn btn-primary" disabled={action.isPending} onClick={() => action.mutate('approve')}><CheckCircle2 className="h-4 w-4" /> Approve schedule</button>}
        {approver && exam.status === 'SCHEDULED' && <button className="btn btn-primary" disabled={action.isPending}
          onClick={() => confirm('Publish results? Parents will be notified and marks will be locked.') && action.mutate('publish')}><Send className="h-4 w-4" /> Publish results</button>}
        {approver && exam.status === 'PUBLISHED' && <button className="btn btn-secondary" disabled={action.isPending}
          onClick={() => confirm('Hide results from parents so marks can be corrected?') && action.mutate('unpublish')}><EyeOff className="h-4 w-4" /> Unpublish</button>}
        {manage && exam.status === 'DRAFT' && <button className="btn-icon btn-ghost text-red-500" aria-label="Delete exam" onClick={() => confirm('Delete this draft exam?') && action.mutate('delete')}><Trash2 className="h-4 w-4" /></button>}
      </>}>
      {isLoading && <Spinner />}
      {error && <div className="card text-sm text-red-600">{apiError(error)}</div>}
      {exam && (
        <>
          <div className="flex gap-2" role="tablist">
            {([['datesheet', 'Date sheet'], ['results', 'Results'], ['analysis', 'Analysis']] as const)
              .filter(([t]) => t !== 'analysis' || role !== 'TEACHER')
              .map(([t, label]) => (
                <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn('btn', tab === t ? 'btn-primary' : 'btn-ghost')}>{label}</button>
              ))}
          </div>
          {tab === 'datesheet' && <DateSheet exam={exam} editable={manage && exam.status !== 'PUBLISHED'} onSaved={refresh} />}
          {tab === 'results' && <Results exam={exam} />}
          {tab === 'analysis' && <Analysis exam={exam} />}
        </>
      )}
    </DashboardLayout>
  );
}

// ─── Date sheet ───

function DateSheet({ exam, editable, onSaved }: { exam: any; editable: boolean; onSaved: () => void }) {
  const classes = useQuery({ queryKey: ['classes'], queryFn: academicsAPI.classes, enabled: editable });
  const [adding, setAdding] = useState('');
  const inExam = new Set(exam.classes.map((c: any) => c.classId));
  const extra = (classes.data ?? []).filter((c: any) => !inExam.has(c.id) && c.id === adding);
  const list = [...exam.classes, ...extra.map((c: any) => ({ classId: c.id, name: c.name, students: c.strength, subjects: [] }))];

  return (
    <div className="space-y-4">
      {list.length === 0 && <div className="card"><Empty title="No classes in this exam yet">{editable ? 'Add a class below.' : ''}</Empty></div>}
      {list.map((c: any) => <ClassSheet key={c.classId} exam={exam} cls={c} editable={editable} onSaved={() => { setAdding(''); onSaved(); }} />)}
      {editable && (
        <div className="card flex flex-wrap items-center gap-2">
          <select className="select w-56" value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Add class">
            <option value="">Add a class to this exam…</option>
            {(classes.data ?? []).filter((c: any) => !inExam.has(c.id)).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <span className="text-xs text-gray-500">then add its subjects and save</span>
        </div>
      )}
    </div>
  );
}

type Row = { subjectId: string; date: string; totalMarks: string; passingMarks: string; syllabus: string; marksEntered?: number };

function ClassSheet({ exam, cls, editable, onSaved }: { exam: any; cls: any; editable: boolean; onSaved: () => void }) {
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: academicsAPI.subjects, enabled: editable });
  const initial = (): Row[] => cls.subjects.map((s: any) => ({
    subjectId: s.subjectId, date: s.date ?? '', totalMarks: String(s.totalMarks), passingMarks: String(s.passingMarks), syllabus: s.syllabus ?? '', marksEntered: s.marksEntered,
  }));
  const [rows, setRows] = useState<Row[]>(initial);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setRows(initial()), [cls]);
  const save = useMutation({
    mutationFn: () => examsAPI.saveDateSheet(exam.id, cls.classId, rows.map((r) => ({
      subjectId: r.subjectId, date: r.date || null, totalMarks: Number(r.totalMarks), passingMarks: Number(r.passingMarks), syllabus: r.syllabus || null,
    }))),
    onSuccess: () => { toast.success(`${cls.name} date sheet saved`); onSaved(); },
    onError: (e) => toast.error(apiError(e)),
  });
  const set = (i: number, k: keyof Row, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const name = (sid: string) => cls.subjects.find((s: any) => s.subjectId === sid)?.name ?? subjects.data?.find((s: any) => s.id === sid)?.name ?? '';
  const unused = (subjects.data ?? []).filter((s: any) => !rows.some((r) => r.subjectId === s.id));

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="section-title">{cls.name} <span className="text-sm font-normal text-gray-500">· {cls.students} students</span></h3>
        {editable && <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}><Save className="h-4 w-4" /> Save</button>}
      </div>
      <div className="table-container">
        <table className="table">
          <thead><tr><th>Subject</th><th>Date</th><th>Total</th><th>Pass</th><th>Syllabus</th><th>Marks in</th>{editable && <th />}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.subjectId}>
                <td className="font-medium">{name(r.subjectId)}</td>
                {editable ? <>
                  <td><input type="date" className="input w-40" value={r.date} onChange={(e) => set(i, 'date', e.target.value)} aria-label={`${name(r.subjectId)} date`} /></td>
                  <td><input type="number" min="1" className="input w-20" value={r.totalMarks} onChange={(e) => set(i, 'totalMarks', e.target.value)} aria-label="Total marks" /></td>
                  <td><input type="number" min="0" className="input w-20" value={r.passingMarks} onChange={(e) => set(i, 'passingMarks', e.target.value)} aria-label="Passing marks" /></td>
                  <td><input className="input" value={r.syllabus} onChange={(e) => set(i, 'syllabus', e.target.value)} placeholder="Ch 1–5" aria-label="Syllabus" /></td>
                </> : <>
                  <td className="text-sm">{r.date ? formatDate(r.date, { weekday: 'short', day: 'numeric', month: 'short' }) : '—'}</td>
                  <td>{r.totalMarks}</td><td>{r.passingMarks}</td><td className="text-sm text-gray-600">{r.syllabus || '—'}</td>
                </>}
                <td className="text-sm text-gray-500">{r.marksEntered ?? 0}/{cls.students}</td>
                {editable && <td>{!r.marksEntered && <button className="btn-icon btn-ghost text-red-500" aria-label="Remove subject" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable && unused.length > 0 && (
        <select className="select w-56" value="" aria-label="Add subject"
          onChange={(e) => e.target.value && setRows([...rows, { subjectId: e.target.value, date: '', totalMarks: '100', passingMarks: '40', syllabus: '' }])}>
          <option value="">+ Add subject…</option>
          {unused.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
    </div>
  );
}

// ─── Results ───

function Results({ exam }: { exam: any }) {
  const role = useAuthStore((s) => s.user?.role);
  const user = useAuthStore((s) => s.user);
  const { data: sections = [] } = useSections();
  const classIds = new Set(exam.classes.map((c: any) => c.classId));
  const mine = sections.filter((s) => classIds.has(s.classId));
  const [sectionId, setSectionId] = useState('');
  useEffect(() => { if (!sectionId && mine.length) setSectionId(mine[0].id); }, [mine, sectionId]);
  const q = useQuery({ queryKey: ['results', exam.id, sectionId], queryFn: () => examsAPI.results(exam.id, sectionId), enabled: !!sectionId });
  const section = mine.find((s) => s.id === sectionId);
  const canRemark = exam.status !== 'PUBLISHED' && (can(role, 'manageExams') || (role === 'TEACHER' && section?.classTeacher?.name === user?.name));
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  useEffect(() => { if (q.data) setRemarks(Object.fromEntries(q.data.students.map((s: any) => [s.student.id, s.remarks ?? '']))); }, [q.data]);
  const qc = useQueryClient();
  const saveRemarks = useMutation({
    mutationFn: () => examsAPI.saveRemarks(exam.id, sectionId, Object.entries(remarks).map(([studentId, r]) => ({ studentId, remarks: r }))),
    onSuccess: () => { toast.success('Remarks saved'); qc.invalidateQueries({ queryKey: ['results', exam.id, sectionId] }); },
    onError: (e) => toast.error(apiError(e)),
  });
  const pdf = async (studentId: string) => {
    try { await openReportCard(() => examsAPI.pdfLink(exam.id, studentId)); } catch (e) { toast.error(apiError(e)); }
  };

  if (!mine.length) return <div className="card"><Empty title="No sections to show" /></div>;
  const r = q.data;
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <select className="select w-48" value={sectionId} onChange={(e) => setSectionId(e.target.value)} aria-label="Section">
          {mine.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        {canRemark && <button className="btn btn-primary" disabled={saveRemarks.isPending} onClick={() => saveRemarks.mutate()}><Save className="h-4 w-4" /> Save remarks</button>}
      </div>
      {exam.status !== 'PUBLISHED' && <p className="text-xs text-gray-500">Preview — parents see results only after the principal publishes them.</p>}
      {q.isLoading ? <Spinner /> : r && (
        <div className="table-container">
          <table className="table">
            <thead><tr>
              <th>#</th><th>Student</th>
              {r.subjects.map((s: any) => <th key={s.id} className="text-right">{s.name}<span className="block text-2xs font-normal text-gray-400">/{s.totalMarks}</span></th>)}
              <th className="text-right">Total</th><th className="text-right">%</th><th>Grade</th><th>Pos.</th><th>Result</th><th>Remarks</th><th />
            </tr></thead>
            <tbody>
              {r.students.map((s: any) => (
                <tr key={s.student.id}>
                  <td className="text-gray-400">{s.student.rollNo ?? ''}</td>
                  <td className="font-medium">{s.student.name}</td>
                  {s.subjects.map((x: any) => (
                    <td key={x.examSubjectId} className={cn('text-right', x.passed === false && 'font-semibold text-red-600')}>
                      {x.isAbsent ? 'AB' : x.obtained ?? <span className="text-gray-300">—</span>}
                    </td>
                  ))}
                  <td className="text-right font-medium">{s.obtained}/{s.maxMarks}</td>
                  <td className="text-right">{s.percent ?? '—'}</td>
                  <td>{s.grade ?? '—'}</td>
                  <td>{s.position ?? '—'}</td>
                  <td>{s.passed === null ? <span className="badge badge-gray">incomplete</span> : s.passed ? <span className="badge badge-green">pass</span> : <span className="badge badge-red">fail</span>}</td>
                  <td className="min-w-[200px]">{canRemark
                    ? <input className="input" value={remarks[s.student.id] ?? ''} maxLength={500} onChange={(e) => setRemarks({ ...remarks, [s.student.id]: e.target.value })} aria-label={`Remarks for ${s.student.name}`} />
                    : <span className="text-sm text-gray-600">{s.remarks ?? ''}</span>}</td>
                  <td><button className="btn-icon btn-ghost" aria-label={`Report card for ${s.student.name}`} onClick={() => pdf(s.student.id)}><FileDown className="h-4 w-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Analysis ───

function Analysis({ exam }: { exam: any }) {
  const [classId, setClassId] = useState(exam.classes[0]?.classId ?? '');
  const q = useQuery({ queryKey: ['analysis', exam.id, classId], queryFn: () => examsAPI.analysis(exam.id, classId), enabled: !!classId });
  const a = q.data;
  const maxGrade = useMemo(() => Math.max(1, ...(a?.gradeDistribution ?? []).map((g: any) => g.count)), [a]);
  if (!exam.classes.length) return <div className="card"><Empty title="No classes in this exam" /></div>;
  return (
    <div className="space-y-4">
      <select className="select w-48" value={classId} onChange={(e) => setClassId(e.target.value)} aria-label="Class">
        {exam.classes.map((c: any) => <option key={c.classId} value={c.classId}>{c.name}</option>)}
      </select>
      {q.isLoading ? <Spinner /> : a && <>
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Results complete" value={`${a.resultsComplete}/${a.students}`} />
          <Stat label="Pass rate" value={a.passPercent !== null ? `${a.passPercent}%` : '—'} tone={a.passPercent !== null && a.passPercent < 60 ? 'warn' : 'good'} />
          <Stat label="Class average" value={a.average !== null ? `${a.average}%` : '—'} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card">
            <h3 className="section-title mb-3">By subject</h3>
            <table className="table"><thead><tr><th>Subject</th><th className="text-right">Avg %</th><th className="text-right">Pass %</th><th className="text-right">Highest</th></tr></thead>
              <tbody>{a.subjects.map((s: any) => (
                <tr key={s.name}><td>{s.name}</td><td className="text-right">{s.average ?? '—'}</td>
                  <td className={cn('text-right', s.passPercent !== null && s.passPercent < 60 && 'font-semibold text-amber-600')}>{s.passPercent ?? '—'}</td>
                  <td className="text-right">{s.highest ?? '—'}/{s.totalMarks}</td></tr>
              ))}</tbody></table>
          </div>
          <div className="card">
            <h3 className="section-title mb-3">By section</h3>
            <table className="table"><thead><tr><th>Section</th><th className="text-right">Avg %</th><th className="text-right">Pass %</th></tr></thead>
              <tbody>{a.sections.map((s: any) => <tr key={s.sectionId}><td>{s.name}</td><td className="text-right">{s.average ?? '—'}</td><td className="text-right">{s.passPercent ?? '—'}</td></tr>)}</tbody></table>
            <h3 className="section-title mb-2 mt-5">Grade distribution</h3>
            <ul className="space-y-1.5" aria-label="Number of students per grade">
              {a.gradeDistribution.map((g: any) => (
                <li key={g.grade} className="flex items-center gap-2 text-sm">
                  <span className="w-8 font-medium">{g.grade}</span>
                  <span className="h-3 rounded-r bg-primary-500" style={{ width: `${(g.count / maxGrade) * 70}%` }} />
                  <span className="text-gray-600">{g.count}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="card">
          <h3 className="section-title mb-2">Top students</h3>
          <ol className="space-y-1 text-sm">{a.toppers.map((t: any, i: number) => <li key={i}>{i + 1}. <b>{t.name}</b> <span className="text-gray-500">({t.section})</span> — {t.percent}% · {t.grade}</li>)}</ol>
        </div>
      </>}
    </div>
  );
}
