'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { BookOpen, Plus, Wand2 } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Empty, Field, Modal, Spinner } from '@/components/ui/kit';
import { testmakerAPI, apiError } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { formatDateTime } from '@/lib/utils';
import { ClassSubjectPickers, useClassSubject } from '@/components/testmaker/ClassSubject';
import { TYPES, type Medium, type QuestionType } from '@/components/testmaker/shared';

const MEDIUM: Record<string, string> = { EN: 'English', UR: 'Urdu', DUAL: 'English + Urdu' };

export default function PapersPage() {
  const [making, setMaking] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['tm-papers'], queryFn: () => testmakerAPI.papers({ limit: 100 }) });
  const rows: any[] = data?.data ?? [];
  return (
    <DashboardLayout title="Papers" allowedRoles={CAN.testMaker}
      subtitle="Every paper you make is kept here, ready to reopen, change and print again"
      actions={<div className="flex gap-2">
        <Link href="/testmaker" className="btn btn-secondary"><BookOpen className="h-4 w-4" /> Question bank</Link>
        <button className="btn btn-primary" onClick={() => setMaking(true)}><Plus className="h-4 w-4" /> New paper</button>
      </div>}>
      {isLoading ? <Spinner /> : rows.length === 0 ? (
        <div className="card"><Empty title="No papers yet">Choose “New paper”, pick the chapters and how many questions of each kind, and the paper is laid out for you.</Empty></div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-gray-500">
              <tr><th className="px-4 py-3">Paper</th><th className="px-4 py-3">Class</th><th className="px-4 py-3">Subject</th><th className="px-4 py-3">Medium</th><th className="px-4 py-3">Marks</th><th className="px-4 py-3">Made by</th><th className="px-4 py-3">Last changed</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3"><Link href={`/testmaker/papers/${p.id}`} className="font-medium text-primary-700 hover:underline">{p.title}</Link></td>
                  <td className="px-4 py-3">{p.className}</td>
                  <td className="px-4 py-3">{p.subjectName}</td>
                  <td className="px-4 py-3">{MEDIUM[p.medium] ?? p.medium}</td>
                  <td className="px-4 py-3">{Number(p.totalMarks)}</td>
                  <td className="px-4 py-3 text-gray-500">{p.createdBy ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{formatDateTime(p.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {making && <NewPaper onClose={() => setMaking(false)} />}
    </DashboardLayout>
  );
}

/** Scope, chapters, the mix of questions: then the paper is drawn, saved and opened for editing. */
function NewPaper({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const pick = useClassSubject();
  const { classId, subjectId, ready } = pick;
  const [title, setTitle] = useState('');
  const [medium, setMedium] = useState<Medium>('EN');
  const [duration, setDuration] = useState('');
  const [chapterIds, setChapterIds] = useState<string[]>([]);
  const [mix, setMix] = useState<Record<string, { count: string; marks: string }>>(
    Object.fromEntries(TYPES.map((t) => [t.type, { count: '', marks: String(t.marks) }])),
  );

  const chapters = useQuery({ queryKey: ['tm-chapters', classId, subjectId], queryFn: () => testmakerAPI.chapters(classId, subjectId), enabled: ready });
  const list: any[] = useMemo(() => chapters.data ?? [], [chapters.data]);
  // A new class or subject starts with every chapter that has questions ticked.
  useEffect(() => { setChapterIds(list.filter((c) => c.questions > 0).map((c) => c.id)); }, [list]);

  const counts = useQuery({
    queryKey: ['tm-counts', classId, subjectId, chapterIds.join(',')],
    queryFn: () => testmakerAPI.counts({ classId, subjectId, chapterIds: chapterIds.join(',') }),
    enabled: ready && chapterIds.length > 0,
    meta: { quiet: true },
  });
  const available = (type: string) => (chapterIds.length ? counts.data?.[type] ?? 0 : 0);
  const wanted = TYPES.map((t) => ({ type: t.type as QuestionType, count: Number(mix[t.type].count) || 0, marksEach: Number(mix[t.type].marks) || t.marks })).filter((m) => m.count > 0);
  const total = wanted.reduce((sum, m) => sum + m.count * m.marksEach, 0);
  const over = wanted.filter((m) => m.count > available(m.type));

  const make = useMutation({
    mutationFn: async () => {
      const drawn = await testmakerAPI.draw({ classId, subjectId, chapterIds, mix: wanted });
      const sections = drawn.sections.filter((s) => s.items.length).map((s) => ({ ...s, items: s.items.map(({ imageUrl: _imageUrl, ...item }: any) => item) }));
      if (!sections.length) throw new Error('The chosen chapters have none of these questions yet.');
      const saved = await testmakerAPI.savePaper({ classId, subjectId, title, medium, durationMinutes: duration ? Number(duration) : null, instructions: null, sections });
      return { saved, short: drawn.short };
    },
    onSuccess: ({ saved, short }) => {
      if (short.length) toast(`The bank was short of some questions: ${short.map((s) => `${s.available} of ${s.wanted} ${TYPES.find((t) => t.type === s.type)?.short}`).join(', ')}.`, { icon: '⚠️', duration: 8000 });
      else toast.success('Paper made');
      router.push(`/testmaker/papers/${saved.id}`);
    },
    onError: (e: any) => toast.error(e?.response ? apiError(e) : e.message),
  });

  const toggle = (id: string) => setChapterIds(chapterIds.includes(id) ? chapterIds.filter((x) => x !== id) : [...chapterIds, id]);

  return (
    <Modal open onClose={onClose} title="New paper" wide>
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); make.mutate(); }}>
        <div className="space-y-3">
          <h4 className="section-title">1. What the paper is for</h4>
          <ClassSubjectPickers pick={pick} />
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Title" className="sm:col-span-2"><input className="input" required maxLength={150} placeholder="Monthly test: October" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label="Medium">
              <select className="select" value={medium} onChange={(e) => setMedium(e.target.value as Medium)}>
                <option value="EN">English</option><option value="UR">Urdu</option><option value="DUAL">English + Urdu</option>
              </select>
            </Field>
            <Field label="Time (minutes)"><input className="input" type="number" min={5} max={600} placeholder="45" value={duration} onChange={(e) => setDuration(e.target.value)} /></Field>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="section-title">2. Chapters to cover</h4>
            {list.length > 0 && <button type="button" className="text-xs text-primary-600 hover:underline" onClick={() => setChapterIds(chapterIds.length ? [] : list.map((c) => c.id))}>{chapterIds.length ? 'Clear all' : 'Select all'}</button>}
          </div>
          {chapters.isLoading ? <Spinner /> : list.length === 0 ? (
            <p className="text-sm text-gray-500">This subject has no chapters yet. <Link className="text-primary-600 hover:underline" href="/testmaker">Add chapters and questions in the question bank</Link> first.</p>
          ) : (
            <div className="grid max-h-44 gap-1 overflow-y-auto rounded-xl border border-gray-100 p-3 text-sm sm:grid-cols-2">
              {list.map((c) => (
                <label key={c.id} className="flex items-center gap-2">
                  <input type="checkbox" checked={chapterIds.includes(c.id)} onChange={() => toggle(c.id)} />
                  <span className="flex-1">{c.number}. {c.name}</span><span className="text-xs text-gray-400">{c.questions}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <h4 className="section-title">3. How many of each kind</h4>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-500"><tr><th className="py-1">Kind</th><th className="py-1">In the bank</th><th className="py-1">On this paper</th><th className="py-1">Marks each</th><th className="py-1 text-right">Marks</th></tr></thead>
            <tbody>
              {TYPES.map((t) => {
                const have = available(t.type); const want = Number(mix[t.type].count) || 0;
                return (
                  <tr key={t.type} className="border-t border-gray-50">
                    <td className="py-1.5">{t.label}</td>
                    <td className="py-1.5 text-gray-500">{have}</td>
                    <td className="py-1.5"><input className={`input w-20 ${want > have ? 'border-amber-400' : ''}`} type="number" min={0} max={100} placeholder="0" value={mix[t.type].count} onChange={(e) => setMix({ ...mix, [t.type]: { ...mix[t.type], count: e.target.value } })} aria-label={`Number of ${t.label} questions`} /></td>
                    <td className="py-1.5"><input className="input w-20" type="number" min={0.5} max={100} step={0.5} value={mix[t.type].marks} onChange={(e) => setMix({ ...mix, [t.type]: { ...mix[t.type], marks: e.target.value } })} aria-label={`Marks for each ${t.label} question`} /></td>
                    <td className="py-1.5 text-right">{want ? want * (Number(mix[t.type].marks) || t.marks) : '—'}</td>
                  </tr>
                );
              })}
              <tr className="border-t border-gray-200 font-semibold"><td className="py-2" colSpan={4}>Total marks</td><td className="py-2 text-right">{total}</td></tr>
            </tbody>
          </table>
          {over.length > 0 && <p className="text-xs text-amber-700">The bank has fewer than you asked for in: {over.map((m) => TYPES.find((t) => t.type === m.type)?.label).join(', ')}. The paper will use what there is.</p>}
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          <button className="btn btn-primary" disabled={make.isPending || !ready || !chapterIds.length || !wanted.length}><Wand2 className="h-4 w-4" /> {make.isPending ? 'Making…' : 'Make the paper'}</button>
        </div>
      </form>
    </Modal>
  );
}
