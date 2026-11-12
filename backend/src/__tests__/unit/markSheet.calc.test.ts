import { sheetOutcome, studentResult, type SubjectScore } from '../../modules/exams/exams.calc';

const scale = [{ grade: 'A', minPercent: 50, maxPercent: 100 }, { grade: 'F', minPercent: 0, maxPercent: 49.99 }];
const paper = (subject: string, obtained: number | null, isAbsent = false): SubjectScore =>
  ({ examSubjectId: subject, subject, totalMarks: 100, passingMarks: 40, obtained, isAbsent });

describe('sheetOutcome (Pass / Keep for Retake / Fail)', () => {
  it('passes when no subject is failed', () => {
    expect(sheetOutcome(studentResult([paper('M', 80), paper('E', 40)], scale), 2)).toBe('PASS');
  });
  it('keeps for retake when 1..N subjects are failed', () => {
    expect(sheetOutcome(studentResult([paper('M', 10), paper('E', 90), paper('S', 90)], scale), 2)).toBe('RETAKE');
    expect(sheetOutcome(studentResult([paper('M', 10), paper('E', 10), paper('S', 90)], scale), 2)).toBe('RETAKE');
  });
  it('fails when more than N subjects are failed; an absence counts as a failure', () => {
    expect(sheetOutcome(studentResult([paper('M', 10), paper('E', 10), paper('S', null, true)], scale), 2)).toBe('FAIL');
  });
  it('N = 0 means any failed subject fails the student', () => {
    expect(sheetOutcome(studentResult([paper('M', 10), paper('E', 90)], scale), 0)).toBe('FAIL');
  });
  it('is null until every subject is entered', () => {
    expect(sheetOutcome(studentResult([paper('M', 10), paper('E', null)], scale), 2)).toBeNull();
  });
});
