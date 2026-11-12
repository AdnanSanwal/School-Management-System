import { api } from '@/lib/api';

// Marks entry dashboard (CR-07): one sheet per exam × section with every subject.

/** Unwraps `{ success, data }` responses (same as the helper in api.ts). */
const data = <T = unknown>(p: Promise<{ data: { data: T } }>) => p.then((r) => r.data.data);

export type SheetOutcome = 'PASS' | 'RETAKE' | 'FAIL';
export type MarkSheetStatus = 'DRAFT' | 'SUBMITTED';
export type ExamStatus = 'DRAFT' | 'SCHEDULED' | 'PUBLISHED';

export type GradeBand = { grade: string; minPercent: number; maxPercent: number; remark?: string | null };

export type MarksOptions = {
  years: { id: string; name: string; isCurrent: boolean }[];
  academicYearId: string | null;
  exams: {
    id: string; name: string; status: ExamStatus;
    classes: { id: string; name: string; level: number; sections: { id: string; name: string; sheetStatus: MarkSheetStatus | null }[] }[];
  }[];
  retakeMaxSubjects: number;
  canManage: boolean;
};

export type SheetSubject = { id: string; subjectId: string; name: string; totalMarks: number; passingMarks: number; date: string | null; editable: boolean };
export type SheetStudent = {
  id: string; name: string; admissionNo: string; rollNo: string | null;
  marks: Record<string, { obtained: number | null; isAbsent: boolean }>;
  total: number; maxMarks: number; percent: number | null; grade: string | null; complete: boolean;
  failedSubjects: string[]; outcome: SheetOutcome | null; position: number | null;
};
export type MarkSheetView = {
  exam: { id: string; name: string; status: ExamStatus; academicYear: string };
  section: { id: string; name: string; classId: string; className: string };
  sheet: { id: string | null; status: MarkSheetStatus; remarks: string; submittedAt: string | null; submittedBy: string | null; updatedAt: string | null };
  subjects: SheetSubject[];
  students: SheetStudent[];
  scale: GradeBand[];
  retakeMaxSubjects: number;
  summary: { students: number; passed: number; failed: number; retake: number; pending: number };
  permissions: { canEdit: boolean; canSubmit: boolean; canReopen: boolean; lockReason: string | null };
};

export type SheetEntry = { studentId: string; examSubjectId: string; obtained: number | null; isAbsent: boolean };
export type SaveSheetBody = { sectionId: string; remarks?: string | null; entries: SheetEntry[] };
export type SaveSheetResult = { saved: number; cleared: number; sheetId: string; status: MarkSheetStatus };

export const marksAPI = {
  options: (academicYearId?: string) =>
    data<MarksOptions>(api.get('/exams/marks/options', { params: academicYearId ? { academicYearId } : {} })),
  sheet: (examId: string, sectionId: string) => data<MarkSheetView>(api.get(`/exams/${examId}/sheet`, { params: { sectionId } })),
  saveDraft: (examId: string, body: SaveSheetBody) => data<SaveSheetResult>(api.put(`/exams/${examId}/sheet`, body)),
  submit: (examId: string, body: SaveSheetBody) => data<SaveSheetResult>(api.post(`/exams/${examId}/sheet/submit`, body)),
  reopen: (examId: string, sectionId: string) => data<{ status: MarkSheetStatus }>(api.post(`/exams/${examId}/sheet/reopen`, { sectionId })),
  saveSettings: (retakeMaxSubjects: number) =>
    data<{ retakeMaxSubjects: number }>(api.patch('/exams/marks/settings', { retakeMaxSubjects })),
};
