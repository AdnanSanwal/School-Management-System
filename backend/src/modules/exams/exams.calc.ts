// Pure result arithmetic (no I/O) — unit-tested in __tests__/unit/exams.calc.test.ts.

export interface GradeBand {
  grade: string;
  minPercent: number;
  maxPercent: number;
  remark?: string | null;
}

export interface SubjectScore {
  examSubjectId: string;
  subject: string;
  totalMarks: number;
  passingMarks: number;
  /** null = not entered yet */
  obtained: number | null;
  isAbsent: boolean;
}

export interface StudentResult {
  obtained: number;
  maxMarks: number;
  percent: number | null;
  grade: string | null;
  gradeRemark: string | null;
  passed: boolean | null; // null until every subject is entered
  complete: boolean;
  failedSubjects: string[];
  subjects: (SubjectScore & { percent: number | null; grade: string | null; passed: boolean | null })[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Highest band whose minimum the percentage reaches (so gaps like 89.99→90 can't fall through). */
export function gradeFor(percent: number | null, scale: GradeBand[]): GradeBand | null {
  if (percent === null || !scale.length) return null;
  const sorted = [...scale].sort((a, b) => b.minPercent - a.minPercent);
  return sorted.find((b) => percent >= b.minPercent) ?? sorted[sorted.length - 1];
}

export function studentResult(subjects: SubjectScore[], scale: GradeBand[]): StudentResult {
  const rows = subjects.map((s) => {
    const entered = s.isAbsent || s.obtained !== null;
    const got = s.isAbsent ? 0 : s.obtained ?? 0;
    const pct = entered && s.totalMarks > 0 ? round2((got / s.totalMarks) * 100) : null;
    return {
      ...s,
      percent: pct,
      grade: gradeFor(pct, scale)?.grade ?? null,
      passed: entered ? !s.isAbsent && got >= s.passingMarks : null,
    };
  });
  const complete = rows.length > 0 && rows.every((r) => r.passed !== null);
  const obtained = round2(rows.reduce((n, r) => n + (r.isAbsent ? 0 : r.obtained ?? 0), 0));
  const maxMarks = round2(rows.reduce((n, r) => n + r.totalMarks, 0));
  const percent = complete && maxMarks > 0 ? round2((obtained / maxMarks) * 100) : null;
  const band = gradeFor(percent, scale);
  return {
    obtained, maxMarks, percent,
    grade: band?.grade ?? null,
    gradeRemark: band?.remark ?? null,
    passed: complete ? rows.every((r) => r.passed) : null,
    complete,
    failedSubjects: rows.filter((r) => r.passed === false).map((r) => r.subject),
    subjects: rows,
  };
}

/**
 * Class positions by percentage, standard competition ranking (1, 2, 2, 4).
 * Only students with complete results get a position.
 */
export function rank<T extends { percent: number | null; complete: boolean }>(rows: T[]): (T & { position: number | null })[] {
  const ranked = rows.filter((r) => r.complete && r.percent !== null).sort((a, b) => b.percent! - a.percent!);
  const pos = new Map<T, number>();
  ranked.forEach((r, i) => pos.set(r, i > 0 && r.percent === ranked[i - 1].percent ? pos.get(ranked[i - 1])! : i + 1));
  return rows.map((r) => ({ ...r, position: pos.get(r) ?? null }));
}

/** Checks a grade scale covers 0–100 without overlaps. Returns a problem description or null. */
export function validateScale(scale: GradeBand[]): string | null {
  if (!scale.length) return 'Add at least one grade';
  const sorted = [...scale].sort((a, b) => a.minPercent - b.minPercent);
  if (sorted[0].minPercent > 0) return 'The lowest grade must start at 0%';
  if (sorted[sorted.length - 1].maxPercent < 100) return 'The highest grade must reach 100%';
  for (const b of sorted) if (b.minPercent > b.maxPercent) return `${b.grade}: minimum is above maximum`;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].minPercent <= sorted[i - 1].maxPercent - 0.005) return `${sorted[i - 1].grade} and ${sorted[i].grade} overlap`;
    if (sorted[i].minPercent - sorted[i - 1].maxPercent > 0.011) return `Gap between ${sorted[i - 1].grade} and ${sorted[i].grade}`;
  }
  if (new Set(scale.map((b) => b.grade)).size !== scale.length) return 'Grade names must be unique';
  return null;
}
