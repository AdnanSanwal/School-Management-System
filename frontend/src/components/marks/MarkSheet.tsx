'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Calculator, Check, CheckCircle2, Eye, Grid3X3, Lock, RefreshCw, RotateCcw, Save, Settings, Upload, XCircle, Zap,
} from 'lucide-react';
import { Modal } from '@/components/ui/kit';
import { apiError } from '@/lib/api';
import { marksAPI, type MarkSheetView, type SheetEntry } from '@/lib/marksApi';
import { cn, formatDateTime } from '@/lib/utils';
import { ABSENT, OUTCOME, cellError, cellKey, normaliseInput, rowResult, type Cell, type RowResult } from './calc';
import { ImportPanel } from './ImportPanel';
import { BulkPanel } from './BulkPanel';
import { SettingsPanel } from './SettingsPanel';

export type SheetTab = 'enter' | 'import' | 'bulk' | 'settings';

const TABS: { id: SheetTab; label: string; icon: React.ElementType }[] = [
  { id: 'enter', label: 'Enter Marks', icon: Grid3X3 },
  { id: 'import', label: 'Import Marks', icon: Upload },
  { id: 'bulk', label: 'Bulk Actions', icon: Zap },
  { id: 'settings', label: 'Settings', icon: Settings },
];

function initialCells(d: MarkSheetView) {
  const cells: Record<string, Cell> = {};
  for (const st of d.students) {
    for (const sub of d.subjects) {
      const m = st.marks[sub.id];
      cells[cellKey(st.id, sub.id)] = m?.isAbsent ? ABSENT : m?.obtained != null ? String(m.obtained) : '';
    }
  }
  return cells;
}

/**
 * The marks sheet for one exam × section: every subject at once, live totals, grade and
 * Pass / Keep for Retake / Fail, import, bulk actions, draft → submit → reopen.
 * Mounted fresh (keyed) each time the sheet is (re)loaded from the server.
 */
export function MarkSheet({ data, canManage, tab, onTab, onSaved, onDirty }: {
  data: MarkSheetView;
  canManage: boolean;
  tab: SheetTab;
  onTab: (t: SheetTab) => void;
  /** Called after a successful save / submit / reopen / settings change, to reload the sheet. */
  onSaved: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [initial] = useState(() => initialCells(data));
  const [cells, setCells] = useState<Record<string, Cell>>(initial);
  const [remarks, setRemarks] = useState(data.sheet.remarks ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showErrors, setShowErrors] = useState(false);
  const [preview, setPreview] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [retakeMax, setRetakeMax] = useState(data.retakeMaxSubjects);
  const tableRef = useRef<HTMLTableElement>(null);

  const editable = data.permissions.canEdit;
  const { subjects, students, scale } = data;
  const editableSubjects = subjects.filter((s) => s.editable);

  const results = useMemo(() => {
    const map = new Map<string, RowResult>();
    for (const st of students) map.set(st.id, rowResult(subjects.map((s) => cells[cellKey(st.id, s.id)] ?? ''), subjects, scale, retakeMax));
    return map;
  }, [cells, students, subjects, scale, retakeMax]);

  const counts = useMemo(() => {
    const rs = [...results.values()];
    return {
      passed: rs.filter((r) => r.outcome === 'PASS').length,
      failed: rs.filter((r) => r.outcome === 'FAIL').length,
      retake: rs.filter((r) => r.outcome === 'RETAKE').length,
      pending: rs.filter((r) => r.outcome === null).length,
      invalid: rs.reduce((n, r) => n + r.invalid, 0),
    };
  }, [results]);

  const missing = useMemo(
    () => students.reduce((n, st) => n + subjects.filter((s) => (cells[cellKey(st.id, s.id)] ?? '') === '').length, 0),
    [cells, students, subjects],
  );
  const dirty = useMemo(
    () => remarks !== (data.sheet.remarks ?? '') || Object.keys(cells).some((k) => cells[k] !== initial[k]),
    [cells, initial, remarks, data.sheet.remarks],
  );
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const setCell = (key: string, value: Cell) => setCells((c) => ({ ...c, [key]: value }));
  const applyCells = (changes: Record<string, Cell>) => setCells((c) => ({ ...c, ...changes }));

  /** Entries for every subject this user may edit (the server only writes what changed). */
  function entries(): SheetEntry[] {
    return students.flatMap((st) => editableSubjects.map((s) => {
      const c = cells[cellKey(st.id, s.id)] ?? '';
      return { studentId: st.id, examSubjectId: s.id, isAbsent: c === ABSENT, obtained: c === '' || c === ABSENT ? null : Number(c) };
    }));
  }

  function validate() {
    if (counts.invalid) {
      setShowErrors(true);
      toast.error(`${counts.invalid} mark${counts.invalid === 1 ? ' is' : 's are'} invalid. Fix the highlighted cells first.`);
      return false;
    }
    return true;
  }

  const body = () => ({ sectionId: data.section.id, remarks: remarks.trim() || null, entries: entries() });

  const save = useMutation({
    mutationFn: () => marksAPI.saveDraft(data.exam.id, body()),
    onSuccess: (r) => { toast.success(`Draft saved${r.saved || r.cleared ? ` (${r.saved} updated${r.cleared ? `, ${r.cleared} cleared` : ''})` : ''}`); onSaved(); },
    onError: (e) => toast.error(apiError(e, 'Could not save the draft')),
  });
  const submit = useMutation({
    mutationFn: () => marksAPI.submit(data.exam.id, body()),
    onSuccess: () => { toast.success('Marks submitted. The sheet is now read-only.'); setConfirmSubmit(false); onSaved(); },
    onError: (e) => toast.error(apiError(e, 'Could not submit the marks')),
  });
  const reopen = useMutation({
    mutationFn: () => marksAPI.reopen(data.exam.id, data.section.id),
    onSuccess: () => { toast.success('Marks reopened for editing'); onSaved(); },
    onError: (e) => toast.error(apiError(e, 'Could not reopen the marks')),
  });
  const busy = save.isPending || submit.isPending || reopen.isPending;

  function autoCalculate() {
    setShowErrors(true);
    if (counts.invalid) { toast.error(`${counts.invalid} invalid mark${counts.invalid === 1 ? '' : 's'} highlighted`); return; }
    toast.success(`Calculated: ${counts.passed} pass, ${counts.retake} retake, ${counts.failed} fail${counts.pending ? `, ${counts.pending} incomplete` : ''}`);
  }

  function trySubmit() {
    if (!validate()) return;
    if (missing) {
      setShowErrors(true);
      toast.error(`${missing} mark${missing === 1 ? ' is' : 's are'} still empty. Enter every subject (or AB for absent) before submitting.`);
      return;
    }
    setConfirmSubmit(true);
  }

  function moveFocus(row: number, col: number) {
    const el = tableRef.current?.querySelector<HTMLInputElement>(`input[data-cell="${row}:${col}"]`);
    if (el) { el.focus(); el.select(); }
  }

  const allSelected = students.length > 0 && selected.size === students.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(students.map((s) => s.id)));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-4">
      {/* Status / lock banner */}
      {data.permissions.lockReason ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="flex items-center gap-2">
            <Lock className="h-4 w-4 flex-shrink-0" />
            {data.permissions.lockReason}
            {data.sheet.status === 'SUBMITTED' && data.sheet.submittedAt && (
              <span className="text-amber-700">Submitted{data.sheet.submittedBy ? ` by ${data.sheet.submittedBy}` : ''} on {formatDateTime(data.sheet.submittedAt)}.</span>
            )}
          </span>
          {data.permissions.canReopen && (
            <button type="button" className="btn-secondary py-1.5" disabled={busy} onClick={() => reopen.mutate()}>
              <RotateCcw className="h-4 w-4" /> Reopen for editing
            </button>
          )}
        </div>
      ) : null}

      <div className="card space-y-4 p-4 sm:p-5">
        {/* Action tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Marks actions">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => onTab(t.id)}
                className={cn(tab === t.id ? 'btn-primary' : 'btn-secondary', 'py-2')}>
                <t.icon className="h-4 w-4" /> {t.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {dirty && <span className="badge badge-yellow">Unsaved changes</span>}
            <button type="button" className="btn-secondary py-2 text-primary-700" onClick={autoCalculate}>
              <Calculator className="h-4 w-4" /> Auto Calculate
            </button>
          </div>
        </div>

        {tab === 'import' && (
          <ImportPanel data={data} cells={cells} disabled={!editable} onApply={(changes) => { applyCells(changes); setShowErrors(true); onTab('enter'); }} />
        )}
        {tab === 'bulk' && (
          <BulkPanel subjects={editableSubjects} selected={[...selected]} disabled={!editable}
            onApply={(changes) => { applyCells(changes); setShowErrors(true); }} />
        )}
        {tab === 'settings' && (
          <SettingsPanel retakeMax={retakeMax} scale={scale} canManage={canManage}
            onSaved={setRetakeMax} />
        )}

        {/* Marks table */}
        <div className="table-container">
          <table className="table" ref={tableRef}>
            <thead>
              <tr>
                <th className="w-10">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all students" disabled={!students.length} />
                </th>
                <th className="w-10">#</th>
                <th>Student name</th>
                <th>Roll no.</th>
                {subjects.map((s) => (
                  <th key={s.id} className="text-center" title={`Pass mark ${s.passingMarks}${s.editable ? '' : ' · read-only for you'}`}>
                    <div className="leading-tight">{s.name}</div>
                    <div className="text-xs font-normal text-gray-500">({s.totalMarks}){!s.editable && <Lock className="ml-1 inline h-3 w-3" />}</div>
                  </th>
                ))}
                <th className="text-center">Total</th>
                <th className="text-center">Grade</th>
                <th className="text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {students.length === 0 && (
                <tr><td colSpan={subjects.length + 7} className="py-10 text-center text-sm text-gray-500">No active students in this section.</td></tr>
              )}
              {students.map((st, row) => {
                const r = results.get(st.id)!;
                return (
                  <tr key={st.id} className={cn(selected.has(st.id) && 'bg-primary-50/40')}>
                    <td><input type="checkbox" checked={selected.has(st.id)} onChange={() => toggle(st.id)} aria-label={`Select ${st.name}`} /></td>
                    <td className="text-gray-400">{row + 1}</td>
                    <td className="whitespace-nowrap font-medium">{st.name}</td>
                    <td className="whitespace-nowrap text-gray-600">{st.rollNo || st.admissionNo}</td>
                    {subjects.map((s, col) => {
                      const key = cellKey(st.id, s.id);
                      const c = cells[key] ?? '';
                      const err = cellError(c, s);
                      const failing = !err && c !== '' && (c === ABSENT || Number(c) < s.passingMarks);
                      const empty = showErrors && c === '';
                      const disabled = !editable || !s.editable;
                      return (
                        <td key={s.id} className="text-center align-top">
                          <input
                            data-cell={`${row}:${col}`}
                            type="text" inputMode="decimal" autoComplete="off"
                            className={cn('input w-20 px-2 py-1.5 text-center', err && 'input-error', empty && !disabled && 'border-amber-300',
                              failing && 'text-red-600', c === ABSENT && 'font-semibold', disabled && 'bg-slate-50 text-gray-500')}
                            value={c} disabled={disabled}
                            placeholder={disabled ? '' : '–'}
                            aria-label={`${s.name} marks for ${st.name}`} aria-invalid={!!err}
                            title={err ?? (failing ? `Below pass mark (${s.passingMarks})` : 'Type marks, or AB for absent')}
                            onChange={(e) => {
                              const v = normaliseInput(e.target.value);
                              if (v === null) { toast.error('Only numbers (or AB for absent) are allowed', { id: 'marks-input' }); return; }
                              setCell(key, v);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); moveFocus(row + 1, col); }
                              else if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(row - 1, col); }
                            }}
                          />
                          {err && <p className="mt-0.5 text-[11px] font-medium text-red-600">{err}</p>}
                        </td>
                      );
                    })}
                    <td className="text-center">
                      <span className={cn('badge', r.complete ? 'badge-green' : 'badge-gray')}>{r.total}</span>
                    </td>
                    <td className="text-center">
                      {r.grade ? <span className={cn('badge', r.outcome === 'FAIL' ? 'badge-red' : r.outcome === 'RETAKE' ? 'badge-yellow' : 'badge-indigo')}>{r.grade}</span> : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="text-center">
                      {r.outcome ? (
                        <span className={cn('badge', OUTCOME[r.outcome].cls)} title={r.failed.length ? `Failed: ${r.failed.join(', ')}` : undefined}>
                          {r.outcome === 'PASS' ? <CheckCircle2 className="h-3.5 w-3.5" /> : r.outcome === 'FAIL' ? <XCircle className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
                          {OUTCOME[r.outcome].label}
                        </span>
                      ) : <span className="badge badge-gray">{r.invalid ? 'Invalid' : 'Pending'}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {editable && <p className="text-xs text-gray-500">Type AB for absent. Enter / ↓ moves to the next student. Red marks are below the pass mark.</p>}

        {/* Summary + remarks */}
        <div className="grid gap-4 lg:grid-cols-2">
          <SummaryCounts passed={counts.passed} failed={counts.failed} retake={counts.retake} pending={counts.pending} retakeMax={retakeMax} />
          <label className="block">
            <span className="label">Remarks (optional)</span>
            <textarea className="input min-h-[88px]" maxLength={2000} placeholder="Add any remarks…" value={remarks}
              disabled={!editable} onChange={(e) => setRemarks(e.target.value)} />
          </label>
        </div>
      </div>

      {/* Bottom actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="btn-secondary" onClick={() => { if (counts.invalid) setShowErrors(true); setPreview(true); }}>
          <Eye className="h-4 w-4" /> Preview Result
        </button>
        {editable && (
          <div className="flex flex-wrap gap-3">
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => validate() && save.mutate()}>
              <Save className="h-4 w-4" /> {save.isPending ? 'Saving…' : 'Save Draft'}
            </button>
            <button type="button" className="btn-primary" disabled={busy} onClick={trySubmit}>
              <Check className="h-4 w-4" /> Submit Marks
            </button>
          </div>
        )}
      </div>

      <Modal open={preview} onClose={() => setPreview(false)} title={`Result preview · ${data.exam.name} · ${data.section.className}-${data.section.name}`} wide>
        <ResultPreview data={data} results={results} remarks={remarks} counts={counts} retakeMax={retakeMax} />
      </Modal>

      <Modal open={confirmSubmit} onClose={() => !submit.isPending && setConfirmSubmit(false)} title="Submit marks?">
        <div className="space-y-4 text-sm text-gray-700">
          <p>
            You are submitting {data.exam.name} marks for <b>{data.section.className}-{data.section.name}</b> ({students.length} students):{' '}
            {counts.passed} pass, {counts.retake} keep for retake, {counts.failed} fail.
          </p>
          <p className="rounded-xl bg-amber-50 p-3 text-amber-800">After submitting, the sheet becomes read-only. Only an exam manager (principal / office) can reopen it.</p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" disabled={submit.isPending} onClick={() => setConfirmSubmit(false)}>Cancel</button>
            <button type="button" className="btn-primary" disabled={submit.isPending} onClick={() => submit.mutate()}>
              <Check className="h-4 w-4" /> {submit.isPending ? 'Submitting…' : 'Submit marks'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function SummaryCounts({ passed, failed, retake, pending, retakeMax }: { passed: number; failed: number; retake: number; pending: number; retakeMax: number }) {
  const items = [
    { label: 'Passed', value: passed, icon: CheckCircle2, cls: 'text-emerald-600' },
    { label: 'Failed', value: failed, icon: XCircle, cls: 'text-red-600' },
    { label: 'Keep for Retake', value: retake, icon: RefreshCw, cls: 'text-amber-600' },
  ];
  return (
    <div className="rounded-2xl border border-gray-100 bg-slate-50/60 p-4">
      <div className="grid grid-cols-3 divide-x divide-gray-200">
        {items.map((i) => (
          <div key={i.label} className="flex items-start gap-2 px-3 first:pl-0">
            <i.icon className={cn('mt-0.5 h-5 w-5 flex-shrink-0', i.cls)} />
            <div>
              <p className="text-sm text-gray-600">{i.label}</p>
              <p className="text-xl font-bold text-gray-900">{i.value}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-gray-500">
        {pending ? `${pending} student${pending === 1 ? '' : 's'} still incomplete. ` : ''}
        Failing 1–{retakeMax} subject{retakeMax === 1 ? '' : 's'} = keep for retake; more = fail{retakeMax === 0 ? ' (retake is off)' : ''}.
      </p>
    </div>
  );
}

function ResultPreview({ data, results, remarks, counts, retakeMax }: {
  data: MarkSheetView; results: Map<string, RowResult>; remarks: string;
  counts: { passed: number; failed: number; retake: number; pending: number; invalid: number }; retakeMax: number;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        {data.exam.academicYear} · {data.students.length} students · Read-only preview of the marks as they are on screen (not yet saved changes included).
      </p>
      {counts.invalid > 0 && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{counts.invalid} invalid mark(s) are not counted. Fix them before submitting.</p>}
      <div className="table-container max-h-[55vh] overflow-y-auto">
        <table className="table">
          <thead>
            <tr><th>#</th><th>Student</th><th className="text-center">Total</th><th className="text-center">%</th><th className="text-center">Grade</th><th className="text-center">Status</th><th>Failed subjects</th></tr>
          </thead>
          <tbody>
            {data.students.map((st, i) => {
              const r = results.get(st.id)!;
              return (
                <tr key={st.id}>
                  <td className="text-gray-400">{i + 1}</td>
                  <td className="font-medium">{st.name}<span className="ml-1 text-xs text-gray-400">{st.rollNo || st.admissionNo}</span></td>
                  <td className="text-center">{r.total} / {r.maxMarks}</td>
                  <td className="text-center">{r.percent ?? '—'}</td>
                  <td className="text-center">{r.grade ?? '—'}</td>
                  <td className="text-center">{r.outcome ? <span className={cn('badge', OUTCOME[r.outcome].cls)}>{OUTCOME[r.outcome].label}</span> : <span className="badge badge-gray">Pending</span>}</td>
                  <td className="text-xs text-gray-600">{r.failed.join(', ') || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <SummaryCounts passed={counts.passed} failed={counts.failed} retake={counts.retake} pending={counts.pending} retakeMax={retakeMax} />
      {remarks.trim() && (
        <div className="rounded-xl border border-gray-100 p-3 text-sm"><p className="label">Remarks</p><p className="whitespace-pre-wrap text-gray-700">{remarks}</p></div>
      )}
    </div>
  );
}
