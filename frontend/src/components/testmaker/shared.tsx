'use client';

import { cn } from '@/lib/utils';

/** Shared pieces of the test maker: types, labels, and how a question is shown. */

export type QuestionType = 'MCQ' | 'TRUE_FALSE' | 'BLANK' | 'SHORT' | 'LONG' | 'MATCH';
export type Medium = 'EN' | 'UR' | 'DUAL';
export interface Words { en?: string; ur?: string }
export interface Pair { left: Words; right: Words }

export interface PaperItem {
  questionId?: string | null;
  textEn?: string | null;
  textUr?: string | null;
  options?: (Words | Pair)[] | null;
  answer?: any;
  marks: number;
  imageKey?: string | null;
  imageUrl?: string | null;
}
export interface PaperSection {
  type: QuestionType;
  title: string;
  titleUr?: string | null;
  attempt?: number | null;
  items: PaperItem[];
}

export const TYPES: { type: QuestionType; label: string; short: string; marks: number }[] = [
  { type: 'MCQ', label: 'Multiple choice', short: 'MCQs', marks: 1 },
  { type: 'TRUE_FALSE', label: 'True or false', short: 'True/false', marks: 1 },
  { type: 'BLANK', label: 'Fill in the blank', short: 'Blanks', marks: 1 },
  { type: 'SHORT', label: 'Short question', short: 'Short', marks: 2 },
  { type: 'LONG', label: 'Long question', short: 'Long', marks: 5 },
  { type: 'MATCH', label: 'Match the columns', short: 'Matching', marks: 4 },
];
export const typeLabel = (t: string) => TYPES.find((x) => x.type === t)?.label ?? t;

export const SOURCES: [string, string][] = [['EXERCISE', 'Textbook exercise'], ['CONCEPTUAL', 'Conceptual'], ['PAST_PAPER', 'Past paper'], ['OTHER', 'Other']];

/** Urdu is set right to left in a Nastaliq face where the computer has one. */
export const URDU_FONT = "'Jameel Noori Nastaleeq', 'Noto Nastaliq Urdu', 'Urdu Typesetting', 'Alvi Nastaleeq', serif";

export function Urdu({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span dir="rtl" lang="ur" className={cn('leading-loose', className)} style={{ fontFamily: URDU_FONT }}>{children}</span>;
}

/** The words to show for a medium: English, Urdu, or both. Falls back to whichever exists. */
export function pick(en: string | null | undefined, ur: string | null | undefined, medium: Medium): { en?: string; ur?: string } {
  if (medium === 'EN') return en ? { en } : { ur: ur ?? undefined };
  if (medium === 'UR') return ur ? { ur } : { en: en ?? undefined };
  return { en: en ?? undefined, ur: ur ?? undefined };
}

/** English on the left, Urdu on the right, the way dual-medium papers are set. */
export function Bilingual({ en, ur, medium, className }: { en?: string | null; ur?: string | null; medium: Medium; className?: string }) {
  const w = pick(en, ur, medium);
  if (w.en && w.ur) {
    return (
      <span className={cn('flex items-start justify-between gap-6', className)}>
        <span className="flex-1 whitespace-pre-line">{w.en}</span>
        <Urdu className="flex-1 whitespace-pre-line text-right">{w.ur}</Urdu>
      </span>
    );
  }
  if (w.ur) return <Urdu className={cn('block whitespace-pre-line text-right', className)}>{w.ur}</Urdu>;
  return <span className={cn('block whitespace-pre-line', className)}>{w.en}</span>;
}

export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

/**
 * A fixed shuffle for a matching question's right-hand column: the same order every time
 * the paper is opened or printed, but not the order of the answers.
 */
export function shuffledRight(pairs: Pair[], seed: string): number[] {
  let h = 2166136261;
  for (const ch of seed) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  const order = pairs.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const j = h % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  // A shuffle that leaves everything in place would give the answers away.
  if (order.length > 1 && order.every((v, i) => v === i)) order.push(order.shift()!);
  return order;
}

/** The body of one question as it appears on a paper (no number, no marks). */
export function QuestionBody({ item, type, medium, seed }: { item: PaperItem; type: QuestionType; medium: Medium; seed: string }) {
  return (
    <div className="space-y-1.5">
      {(item.textEn || item.textUr) && <Bilingual en={item.textEn} ur={item.textUr} medium={medium} />}
      {item.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- a signed link to the school's own upload
        <img src={item.imageUrl} alt="Figure for this question" className="my-1 max-h-48 max-w-full" />
      )}
      {type === 'MCQ' && (
        <ol className="grid grid-cols-2 gap-x-6 gap-y-0.5 pl-1">
          {(item.options as Words[] | undefined ?? []).map((o, i) => (
            <li key={i} className="flex gap-2"><span className="font-medium">({LETTERS[i]})</span><Bilingual en={o.en} ur={o.ur} medium={medium} className="flex-1" /></li>
          ))}
        </ol>
      )}
      {type === 'TRUE_FALSE' && <p className="pl-1 text-sm">( True / False )</p>}
      {type === 'MATCH' && (() => {
        const pairs = (item.options as Pair[] | undefined) ?? [];
        const order = shuffledRight(pairs, seed);
        return (
          <table className="w-full border-collapse text-sm">
            <thead><tr><th className="border border-gray-400 px-2 py-1 text-left">Column A</th><th className="border border-gray-400 px-2 py-1 text-left">Column B</th></tr></thead>
            <tbody>
              {pairs.map((p, i) => (
                <tr key={i}>
                  <td className="border border-gray-400 px-2 py-1"><span className="mr-2 font-medium">{i + 1}.</span><Bilingual en={p.left.en} ur={p.left.ur} medium={medium} className="inline-flex" /></td>
                  <td className="border border-gray-400 px-2 py-1"><span className="mr-2 font-medium">{LETTERS[i]}.</span><Bilingual en={pairs[order[i]].right.en} ur={pairs[order[i]].right.ur} medium={medium} className="inline-flex" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      })()}
    </div>
  );
}

/** The answer to one question, for the answer key. */
export function AnswerText({ item, type, seed }: { item: PaperItem; type: QuestionType; seed: string }) {
  if (type === 'MCQ') {
    const i = item.answer?.index ?? -1;
    const o = (item.options as Words[] | undefined)?.[i];
    return <span>({LETTERS[i] ?? '?'}) {o?.en ?? ''} {o?.ur && <Urdu>{o.ur}</Urdu>}</span>;
  }
  if (type === 'TRUE_FALSE') return <span>{item.answer?.value ? 'True' : 'False'}</span>;
  if (type === 'MATCH') {
    const pairs = (item.options as Pair[] | undefined) ?? [];
    const order = shuffledRight(pairs, seed);
    return <span>{pairs.map((_, i) => `${i + 1}–${LETTERS[order.indexOf(i)]}`).join(', ')}</span>;
  }
  if (!item.answer?.en && !item.answer?.ur) return <span className="text-gray-400">No model answer saved</span>;
  return <span className="whitespace-pre-line">{item.answer?.en} {item.answer?.ur && <Urdu>{item.answer.ur}</Urdu>}</span>;
}
