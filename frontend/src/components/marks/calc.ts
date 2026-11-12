import type { GradeBand, SheetOutcome, SheetSubject } from '@/lib/marksApi';

// Client-side copy of backend/src/modules/exams/exams.calc.ts (studentResult + sheetOutcome),
// so totals, grades and Pass / Retake / Fail update while typing. The server recalculates
// the same way when the sheet is loaded again.

/** A cell as typed: '' = not entered, 'AB' = absent, otherwise a number. */
export type Cell = string;
export const ABSENT = 'AB';

const round2 = (n: number) => Math.round(n * 100) / 100;

export const cellKey = (studentId: string, examSubjectId: string) => `${studentId}:${examSubjectId}`;

/** Keeps only what can be a mark while typing: digits with one decimal point, or AB. */
export function normaliseInput(raw: string): Cell | null {
  const v = raw.trim();
  if (v === '') return '';
  if (/^a(b(s(e(n(t)?)?)?)?)?$/i.test(v)) return ABSENT;
  if (/^\d{0,4}(\.\d{0,2})?$/.test(v)) return v;
  return null; // reject the keystroke
}

/** Error text for one cell, or null when it is fine (empty counts as fine: not entered yet). */
export function cellError(cell: Cell, subject: Pick<SheetSubject, 'totalMarks'>): string | null {
  if (cell === '' || cell === ABSENT) return null;
  if (!/^\d+(\.\d+)?$/.test(cell)) return 'Numbers only';
  const n = Number(cell);
  if (Number.isNaN(n)) return 'Numbers only';
  if (n < 0 || n > subject.totalMarks) return `0–${subject.totalMarks}`;
  if (Math.round(n * 4) !== n * 4) return 'Steps of 0.25';
  return null;
}

export function gradeFor(percent: number | null, scale: GradeBand[]): GradeBand | null {
  if (percent === null || !scale.length) return null;
  const sorted = [...scale].sort((a, b) => b.minPercent - a.minPercent);
  return sorted.find((b) => percent >= b.minPercent) ?? sorted[sorted.length - 1];
}

export type RowResult = {
  total: number; maxMarks: number; percent: number | null; grade: string | null;
  complete: boolean; failed: string[]; outcome: SheetOutcome | null; invalid: number;
};

export function rowResult(cells: Cell[], subjects: SheetSubject[], scale: GradeBand[], maxRetake: number): RowResult {
  let total = 0;
  let maxMarks = 0;
  let complete = subjects.length > 0;
  let invalid = 0;
  const failed: string[] = [];
  subjects.forEach((s, i) => {
    const c = cells[i] ?? '';
    maxMarks += s.totalMarks;
    if (cellError(c, s)) { invalid++; complete = false; return; }
    if (c === '') { complete = false; return; }
    if (c === ABSENT) { failed.push(s.name); return; }
    const n = Number(c);
    total += n;
    if (n < s.passingMarks) failed.push(s.name);
  });
  total = round2(total);
  const percent = complete && maxMarks > 0 ? round2((total / maxMarks) * 100) : null;
  const outcome: SheetOutcome | null = !complete ? null : failed.length === 0 ? 'PASS' : failed.length <= Math.max(0, maxRetake) ? 'RETAKE' : 'FAIL';
  return { total, maxMarks: round2(maxMarks), percent, grade: gradeFor(percent, scale)?.grade ?? null, complete, failed, outcome, invalid };
}

export const OUTCOME: Record<SheetOutcome, { label: string; cls: string }> = {
  PASS: { label: 'Pass', cls: 'badge-green' },
  RETAKE: { label: 'Retake', cls: 'badge-yellow' },
  FAIL: { label: 'Fail', cls: 'badge-red' },
};
