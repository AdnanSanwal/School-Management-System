'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowDown, ArrowUp, ArrowLeft, KeyRound, Pencil, Plus, Printer, RefreshCw, Save, Shuffle, Trash2 } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Field, Modal, Spinner } from '@/components/ui/kit';
import { testmakerAPI, apiError } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { PaperSheet, type SheetPaper } from '@/components/testmaker/PaperSheet';
import { QuestionFields, emptyDraft, fromDraft, toDraft, type QuestionDraft } from '@/components/testmaker/QuestionFields';
import { BOARDS, MEDIUMS, PAPER_TYPES, TYPES, typeLabel, type Medium, type PaperItem, type PaperSection, type QuestionType } from '@/components/testmaker/shared';

const sum = (sections: PaperSection[]) => sections.reduce((total, s) => {
  const marks = s.items.map((i) => Number(i.marks)).sort((a, b) => b - a);
  return total + (s.attempt && s.attempt < marks.length ? marks.slice(0, s.attempt) : marks).reduce((t, m) => t + m, 0);
}, 0);

export default function PaperEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['tm-paper', id], queryFn: () => testmakerAPI.paper(id) });
  const [paper, setPaper] = useState<SheetPaper | null>(null);
  const [dirty, setDirty] = useState(false);
  const [view, setView] = useState<'paper' | 'key'>('paper');
  const [editing, setEditing] = useState<{ si: number; qi: number | null } | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => { if (data) { setPaper(data); setDirty(false); } }, [data]);
  // Warn before leaving with changes that were not saved.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const chapters = useQuery({ queryKey: ['tm-chapters', data?.classId, data?.subjectId], queryFn: () => testmakerAPI.chapters(data.classId, data.subjectId), enabled: !!data });

  const change = (patch: Partial<SheetPaper>) => { if (paper) { setPaper({ ...paper, ...patch }); setDirty(true); } };
  const setSections = (sections: PaperSection[]) => change({ sections, totalMarks: sum(sections) });
  const setSection = (si: number, patch: Partial<PaperSection>) => setSections(paper!.sections.map((s, i) => (i === si ? { ...s, ...patch } : s)));
  const setItems = (si: number, items: PaperItem[]) => setSections(items.length ? paper!.sections.map((s, i) => (i === si ? { ...s, items } : s)) : paper!.sections.filter((_, i) => i !== si));
  const move = <T,>(list: T[], from: number, to: number) => { const next = [...list]; next.splice(to, 0, next.splice(from, 1)[0]); return next; };

  const save = useMutation({
    mutationFn: () => testmakerAPI.updatePaper(id, {
      title: paper!.title, medium: paper!.medium, paperType: paper!.paperType || null, board: paper!.board || null, durationMinutes: paper!.durationMinutes || null, instructions: paper!.instructions || null,
      sections: paper!.sections.map((s) => ({ ...s, items: s.items.map(({ imageUrl: _imageUrl, ...item }) => item) })),
    }),
    onSuccess: () => { toast.success('Paper saved'); setDirty(false); qc.invalidateQueries({ queryKey: ['tm-papers'] }); qc.invalidateQueries({ queryKey: ['tm-paper', id] }); },
    onError: (e) => toast.error(apiError(e)),
  });
  const remove = useMutation({
    mutationFn: () => testmakerAPI.deletePaper(id),
    onSuccess: () => { toast.success('Paper deleted'); qc.invalidateQueries({ queryKey: ['tm-papers'] }); router.push('/testmaker/papers'); },
    onError: (e) => toast.error(apiError(e)),
  });

  /** Draws `count` more questions of a kind from the bank, never one already on the paper. */
  const draw = async (type: QuestionType, count: number, marksEach?: number) => {
    const chapterIds = (chapters.data ?? []).map((c: any) => c.id);
    if (!chapterIds.length) { toast.error('This subject has no chapters in the bank.'); return []; }
    const onPaper = paper!.sections.flatMap((s) => s.items.map((i) => i.questionId).filter(Boolean));
    try {
      const r = await testmakerAPI.draw({ classId: data.classId, subjectId: data.subjectId, chapterIds, mix: [{ type, count, ...(marksEach ? { marksEach } : {}) }], excludeIds: onPaper });
      const items: PaperItem[] = r.sections[0]?.items ?? [];
      if (items.length < count) toast(`The bank has no ${items.length ? 'more ' : 'other '}${typeLabel(type).toLowerCase()} questions that are not already on this paper.`, { icon: '⚠️' });
      return items;
    } catch (e) { toast.error(apiError(e)); return []; }
  };
  const swap = async (si: number, qi: number) => {
    const s = paper!.sections[si];
    const [fresh] = await draw(s.type, 1, Number(s.items[qi].marks));
    if (fresh) setItems(si, s.items.map((item, i) => (i === qi ? fresh : item)));
  };
  const addFromBank = async (si: number) => {
    const s = paper!.sections[si];
    const [fresh] = await draw(s.type, 1, Number(s.items[s.items.length - 1]?.marks) || undefined);
    if (fresh) setItems(si, [...s.items, fresh]);
  };

  const print = (which: 'paper' | 'key') => { setView(which); setTimeout(() => window.print(), 150); };

  if (isLoading || !paper) {
    return <DashboardLayout title="Paper" allowedRoles={CAN.testMaker}>{error ? <div className="card text-sm text-red-600">{apiError(error)}</div> : <Spinner />}</DashboardLayout>;
  }

  return (
    <DashboardLayout title={paper.title} allowedRoles={CAN.testMaker}
      subtitle={`${paper.className} · ${paper.subjectName} · ${Number(paper.totalMarks)} marks${dirty ? ' · changes not saved' : ''}`}
      actions={<div className="flex flex-wrap gap-2">
        <Link href="/testmaker/papers" className="btn btn-secondary"><ArrowLeft className="h-4 w-4" /> Papers</Link>
        <button className="btn btn-secondary" onClick={() => print('key')}><KeyRound className="h-4 w-4" /> Print answer key</button>
        <button className="btn btn-secondary" onClick={() => print('paper')}><Printer className="h-4 w-4" /> Print paper</button>
        <button className="btn btn-primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}><Save className="h-4 w-4" /> Save</button>
      </div>}>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,26rem)_1fr]">
        {/* Editing */}
        <div className="space-y-4">
          <div className="card space-y-3">
            <h3 className="section-title">Paper details</h3>
            <Field label="Title"><input className="input" maxLength={150} value={paper.title} onChange={(e) => change({ title: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Medium">
                <select className="select" value={paper.medium} onChange={(e) => change({ medium: e.target.value as Medium })}>
                  {MEDIUMS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                </select>
              </Field>
              <Field label="Time (minutes)"><input className="input" type="number" min={5} max={600} value={paper.durationMinutes ?? ''} onChange={(e) => change({ durationMinutes: e.target.value ? Number(e.target.value) : null })} /></Field>
              <Field label="Kind of test">
                <select className="select" value={paper.paperType ?? ''} onChange={(e) => change({ paperType: e.target.value || null })}>
                  <option value="">Not stated</option>
                  {PAPER_TYPES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                </select>
              </Field>
              <Field label="Board pattern" hint="A note for you. It is not printed.">
                <select className="select" value={paper.board ?? ''} onChange={(e) => change({ board: e.target.value || null })}>
                  <option value="">Not stated</option>
                  {BOARDS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Instructions (optional)"><textarea className="input min-h-[60px]" maxLength={2000} value={paper.instructions ?? ''} onChange={(e) => change({ instructions: e.target.value })} placeholder="Attempt all questions. Use blue or black ink." /></Field>
          </div>

          {paper.sections.map((s, si) => (
            <div key={si} className="card space-y-3">
              <div className="flex items-center gap-2">
                <input className="input flex-1 font-semibold" value={s.title} maxLength={150} onChange={(e) => setSection(si, { title: e.target.value })} aria-label="Section heading" />
                <button className="btn-icon btn-ghost" disabled={si === 0} aria-label="Move section up" onClick={() => setSections(move(paper.sections, si, si - 1))}><ArrowUp className="h-4 w-4" /></button>
                <button className="btn-icon btn-ghost" disabled={si === paper.sections.length - 1} aria-label="Move section down" onClick={() => setSections(move(paper.sections, si, si + 1))}><ArrowDown className="h-4 w-4" /></button>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-600">
                Pupils attempt
                <select className="select w-auto" value={s.attempt ?? ''} onChange={(e) => setSection(si, { attempt: e.target.value ? Number(e.target.value) : null })} aria-label="How many questions pupils attempt">
                  <option value="">all {s.items.length}</option>
                  {s.items.slice(0, -1).map((_, i) => <option key={i} value={i + 1}>any {i + 1} of {s.items.length}</option>)}
                </select>
              </label>
              <ol className="space-y-2">
                {s.items.map((item, qi) => (
                  <li key={qi} className="rounded-xl border border-gray-100 p-2 text-sm">
                    <p className="line-clamp-2 text-gray-800" dir="auto">{item.textEn || item.textUr || typeLabel(s.type)}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <label className="mr-auto flex items-center gap-1 text-xs text-gray-500">Marks
                        <input className="input w-16 py-1" type="number" min={0.5} max={100} step={0.5} value={item.marks} onChange={(e) => setItems(si, s.items.map((x, i) => (i === qi ? { ...x, marks: Number(e.target.value) || 0.5 } : x)))} aria-label="Marks for this question" />
                      </label>
                      <button className="btn-icon btn-ghost" disabled={qi === 0} aria-label="Move question up" onClick={() => setItems(si, move(s.items, qi, qi - 1))}><ArrowUp className="h-4 w-4" /></button>
                      <button className="btn-icon btn-ghost" disabled={qi === s.items.length - 1} aria-label="Move question down" onClick={() => setItems(si, move(s.items, qi, qi + 1))}><ArrowDown className="h-4 w-4" /></button>
                      <button className="btn-icon btn-ghost" aria-label="Reword this question" title="Reword" onClick={() => setEditing({ si, qi })}><Pencil className="h-4 w-4" /></button>
                      <button className="btn-icon btn-ghost" aria-label="Swap for another from the bank" title="Swap for another from the bank" onClick={() => swap(si, qi)}><RefreshCw className="h-4 w-4" /></button>
                      <button className="btn-icon btn-ghost text-red-600" aria-label="Remove from the paper" title="Remove" onClick={() => setItems(si, s.items.filter((_, i) => i !== qi))}><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-secondary" onClick={() => addFromBank(si)}><Shuffle className="h-4 w-4" /> Add one from the bank</button>
                <button className="btn btn-secondary" onClick={() => setEditing({ si, qi: null })}><Plus className="h-4 w-4" /> Write one</button>
              </div>
            </div>
          ))}

          <div className="card flex flex-wrap items-center justify-between gap-2">
            <button className="btn btn-secondary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add a section</button>
            <button className="text-sm text-red-600 hover:underline" onClick={() => { if (confirm('Delete this paper? This cannot be undone.')) remove.mutate(); }}>Delete this paper</button>
          </div>
        </div>

        {/* What will be printed */}
        <div className="space-y-2">
          <div className="no-print flex gap-2 text-sm">
            <button className={`rounded-lg px-3 py-1.5 ${view === 'paper' ? 'bg-primary-50 font-medium text-primary-700' : 'text-gray-500 hover:bg-slate-50'}`} onClick={() => setView('paper')}>Paper</button>
            <button className={`rounded-lg px-3 py-1.5 ${view === 'key' ? 'bg-primary-50 font-medium text-primary-700' : 'text-gray-500 hover:bg-slate-50'}`} onClick={() => setView('key')}>Answer key</button>
          </div>
          <div className="print-area overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
            <PaperSheet paper={paper} answers={view === 'key'} />
          </div>
        </div>
      </div>

      {editing && (
        <ItemModal
          type={paper.sections[editing.si].type}
          item={editing.qi === null ? null : paper.sections[editing.si].items[editing.qi]}
          onClose={() => setEditing(null)}
          onSave={(item) => {
            const s = paper.sections[editing.si];
            setItems(editing.si, editing.qi === null ? [...s.items, item] : s.items.map((x, i) => (i === editing.qi ? { ...x, ...item } : x)));
            setEditing(null);
          }}
        />
      )}
      {adding && (
        <Modal open onClose={() => setAdding(false)} title="Add a section">
          <div className="space-y-2">
            <p className="text-sm text-gray-500">Choose the kind of question. One is drawn from the bank to start the section; add more from there.</p>
            {TYPES.map((t) => (
              <button key={t.type} className="btn btn-secondary w-full justify-start" onClick={async () => {
                setAdding(false);
                const items = await draw(t.type, 1, t.marks);
                if (items.length) setSections([...paper.sections, { type: t.type, title: t.label === 'Multiple choice' ? 'Multiple choice questions' : t.label, items }]);
              }}>{t.label}</button>
            ))}
          </div>
        </Modal>
      )}
    </DashboardLayout>
  );
}

/** Reword a question on this paper, or write a new one. The bank is not changed. */
function ItemModal({ type, item, onClose, onSave }: { type: QuestionType; item: PaperItem | null; onClose: () => void; onSave: (item: PaperItem) => void }) {
  const [draft, setDraft] = useState<QuestionDraft>(item ? toDraft({ ...item, type }) : emptyDraft(type));
  const submit = () => {
    const q = fromDraft(draft);
    if (type !== 'MATCH' && !q.textEn && !q.textUr) { toast.error('Write the question in English, Urdu or both'); return; }
    if (type === 'MCQ' && (q.options?.length ?? 0) < 2) { toast.error('Give at least two choices'); return; }
    if (type === 'MATCH' && (q.options?.length ?? 0) < 2) { toast.error('Give at least two pairs'); return; }
    onSave({ questionId: item?.questionId ?? null, textEn: q.textEn, textUr: q.textUr, options: q.options as PaperItem['options'], answer: q.answer, marks: q.marks, imageKey: item?.imageKey ?? null, imageUrl: item?.imageUrl ?? null });
  };
  return (
    <Modal open onClose={onClose} title={item ? 'Reword this question' : 'Write a question for this paper'} wide>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <p className="text-sm text-gray-500">This changes the paper only. The question bank stays as it is.</p>
        <QuestionFields value={draft} onChange={setDraft} lockType />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          <button className="btn btn-primary">{item ? 'Use this wording' : 'Add to the paper'}</button>
        </div>
      </form>
    </Modal>
  );
}
