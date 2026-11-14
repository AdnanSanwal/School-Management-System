'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, SlidersHorizontal, Trash2, GraduationCap, CalendarDays, Clock3, CheckCircle2 } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Field, Modal, Spinner, Empty, Stat } from '@/components/ui/kit';
import { examsAPI, apiError } from '@/lib/api';
import { CAN, can } from '@/lib/roles';
import { formatDate, todayIso } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { EXAM_STATUS } from '@/lib/exams';

export default function ExamsPage() {
  const role = useAuthStore((s) => s.user?.role);
  const manage = can(role, 'manageExams');
  const [modal, setModal] = useState<null | 'new' | 'scale'>(null);
  const [year,setYear]=useState('');
  const options=useQuery({queryKey:['exam-options'],queryFn:examsAPI.options});
  const { data = [], isLoading, error } = useQuery({ queryKey: ['exams',year], queryFn: ()=>examsAPI.list(year) });
  const [filters,setFilters]=useState({search:'',className:'',status:''});
  const classes=[...new Set<string>(data.flatMap((e:any)=>e.classes))];
  const rows=data.filter((e:any)=>(!filters.search||e.name.toLowerCase().includes(filters.search.toLowerCase()))&&(!filters.className||e.classes.includes(filters.className))&&(!filters.status||e.status===filters.status));

  return (
    <DashboardLayout title="Exams & results" allowedRoles={CAN.viewExams}
      subtitle="Date sheet → principal approves → marks entry → principal publishes"
      actions={manage && <>
        <button className="btn btn-secondary" onClick={() => setModal('scale')}><SlidersHorizontal className="h-4 w-4" /> Grade scale</button>
        <button className="btn btn-primary" onClick={() => setModal('new')}><Plus className="h-4 w-4" /> New exam</button>
      </>}>
      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Stat icon={GraduationCap} label="Total exams" value={data.length}/><Stat icon={CalendarDays} tone="good" label="Upcoming" value={data.filter((e:any)=>e.startDate&&e.startDate>todayIso()&&e.status!=='PUBLISHED').length}/><Stat icon={Clock3} tone="warn" label="Marks pending" value={data.filter((e:any)=>e.status==='SCHEDULED'&&e.marksEntered<e.marksExpected).length}/><Stat icon={CheckCircle2} label="Results published" value={data.filter((e:any)=>e.status==='PUBLISHED').length}/></div>
      <div className="card mb-4 flex flex-wrap justify-between gap-3">{['Create exam','Add papers','Date sheet','Marks entry','Publish results'].map((s,i)=><div key={s} className="flex items-center gap-3 text-sm font-medium text-violet-700"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-50">{i+1}</span>{s}</div>)}</div>
      <div className="card"><div className="mb-4 flex flex-wrap items-end gap-3"><h3 className="mr-auto font-semibold text-slate-800">Examination list</h3><Field label="Academic year"><select className="select" value={year} onChange={e=>{setYear(e.target.value);setFilters({search:"",className:"",status:""});}}><option value="">Current academic year</option>{options.data?.years.map(y=><option key={y.id} value={y.id}>{y.name}{y.isCurrent?" (current)":""}</option>)}</select></Field><Field label="Class"><select className="select" value={filters.className} onChange={e=>setFilters({...filters,className:e.target.value})}><option value="">All classes</option>{classes.map(c=><option key={c}>{c}</option>)}</select></Field><Field label="Status"><select className="select" value={filters.status} onChange={e=>setFilters({...filters,status:e.target.value})}><option value="">All statuses</option>{Object.entries(EXAM_STATUS).map(([v,s])=><option key={v} value={v}>{s.label}</option>)}</select></Field><Field label="Search exams"><input type="search" className="input" value={filters.search} onChange={e=>setFilters({...filters,search:e.target.value})} placeholder="Search exams…"/></Field></div>
        {isLoading ? <Spinner /> : error ? <p role="alert" className="text-red-600">{apiError(error)}</p> : rows.length === 0 ? <Empty title={data.length?'No exams match these filters':'No exams this year'}>Create an exam or adjust the filters above.</Empty> : (
          <div className="table-container">
            <table className="table">
              <thead><tr><th>Exam</th><th>Dates</th><th>Classes</th><th>Papers</th><th>Marks progress</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {rows.map((e: any) => (
                  <tr key={e.id}>
                    <td><Link href={`/exams/${e.id}`} className="font-medium hover:text-primary-600">{e.name}</Link></td>
                    <td className="text-sm">{e.startDate ? `${formatDate(e.startDate)}${e.endDate ? ` – ${formatDate(e.endDate)}` : ''}` : '—'}</td>
                    <td className="text-sm">{e.classes.join(', ') || '—'}</td>
                    <td>{e.papers}</td>
                    <td><div className="min-w-24"><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={e.status==='PUBLISHED'?'h-full bg-emerald-400':'h-full bg-violet-500'} style={{width:`${e.marksExpected?Math.min(100,e.marksEntered/e.marksExpected*100):0}%`}}/></div><p className="mt-1 text-xs text-slate-400" title="Expected marks use current active class rosters">{e.marksEntered} / {e.marksExpected??0}</p></div></td>
                    <td><span className={`badge ${EXAM_STATUS[e.status].cls}`}>{EXAM_STATUS[e.status].label}</span></td>
                    <td><Link className="btn-secondary whitespace-nowrap" href={`/exams/${e.id}`}>{e.status==='PUBLISHED'?'View results':'Review'}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {modal === 'new' && <NewExam onClose={() => setModal(null)} />}
      {modal === 'scale' && <GradeScale onClose={() => setModal(null)} />}
    </DashboardLayout>
  );
}

function NewExam({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', startDate: '', endDate: '' });
  const m = useMutation({
    mutationFn: () => examsAPI.create({ name: f.name, startDate: f.startDate || undefined, endDate: f.endDate || undefined }),
    onSuccess: (e: any) => { qc.invalidateQueries({ queryKey: ['exams'] }); router.push(`/exams/${e.id}`); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={onClose} title="New exam">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Name"><input className="input" required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Mid Term" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts"><input type="date" className="input" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
          <Field label="Ends"><input type="date" className="input" min={f.startDate} value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
        </div>
        <button className="btn btn-primary w-full" disabled={m.isPending}>Create and add date sheet</button>
      </form>
    </Modal>
  );
}

function GradeScale({ onClose }: { onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['grade-scale'], queryFn: examsAPI.gradeScale });
  const [rows, setRows] = useState<{ grade: string; minPercent: string; maxPercent: string; remark: string }[]>([]);
  useEffect(() => {
    if (data) setRows(data.map((g: any) => ({ grade: g.grade, minPercent: String(Number(g.minPercent)), maxPercent: String(Number(g.maxPercent)), remark: g.remark ?? '' })));
  }, [data]);
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => examsAPI.saveGradeScale(rows.map((r) => ({ grade: r.grade.trim(), minPercent: Number(r.minPercent), maxPercent: Number(r.maxPercent), remark: r.remark || undefined }))),
    onSuccess: () => { toast.success('Grade scale saved'); qc.invalidateQueries({ queryKey: ['grade-scale'] }); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  const set = (i: number, k: string, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <Modal open onClose={onClose} title="Grade scale" wide>
      {isLoading ? <Spinner /> : (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
          <p className="text-xs text-gray-500">Must cover 0–100% without gaps or overlaps. Applies to all exams, including past ones.</p>
          <div className="grid grid-cols-[80px_1fr_1fr_2fr_32px] gap-2 text-xs font-medium text-gray-500"><span>Grade</span><span>From %</span><span>To %</span><span>Remark</span><span /></div>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[80px_1fr_1fr_2fr_32px] gap-2">
              <input className="input" required maxLength={8} value={r.grade} onChange={(e) => set(i, 'grade', e.target.value)} aria-label="Grade" />
              <input className="input" type="number" step="0.01" min="0" max="100" required value={r.minPercent} onChange={(e) => set(i, 'minPercent', e.target.value)} aria-label="From percent" />
              <input className="input" type="number" step="0.01" min="0" max="100" required value={r.maxPercent} onChange={(e) => set(i, 'maxPercent', e.target.value)} aria-label="To percent" />
              <input className="input" value={r.remark} onChange={(e) => set(i, 'remark', e.target.value)} placeholder="Outstanding" aria-label="Remark" />
              <button type="button" className="btn-icon btn-ghost text-red-500" aria-label="Remove grade" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <div className="flex justify-between pt-2">
            <button type="button" className="btn btn-ghost" onClick={() => setRows([...rows, { grade: '', minPercent: '', maxPercent: '', remark: '' }])}><Plus className="h-4 w-4" /> Add grade</button>
            <button className="btn btn-primary" disabled={m.isPending}>Save</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
