import { gradeFor, rank, studentResult, validateScale, GradeBand } from '../../modules/exams/exams.calc';

const SCALE: GradeBand[] = [
  { grade: 'A+', minPercent: 90, maxPercent: 100 },
  { grade: 'A', minPercent: 80, maxPercent: 89.99 },
  { grade: 'B', minPercent: 70, maxPercent: 79.99 },
  { grade: 'C', minPercent: 50, maxPercent: 69.99 },
  { grade: 'F', minPercent: 0, maxPercent: 49.99 },
];

const paper = (subject: string, obtained: number | null, opts: { total?: number; pass?: number; absent?: boolean } = {}) => ({
  examSubjectId: subject, subject, totalMarks: opts.total ?? 100, passingMarks: opts.pass ?? 40, obtained, isAbsent: !!opts.absent,
});

describe('gradeFor', () => {
  it('uses the highest band reached, so 89.995 is not lost between A and A+', () => {
    expect(gradeFor(100, SCALE)?.grade).toBe('A+');
    expect(gradeFor(90, SCALE)?.grade).toBe('A+');
    expect(gradeFor(89.995, SCALE)?.grade).toBe('A');
    expect(gradeFor(0, SCALE)?.grade).toBe('F');
    expect(gradeFor(null, SCALE)).toBeNull();
  });
});

describe('studentResult', () => {
  it('totals, percentage, grade and pass', () => {
    const r = studentResult([paper('Maths', 90), paper('English', 45, { total: 50, pass: 20 })], SCALE);
    expect(r).toMatchObject({ obtained: 135, maxMarks: 150, percent: 90, grade: 'A+', passed: true, complete: true, failedSubjects: [] });
    expect(r.subjects.map((s) => s.grade)).toEqual(['A+', 'A+']);
  });

  it('failing one subject fails the result even with a good total', () => {
    const r = studentResult([paper('Maths', 35), paper('English', 50, { total: 50, pass: 20 })], SCALE);
    expect(r.percent).toBe(56.67);
    expect(r.passed).toBe(false);
    expect(r.failedSubjects).toEqual(['Maths']);
  });

  it('absent counts as zero and as a fail', () => {
    const r = studentResult([paper('Maths', null, { absent: true }), paper('English', 40, { total: 50 })], SCALE);
    expect(r).toMatchObject({ obtained: 40, complete: true, passed: false, failedSubjects: ['Maths'] });
  });

  it('missing marks leave the result incomplete (no %, grade or pass)', () => {
    const r = studentResult([paper('Maths', 80), paper('English', null)], SCALE);
    expect(r).toMatchObject({ complete: false, percent: null, grade: null, passed: null });
  });
});

describe('rank', () => {
  it('uses competition ranking and skips incomplete results', () => {
    const rows = [
      { name: 'a', percent: 80, complete: true },
      { name: 'b', percent: 95, complete: true },
      { name: 'c', percent: 80, complete: true },
      { name: 'd', percent: null, complete: false },
      { name: 'e', percent: 60, complete: true },
    ];
    expect(rank(rows).map((r) => [r.name, r.position])).toEqual([['a', 2], ['b', 1], ['c', 2], ['d', null], ['e', 4]]);
  });
});

describe('validateScale', () => {
  it('accepts a scale covering 0–100', () => {
    expect(validateScale(SCALE)).toBeNull();
  });
  it.each([
    [[{ grade: 'A', minPercent: 50, maxPercent: 100 }], /start at 0/],
    [[{ grade: 'A', minPercent: 0, maxPercent: 90 }], /reach 100/],
    [[{ grade: 'A', minPercent: 50, maxPercent: 100 }, { grade: 'B', minPercent: 0, maxPercent: 60 }], /overlap/],
    [[{ grade: 'A', minPercent: 60, maxPercent: 100 }, { grade: 'B', minPercent: 0, maxPercent: 49 }], /Gap/],
    [[{ grade: 'A', minPercent: 50, maxPercent: 100 }, { grade: 'A', minPercent: 0, maxPercent: 49.99 }], /unique/],
  ])('rejects bad scale %#', (scale, msg) => {
    expect(validateScale(scale)).toMatch(msg);
  });
});
