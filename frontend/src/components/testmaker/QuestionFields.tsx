'use client';

import { Plus, Trash2 } from 'lucide-react';
import { Field } from '@/components/ui/kit';
import { LETTERS, TYPES, URDU_FONT, type Pair, type QuestionType, type Words } from './shared';

export interface QuestionDraft {
  type: QuestionType;
  textEn: string;
  textUr: string;
  options: Words[];
  pairs: Pair[];
  correct: number;
  truth: boolean;
  answerEn: string;
  answerUr: string;
  marks: number;
}

export const emptyDraft = (type: QuestionType = 'MCQ'): QuestionDraft => ({
  type, textEn: '', textUr: '', options: [{}, {}, {}, {}], pairs: [{ left: {}, right: {} }, { left: {}, right: {} }, { left: {}, right: {} }],
  correct: 0, truth: true, answerEn: '', answerUr: '', marks: TYPES.find((t) => t.type === type)?.marks ?? 1,
});

/** A saved question (from the bank or a paper) as an editable draft. */
export function toDraft(q: { type: QuestionType; textEn?: string | null; textUr?: string | null; options?: any; answer?: any; marks: number | string }): QuestionDraft {
  const d = emptyDraft(q.type);
  return {
    ...d, textEn: q.textEn ?? '', textUr: q.textUr ?? '', marks: Number(q.marks),
    options: q.type === 'MCQ' && Array.isArray(q.options) ? q.options : d.options,
    pairs: q.type === 'MATCH' && Array.isArray(q.options) ? q.options : d.pairs,
    correct: q.answer?.index ?? 0, truth: q.answer?.value ?? true, answerEn: q.answer?.en ?? '', answerUr: q.answer?.ur ?? '',
  };
}

const words = (w: Words): Words => ({ ...(w.en?.trim() ? { en: w.en.trim() } : {}), ...(w.ur?.trim() ? { ur: w.ur.trim() } : {}) });
const filled = (w: Words) => !!(w.en?.trim() || w.ur?.trim());

/** The draft in the shape the server stores. Empty choices and pairs are dropped. */
export function fromDraft(d: QuestionDraft) {
  const base = { type: d.type, textEn: d.textEn.trim() || null, textUr: d.textUr.trim() || null, marks: d.marks };
  if (d.type === 'MCQ') {
    const kept = d.options.map((o, i) => ({ o, i })).filter((x) => filled(x.o));
    return { ...base, options: kept.map((x) => words(x.o)), answer: { index: Math.max(0, kept.findIndex((x) => x.i === d.correct)) } };
  }
  if (d.type === 'TRUE_FALSE') return { ...base, options: null, answer: { value: d.truth } };
  if (d.type === 'MATCH') return { ...base, options: d.pairs.filter((p) => filled(p.left) || filled(p.right)).map((p) => ({ left: words(p.left), right: words(p.right) })), answer: null };
  const answer = words({ en: d.answerEn, ur: d.answerUr });
  return { ...base, options: null, answer: answer.en || answer.ur ? answer : null };
}

const urduInput = { dir: 'rtl' as const, lang: 'ur', style: { fontFamily: URDU_FONT } };

function Both({ value, onChange, placeholder, label }: { value: Words; onChange: (w: Words) => void; placeholder: string; label: string }) {
  return (
    <div className="grid flex-1 gap-2 sm:grid-cols-2">
      <input className="input" placeholder={placeholder} value={value.en ?? ''} onChange={(e) => onChange({ ...value, en: e.target.value })} aria-label={`${label} (English)`} />
      <input className="input" placeholder="اردو" value={value.ur ?? ''} onChange={(e) => onChange({ ...value, ur: e.target.value })} aria-label={`${label} (Urdu)`} {...urduInput} />
    </div>
  );
}

/** The form fields for one question. Used for the bank and for editing a question on a paper. */
export function QuestionFields({ value: d, onChange, lockType }: { value: QuestionDraft; onChange: (d: QuestionDraft) => void; lockType?: boolean }) {
  const set = (patch: Partial<QuestionDraft>) => onChange({ ...d, ...patch });
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Type" className="sm:col-span-2">
          <select className="select" value={d.type} disabled={lockType} onChange={(e) => set({ type: e.target.value as QuestionType, marks: TYPES.find((t) => t.type === e.target.value)?.marks ?? d.marks })}>
            {TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="Marks"><input type="number" className="input" min={0.5} max={100} step={0.5} required value={d.marks} onChange={(e) => set({ marks: Number(e.target.value) })} /></Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={d.type === 'MATCH' ? 'Instruction in English (optional)' : 'Question in English'} hint={d.type === 'BLANK' ? 'Show the gap with ____' : undefined}>
          <textarea className="input min-h-[80px]" value={d.textEn} onChange={(e) => set({ textEn: e.target.value })} />
        </Field>
        <Field label={d.type === 'MATCH' ? 'Instruction in Urdu (optional)' : 'Question in Urdu'} hint="Fill in English, Urdu, or both">
          <textarea className="input min-h-[80px]" value={d.textUr} onChange={(e) => set({ textUr: e.target.value })} {...urduInput} />
        </Field>
      </div>

      {d.type === 'MCQ' && (
        <div className="space-y-2">
          <span className="label">Choices (select the correct one)</span>
          {d.options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="radio" name="correct" checked={d.correct === i} onChange={() => set({ correct: i })} aria-label={`Choice ${LETTERS[i]} is correct`} />
              <span className="w-5 text-sm font-medium text-gray-500">{LETTERS[i]}</span>
              <Both value={o} onChange={(w) => set({ options: d.options.map((x, j) => (j === i ? w : x)) })} placeholder={`Choice ${LETTERS[i]}`} label={`Choice ${LETTERS[i]}`} />
              {d.options.length > 2 && <button type="button" className="btn-icon btn-ghost" aria-label={`Remove choice ${LETTERS[i]}`} onClick={() => set({ options: d.options.filter((_, j) => j !== i), correct: d.correct > i ? d.correct - 1 : d.correct === i ? 0 : d.correct })}><Trash2 className="h-4 w-4" /></button>}
            </div>
          ))}
          {d.options.length < 6 && <button type="button" className="btn btn-secondary" onClick={() => set({ options: [...d.options, {}] })}><Plus className="h-4 w-4" /> Add a choice</button>}
        </div>
      )}

      {d.type === 'TRUE_FALSE' && (
        <div className="flex items-center gap-4 text-sm">
          <span className="label mb-0">The statement is</span>
          <label className="flex items-center gap-2"><input type="radio" checked={d.truth} onChange={() => set({ truth: true })} /> True</label>
          <label className="flex items-center gap-2"><input type="radio" checked={!d.truth} onChange={() => set({ truth: false })} /> False</label>
        </div>
      )}

      {d.type === 'MATCH' && (
        <div className="space-y-2">
          <span className="label">Pairs (write each with its correct match; the paper shuffles column B)</span>
          {d.pairs.map((p, i) => (
            <div key={i} className="flex items-start gap-2 rounded-xl border border-gray-100 p-2">
              <span className="mt-2 w-5 text-sm font-medium text-gray-500">{i + 1}</span>
              <div className="flex-1 space-y-2">
                <Both value={p.left} onChange={(w) => set({ pairs: d.pairs.map((x, j) => (j === i ? { ...x, left: w } : x)) })} placeholder="Column A" label={`Pair ${i + 1}, column A`} />
                <Both value={p.right} onChange={(w) => set({ pairs: d.pairs.map((x, j) => (j === i ? { ...x, right: w } : x)) })} placeholder="Matches with (column B)" label={`Pair ${i + 1}, column B`} />
              </div>
              {d.pairs.length > 2 && <button type="button" className="btn-icon btn-ghost" aria-label={`Remove pair ${i + 1}`} onClick={() => set({ pairs: d.pairs.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></button>}
            </div>
          ))}
          {d.pairs.length < 10 && <button type="button" className="btn btn-secondary" onClick={() => set({ pairs: [...d.pairs, { left: {}, right: {} }] })}><Plus className="h-4 w-4" /> Add a pair</button>}
        </div>
      )}

      {(d.type === 'BLANK' || d.type === 'SHORT' || d.type === 'LONG') && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Answer in English (optional)" hint="Printed on the answer key only">
            <textarea className="input min-h-[56px]" value={d.answerEn} onChange={(e) => set({ answerEn: e.target.value })} />
          </Field>
          <Field label="Answer in Urdu (optional)">
            <textarea className="input min-h-[56px]" value={d.answerUr} onChange={(e) => set({ answerUr: e.target.value })} {...urduInput} />
          </Field>
        </div>
      )}
    </div>
  );
}
