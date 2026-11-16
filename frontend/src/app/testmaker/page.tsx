'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { FileText, ImagePlus, Pencil, Plus, Trash2, Upload, X } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Empty, Field, Modal, Spinner } from '@/components/ui/kit';
import { SearchInput, cleanTerm, useDebounced } from '@/components/ui/SearchInput';
import { testmakerAPI, apiError } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { cn } from '@/lib/utils';
import { QuestionFields, emptyDraft, fromDraft, toDraft, type QuestionDraft } from '@/components/testmaker/QuestionFields';
import { ImportQuestions } from '@/components/testmaker/ImportQuestions';
import { ClassSubjectPickers, useClassSubject } from '@/components/testmaker/ClassSubject';
import { QuestionBody, AnswerText, SOURCES, TYPES, typeLabel, URDU_FONT, type QuestionType } from '@/components/testmaker/shared';

export default function QuestionBankPage() {
  const qc = useQueryClient();
  const pick = useClassSubject();
  const { classId, subjectId, ready } = pick;
  const [chapterId, setChapterId] = useState('');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const term = useDebounced(cleanTerm(search), 300);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<any | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const [newChapter, setNewChapter] = useState({ number: '', name: '', nameUr: '' });
  const [newTopic, setNewTopic] = useState('');

  useEffect(() => { setChapterId(''); setPage(1); }, [classId, subjectId]);
  useEffect(() => { setPage(1); }, [chapterId, type, term]);

  const chapters = useQuery({ queryKey: ['tm-chapters', classId, subjectId], queryFn: () => testmakerAPI.chapters(classId, subjectId), enabled: ready });
  const questions = useQuery({
    queryKey: ['tm-questions', classId, subjectId, chapterId, type, term, page],
    queryFn: () => testmakerAPI.questions({ classId, subjectId, page, limit: 20, ...(chapterId ? { chapterId } : {}), ...(type ? { type } : {}), ...(term ? { search: term } : {}) }),
    enabled: ready,
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['tm-chapters'] }); qc.invalidateQueries({ queryKey: ['tm-questions'] }); };
  const onError = (e: unknown) => toast.error(apiError(e));

  const addChapter = useMutation({
    mutationFn: () => testmakerAPI.addChapter({ classId, subjectId, number: Number(newChapter.number), name: newChapter.name, nameUr: newChapter.nameUr || null }),
    onSuccess: () => { toast.success('Chapter added'); setNewChapter({ number: '', name: '', nameUr: '' }); refresh(); }, onError,
  });
  const removeChapter = useMutation({ mutationFn: testmakerAPI.deleteChapter, onSuccess: () => { toast.success('Chapter deleted'); setChapterId(''); refresh(); }, onError });
  const addTopic = useMutation({ mutationFn: () => testmakerAPI.addTopic(chapterId, { name: newTopic }), onSuccess: () => { setNewTopic(''); refresh(); }, onError });
  const removeTopic = useMutation({ mutationFn: testmakerAPI.deleteTopic, onSuccess: refresh, onError });
  const removeQuestion = useMutation({ mutationFn: testmakerAPI.deleteQuestion, onSuccess: () => { toast.success('Question deleted'); refresh(); }, onError });
  const setImage = useMutation({ mutationFn: ({ id, file }: { id: string; file: File }) => testmakerAPI.uploadImage(id, file), onSuccess: () => { toast.success('Picture added'); refresh(); }, onError });
  const dropImage = useMutation({ mutationFn: testmakerAPI.removeImage, onSuccess: refresh, onError });

  const list: any[] = chapters.data ?? [];
  const chapter = list.find((c) => c.id === chapterId);
  const rows: any[] = questions.data?.data ?? [];
  const total: number = questions.data?.pagination?.total ?? rows.length;
  const nextNumber = (list.reduce((m, c) => Math.max(m, c.number), 0) || 0) + 1;

  return (
    <DashboardLayout title="Test maker" allowedRoles={CAN.testMaker}
      subtitle="Your school’s question bank. Build it once, then make papers from it in minutes."
      actions={<Link href="/testmaker/papers" className="btn btn-primary"><FileText className="h-4 w-4" /> Papers</Link>}>
      <div className="space-y-4">
        <div className="card flex flex-wrap items-end justify-between gap-3">
          <ClassSubjectPickers pick={pick} />
          <div className="flex gap-2">
            <button className="btn btn-secondary" disabled={!list.length} onClick={() => setImporting(true)}><Upload className="h-4 w-4" /> Import</button>
            <button className="btn btn-primary" disabled={!list.length} onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> Add question</button>
          </div>
        </div>

        {pick.scope && !pick.scope.classes.length ? (
          <div className="card"><Empty title="No classes to work on">You are not assigned to teach any subject this year. Ask the school office to set your subjects under Classes.</Empty></div>
        ) : !ready || chapters.isLoading ? <Spinner /> : (
          <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
            {/* Chapters */}
            <aside className="card space-y-3 self-start">
              <h3 className="section-title">Chapters</h3>
              <ul className="space-y-1 text-sm">
                <li><button className={cn('w-full rounded-lg px-2 py-1.5 text-left', !chapterId ? 'bg-primary-50 font-medium text-primary-700' : 'hover:bg-slate-50')} onClick={() => setChapterId('')}>All chapters</button></li>
                {list.map((c) => (
                  <li key={c.id}>
                    <button className={cn('flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left', chapterId === c.id ? 'bg-primary-50 font-medium text-primary-700' : 'hover:bg-slate-50')} onClick={() => setChapterId(c.id)}>
                      <span>{c.number}. {c.name}{c.nameUr && <span className="mr-1 block text-xs text-gray-500" dir="rtl" style={{ fontFamily: URDU_FONT }}>{c.nameUr}</span>}</span>
                      <span className="badge badge-gray">{c.questions}</span>
                    </button>
                  </li>
                ))}
                {!list.length && <li className="text-gray-500">No chapters yet. Add the first one below.</li>}
              </ul>

              {chapter && (
                <div className="space-y-2 border-t border-gray-100 pt-3 text-sm">
                  <p className="font-medium text-gray-700">Topics in chapter {chapter.number}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {chapter.topics.map((t: any) => (
                      <span key={t.id} className="badge badge-indigo flex items-center gap-1">{t.name}
                        <button aria-label={`Remove topic ${t.name}`} onClick={() => removeTopic.mutate(t.id)}><X className="h-3 w-3" /></button>
                      </span>
                    ))}
                    {!chapter.topics.length && <span className="text-gray-500">None. Topics are optional.</span>}
                  </div>
                  <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addTopic.mutate(); }}>
                    <input className="input" required placeholder="New topic" value={newTopic} onChange={(e) => setNewTopic(e.target.value)} aria-label="New topic name" />
                    <button className="btn btn-secondary" disabled={addTopic.isPending}>Add</button>
                  </form>
                  {chapter.questions === 0 && (
                    <button className="text-xs text-red-600 hover:underline" onClick={() => { if (confirm(`Delete chapter ${chapter.number}: ${chapter.name}?`)) removeChapter.mutate(chapter.id); }}>Delete this chapter</button>
                  )}
                </div>
              )}

              <form className="space-y-2 border-t border-gray-100 pt-3" onSubmit={(e) => { e.preventDefault(); addChapter.mutate(); }}>
                <p className="text-sm font-medium text-gray-700">Add a chapter</p>
                <div className="flex gap-2">
                  <input className="input w-16" type="number" min={1} max={200} required placeholder={String(nextNumber)} value={newChapter.number} onChange={(e) => setNewChapter({ ...newChapter, number: e.target.value })} aria-label="Chapter number" />
                  <input className="input" required placeholder="Chapter name" value={newChapter.name} onChange={(e) => setNewChapter({ ...newChapter, name: e.target.value })} aria-label="Chapter name" />
                </div>
                <input className="input" placeholder="نام اردو میں (اختیاری)" dir="rtl" style={{ fontFamily: URDU_FONT }} value={newChapter.nameUr} onChange={(e) => setNewChapter({ ...newChapter, nameUr: e.target.value })} aria-label="Chapter name in Urdu (optional)" />
                <button className="btn btn-secondary w-full" disabled={addChapter.isPending}>Add chapter</button>
              </form>
            </aside>

            {/* Questions */}
            <section className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <select className="select w-48" value={type} onChange={(e) => setType(e.target.value)} aria-label="Question type">
                  <option value="">All types</option>
                  {TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
                </select>
                <div className="min-w-[14rem] flex-1"><SearchInput placeholder="Search the wording" value={search} onChange={setSearch} aria-label="Search questions" /></div>
                <span className="text-sm text-gray-500">{total} question{total === 1 ? '' : 's'}</span>
              </div>

              {questions.isLoading ? <Spinner /> : rows.length === 0 ? (
                <div className="card"><Empty title={list.length ? 'No questions here yet' : 'Start by adding a chapter'}>{list.length ? 'Add questions one at a time, or import many from a spreadsheet.' : 'Questions are filed under chapters, so the bank needs at least one.'}</Empty></div>
              ) : rows.map((q) => (
                <article key={q.id} className="card">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <span className="badge badge-indigo">{typeLabel(q.type)}</span>
                    <span>Ch. {q.chapter.number}: {q.chapter.name}</span>
                    {q.topic && <span>· {q.topic.name}</span>}
                    {q.source && <span>· {SOURCES.find(([k]) => k === q.source)?.[1]}</span>}
                    <span className="ml-auto font-medium text-gray-700">{Number(q.marks)} mark{Number(q.marks) === 1 ? '' : 's'}</span>
                  </div>
                  <div className="text-sm text-gray-900"><QuestionBody item={q} type={q.type as QuestionType} medium="DUAL" seed={q.id} /></div>
                  <p className="mt-2 text-xs text-gray-500">Answer: <AnswerText item={q} type={q.type as QuestionType} seed={q.id} /></p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button className="btn btn-secondary" onClick={() => setEditing(q)}><Pencil className="h-4 w-4" /> Edit</button>
                    <label className="btn btn-secondary cursor-pointer"><ImagePlus className="h-4 w-4" /> {q.imageUrl ? 'Change picture' : 'Add picture'}
                      <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => { const file = e.target.files?.[0]; if (file) setImage.mutate({ id: q.id, file }); e.target.value = ''; }} />
                    </label>
                    {q.imageUrl && <button className="btn btn-secondary" onClick={() => dropImage.mutate(q.id)}>Remove picture</button>}
                    <button className="btn btn-secondary text-red-600" onClick={() => { if (confirm('Delete this question from the bank? Papers already made keep their copy.')) removeQuestion.mutate(q.id); }}><Trash2 className="h-4 w-4" /> Delete</button>
                  </div>
                </article>
              ))}

              {total > 20 && (
                <div className="flex items-center justify-center gap-3 text-sm">
                  <button className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                  <span>Page {page} of {Math.ceil(total / 20)}</span>
                  <button className="btn btn-secondary" disabled={page >= Math.ceil(total / 20)} onClick={() => setPage(page + 1)}>Next</button>
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      {editing && <QuestionModal question={editing === 'new' ? null : editing} chapters={list} chapterId={chapterId} onClose={() => setEditing(null)} onDone={() => { setEditing(null); refresh(); }} />}
      {importing && <ImportQuestions chapters={list} chapterId={chapterId} onClose={() => setImporting(false)} onDone={() => { setImporting(false); refresh(); }} />}
    </DashboardLayout>
  );
}

function QuestionModal({ question, chapters, chapterId, onClose, onDone }: { question: any | null; chapters: any[]; chapterId: string; onClose: () => void; onDone: () => void }) {
  const [draft, setDraft] = useState<QuestionDraft>(question ? toDraft(question) : emptyDraft());
  const [chapter, setChapter] = useState<string>(question?.chapterId ?? (chapterId || chapters[0]?.id || ''));
  const [topicId, setTopicId] = useState<string>(question?.topicId ?? '');
  const [source, setSource] = useState<string>(question?.source ?? '');
  const [another, setAnother] = useState(false);
  const topics: any[] = chapters.find((c) => c.id === chapter)?.topics ?? [];
  const save = useMutation({
    mutationFn: () => {
      const body = { ...fromDraft(draft), chapterId: chapter, topicId: topics.some((t) => t.id === topicId) ? topicId : null, source: source || null };
      return question ? testmakerAPI.updateQuestion(question.id, body) : testmakerAPI.addQuestion(body);
    },
    onSuccess: () => {
      toast.success(question ? 'Question updated' : 'Question added');
      if (another && !question) setDraft(emptyDraft(draft.type)); else onDone();
    },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={another ? onDone : onClose} title={question ? 'Edit question' : 'Add a question'} wide>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Chapter">
            <select className="select" required value={chapter} onChange={(e) => { setChapter(e.target.value); setTopicId(''); }}>
              {chapters.map((c) => <option key={c.id} value={c.id}>{c.number}. {c.name}</option>)}
            </select>
          </Field>
          <Field label="Topic (optional)">
            <select className="select" value={topicId} onChange={(e) => setTopicId(e.target.value)}>
              <option value="">None</option>
              {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Taken from (optional)">
            <select className="select" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">Not said</option>
              {SOURCES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </Field>
        </div>
        <QuestionFields value={draft} onChange={setDraft} />
        <div className="flex flex-wrap items-center justify-end gap-3">
          {!question && <label className="mr-auto flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={another} onChange={(e) => setAnother(e.target.checked)} /> Keep this open to add another</label>}
          <button type="button" className="btn btn-secondary" onClick={another ? onDone : onClose}>Close</button>
          <button className="btn btn-primary" disabled={save.isPending}>{question ? 'Save changes' : 'Add question'}</button>
        </div>
      </form>
    </Modal>
  );
}
