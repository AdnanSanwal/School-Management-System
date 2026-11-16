'use client';

import { AnswerText, Bilingual, QuestionBody, Urdu, type Medium, type PaperSection } from './shared';

export interface SheetPaper {
  id: string;
  title: string;
  medium: Medium;
  durationMinutes?: number | null;
  totalMarks: number | string;
  instructions?: string | null;
  className?: string | null;
  subjectName?: string | null;
  school?: { name: string; logoUrl?: string | null } | null;
  sections: PaperSection[];
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** "5 × 1 = 5" when every question carries the same marks, otherwise just the total. */
function marksNote(s: PaperSection) {
  const marks = s.items.map((i) => Number(i.marks));
  const counted = s.attempt && s.attempt < marks.length ? [...marks].sort((a, b) => b - a).slice(0, s.attempt) : marks;
  const total = counted.reduce((t, m) => t + m, 0);
  const same = marks.every((m) => m === marks[0]);
  return same ? `${counted.length} × ${fmt(marks[0])} = ${fmt(total)}` : `${fmt(total)} marks`;
}

/** The paper as it is printed. `answers` prints the answer key instead. */
export function PaperSheet({ paper, answers }: { paper: SheetPaper; answers?: boolean }) {
  // Questions are numbered straight through the paper, not per section.
  const before = (si: number) => paper.sections.slice(0, si).reduce((t, s) => t + s.items.length, 0);
  return (
    <div className="mx-auto max-w-[190mm] bg-white p-6 text-[13px] leading-snug text-black">
      <header className="border-b-2 border-black pb-2 text-center">
        <div className="flex items-center justify-center gap-3">
          {paper.school?.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- the school's own logo link
            <img src={paper.school.logoUrl} alt="" className="h-12 w-12 object-contain" />
          )}
          <h1 className="text-xl font-bold">{paper.school?.name}</h1>
        </div>
        <h2 className="mt-1 text-base font-semibold">{paper.title}{answers ? ': Answer key' : ''}</h2>
        <div className="mt-1 flex flex-wrap justify-between gap-x-6 text-sm">
          <span>Class: <b>{paper.className}</b></span>
          <span>Subject: <b>{paper.subjectName}</b></span>
          {paper.durationMinutes ? <span>Time: <b>{paper.durationMinutes} minutes</b></span> : null}
          <span>Total marks: <b>{fmt(Number(paper.totalMarks))}</b></span>
        </div>
        {!answers && (
          <div className="mt-2 flex justify-between gap-6 text-sm">
            <span className="flex-1 text-left">Name: ______________________________</span>
            <span>Roll no.: __________</span>
            <span>Date: ______________</span>
          </div>
        )}
      </header>

      {!answers && paper.instructions && <p className="mt-2 whitespace-pre-line text-sm italic">{paper.instructions}</p>}

      {paper.sections.map((s, si) => (
        <section key={si} className="mt-4">
          <div className="flex items-baseline justify-between gap-4 border-b border-gray-400 pb-0.5 font-semibold">
            <span className="flex-1">
              {paper.medium === 'UR' && s.titleUr ? <Urdu>{s.titleUr}</Urdu> : s.title}
              {paper.medium === 'DUAL' && s.titleUr ? <Urdu className="ml-3 font-normal">{s.titleUr}</Urdu> : null}
              {s.attempt && s.attempt < s.items.length ? <span className="ml-2 font-normal">(Attempt any {s.attempt})</span> : null}
            </span>
            <span className="whitespace-nowrap text-sm">({marksNote(s)})</span>
          </div>
          <ol className="mt-1.5 space-y-2.5">
            {s.items.map((item, qi) => {
              const n = before(si) + qi + 1;
              const seed = `${paper.id}-${si}-${qi}`;
              return (
                <li key={qi} className="flex gap-2" style={{ breakInside: 'avoid' }}>
                  <span className="w-7 shrink-0 font-semibold">{n}.</span>
                  <div className="flex-1">
                    {answers ? (
                      <div>
                        <Bilingual en={item.textEn} ur={item.textUr} medium={paper.medium} className="text-gray-600" />
                        <p className="mt-0.5 font-medium">Answer: <AnswerText item={item} type={s.type} seed={seed} /></p>
                      </div>
                    ) : (
                      <QuestionBody item={item} type={s.type} medium={paper.medium} seed={seed} />
                    )}
                  </div>
                  {!answers && <span className="w-8 shrink-0 text-right text-xs">[{fmt(Number(item.marks))}]</span>}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
