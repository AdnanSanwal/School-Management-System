'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Paperclip, Send, Trash2 } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Field, SectionSelect, Spinner, Empty, useSections } from '@/components/ui/kit';
import { diaryAPI, academicsAPI, apiError } from '@/lib/api';
import { CAN, can } from '@/lib/roles';
import { formatDate, formatDateTime, sectionLabel, todayIso } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';

export default function DiaryPage() {
  const role = useAuthStore((s) => s.user?.role);
  const poster = can(role, 'postDiary');
  const [sectionId, setSectionId] = useState('');
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['diary', sectionId],
    queryFn: () => diaryAPI.list({ sectionId: sectionId || undefined, limit: 50 }),
  });
  const remove = useMutation({
    mutationFn: diaryAPI.remove,
    onSuccess: () => { toast.success('Deleted'); qc.invalidateQueries({ queryKey: ['diary'] }); },
    onError: (e) => toast.error(apiError(e)),
  });
  const rows: any[] = data?.data ?? [];

  return (
    <DashboardLayout title="Daily diary" allowedRoles={CAN.viewDiary} subtitle="Homework and class updates parents see in the app">
      <div className="grid gap-4 lg:grid-cols-3">
        {poster && <PostForm />}
        <div className={poster ? 'space-y-3 lg:col-span-2' : 'space-y-3 lg:col-span-3'}>
          <div className="flex justify-end"><SectionSelect value={sectionId} onChange={setSectionId} includeAll="All my sections" className="w-56" /></div>
          {isLoading ? <Spinner /> : rows.length === 0 ? <div className="card"><Empty title="No diary entries" /></div> : rows.map((e) => (
            <article key={e.id} className="card">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold text-primary-700">{e.subject?.name ?? 'General'}</span>
                <span className="text-gray-500">· {sectionLabel(e.section)} · {formatDate(e.date)}</span>
                {e.isHomework && <span className="badge badge-yellow">homework{e.dueDate ? ` · due ${formatDate(e.dueDate)}` : ''}</span>}
              </div>
              {e.title && <h3 className="mt-2 font-semibold text-gray-900">{e.title}</h3>}
              <p className="mt-1 whitespace-pre-line text-sm text-gray-700">{e.content}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {e.attachments.map((a: any) => (
                  <a key={a.id} href={a.href} target="_blank" rel="noreferrer noopener" className="btn btn-ghost px-2 py-1 text-xs"><Paperclip className="h-3.5 w-3.5" /> {a.fileName}</a>
                ))}
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
                <span>{e.teacher.name} · {formatDateTime(e.createdAt)}</span>
                {poster && e.mine && <button className="btn-icon btn-ghost h-7 w-7 text-red-500" aria-label="Delete entry" onClick={() => confirm('Delete this diary entry?') && remove.mutate(e.id)}><Trash2 className="h-3.5 w-3.5" /></button>}
              </div>
            </article>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}

function PostForm() {
  const qc = useQueryClient();
  const { data: sections = [] } = useSections();
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: academicsAPI.subjects });
  const [f, setF] = useState({ sectionId: '', subjectId: '', title: '', content: '', isHomework: true, dueDate: '' });
  const [files, setFiles] = useState<File[]>([]);
  useEffect(() => { if (!f.sectionId && sections.length) setF((x) => ({ ...x, sectionId: sections[0].id })); }, [sections, f.sectionId]);

  const m = useMutation({
    mutationFn: () => {
      const form = new FormData();
      Object.entries(f).forEach(([k, v]) => { if (v !== '' && !(k === 'dueDate' && !f.isHomework)) form.append(k, String(v)); });
      files.forEach((file) => form.append('files', file));
      return diaryAPI.post(form);
    },
    onSuccess: (r: any) => {
      toast.success(`Posted — ${r.familiesNotified} families notified`);
      setF({ ...f, title: '', content: '', dueDate: '' });
      setFiles([]);
      qc.invalidateQueries({ queryKey: ['diary'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <form className="card h-fit space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <h3 className="section-title">Post to parents</h3>
      <Field label="Class"><SectionSelect value={f.sectionId} onChange={(v) => setF({ ...f, sectionId: v })} /></Field>
      <Field label="Subject">
        <select className="select" value={f.subjectId} onChange={(e) => setF({ ...f, subjectId: e.target.value })}>
          <option value="">General</option>
          {(subjects.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Field>
      <Field label="Title (optional)"><input className="input" maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <Field label="Diary"><textarea className="input" rows={5} required maxLength={5000} value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} placeholder="Chapter 5 exercise 5.2, questions 1–10" /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isHomework} onChange={(e) => setF({ ...f, isHomework: e.target.checked })} /> Homework</label>
      {f.isHomework && <Field label="Due date"><input type="date" className="input" min={todayIso()} value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>}
      <Field label="Attachments" hint="Up to 3 photos or PDFs, 5 MB each">
        <input type="file" multiple className="input" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 3))} />
      </Field>
      <button className="btn btn-primary w-full" disabled={m.isPending || !f.sectionId}><Send className="h-4 w-4" /> {m.isPending ? 'Posting…' : 'Post'}</button>
    </form>
  );
}
