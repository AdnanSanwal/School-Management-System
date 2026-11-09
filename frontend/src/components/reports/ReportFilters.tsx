'use client';

import { useQuery } from '@tanstack/react-query';
import { Field, SectionSelect, StudentPicker } from '@/components/ui/kit';
import { academicsAPI } from '@/lib/api';
import { todayIso } from '@/lib/utils';

export type Param = 'dateRange' | 'month' | 'section' | 'class' | 'student' | 'overdue';

/** Every report, its description and the filters it accepts (mirrors backend/src/modules/reports). */
export const REPORT_META: Record<string, { title: string; desc: string; params: Param[] }> = {
  'fee-collection': { title: 'Fee collection', desc: 'Every receipt in a date range, with totals by payment method. Use the same date for a daily report.', params: ['dateRange', 'class', 'student'] },
  'fee-monthly-summary': { title: 'Monthly fee summary', desc: 'Billed, received and still pending, month by month for this academic year.', params: ['class', 'student'] },
  defaulters: { title: 'Defaulter list', desc: 'Students with overdue fee, parent phone numbers and months owed.', params: ['class', 'student', 'overdue'] },
  'student-attendance-register': { title: 'Student attendance register', desc: 'One row per student, one column per school day, with totals.', params: ['section', 'month'] },
  'staff-attendance': { title: 'Teacher attendance', desc: 'Present, late, absent and leave days per staff member for a month.', params: ['month'] },
  'class-strength': { title: 'Class-wise strength', desc: 'Students per section with boys/girls and class teacher.', params: ['class'] },
  leave: { title: 'Leave report', desc: 'All staff leave requests and approved days.', params: ['dateRange'] },
};

export type FilterValues = { from: string; to: string; month: string; sectionId: string; classId: string; student: { id: string; name: string; admissionNo?: string } | null; minDaysOverdue: string };

export function defaultFilters(type: string): FilterValues {
  const today = todayIso();
  // The leave report covers the whole academic year unless dates are picked.
  return { from: type === 'leave' ? '' : today, to: type === 'leave' ? '' : today, month: today.slice(0, 7), sectionId: '', classId: '', student: null, minDaysOverdue: '0' };
}

/** Query parameters for the API from the filter values (only what this report accepts and what's filled). */
export function toParams(type: string, p: FilterValues): Record<string, string | undefined> {
  const has = (x: Param) => REPORT_META[type]?.params.includes(x);
  return {
    ...(has('dateRange') ? { from: p.from || undefined, to: p.to || undefined } : {}),
    ...(has('month') ? { month: p.month } : {}),
    ...(has('section') ? { sectionId: p.sectionId } : {}),
    ...(has('class') && p.classId ? { classId: p.classId } : {}),
    ...(has('student') && p.student ? { studentId: p.student.id } : {}),
    ...(has('overdue') ? { minDaysOverdue: p.minDaysOverdue } : {}),
  };
}

/** Why the report can't run yet, or null. */
export function missingFilter(type: string, p: FilterValues): string | null {
  if (REPORT_META[type]?.params.includes('section') && !p.sectionId) return 'Choose a class section';
  return null;
}

export function ReportFilters({ type, value, onChange }: { type: string; value: FilterValues; onChange: (v: FilterValues) => void }) {
  const params = REPORT_META[type]?.params ?? [];
  const classes = useQuery({ queryKey: ['classes'], queryFn: academicsAPI.classes, enabled: params.includes('class') });
  const p = value;
  const set = (patch: Partial<FilterValues>) => onChange({ ...p, ...patch });
  if (!params.length) return <p className="text-sm text-gray-500">This report has no filters.</p>;
  return (
    <div className="flex flex-wrap items-end gap-3">
      {params.includes('dateRange') && <>
        <Field label="From"><input type="date" className="input" value={p.from} onChange={(e) => set({ from: e.target.value, to: p.to && e.target.value > p.to ? e.target.value : p.to })} /></Field>
        <Field label="To"><input type="date" className="input" min={p.from || undefined} value={p.to} onChange={(e) => set({ to: e.target.value })} /></Field>
      </>}
      {params.includes('month') && <Field label="Month"><input type="month" className="input" value={p.month} onChange={(e) => set({ month: e.target.value })} /></Field>}
      {params.includes('section') && <Field label="Class"><SectionSelect value={p.sectionId} onChange={(v) => set({ sectionId: v })} className="w-44" /></Field>}
      {params.includes('class') && (
        <Field label="Class">
          <select className="select w-40" value={p.classId} onChange={(e) => set({ classId: e.target.value })}>
            <option value="">All classes</option>
            {(classes.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      )}
      {params.includes('student') && (
        <Field label="Student" className="w-72 max-w-full">
          <StudentPicker value={p.student} onChange={(st) => set({ student: st ? { id: st.id, name: st.name, admissionNo: st.admissionNo } : null })} placeholder="All students (search to pick one)" />
        </Field>
      )}
      {params.includes('overdue') && (
        <Field label="Overdue by">
          <select className="select w-40" value={p.minDaysOverdue} onChange={(e) => set({ minDaysOverdue: e.target.value })}>
            <option value="0">Any</option><option value="30">30+ days</option><option value="60">60+ days</option><option value="90">90+ days</option>
          </select>
        </Field>
      )}
    </div>
  );
}
