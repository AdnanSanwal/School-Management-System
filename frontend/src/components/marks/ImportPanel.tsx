'use client';

import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, Download, FileUp, Upload } from 'lucide-react';
import type { MarkSheetView } from '@/lib/marksApi';
import { ABSENT, cellError, cellKey, normaliseInput, type Cell } from './calc';
import { downloadCsv, parseCsv } from './csv';

type Change = { key: string; student: string; subject: string; from: Cell; to: Cell };
type Parsed = { file: string; rows: number; changes: Change[]; errors: string[]; warnings: string[] };

const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const isAdmission = (h: string) => /^adm(ission)?( no| number)?$/.test(norm(h));
const isRoll = (h: string) => /^roll( no| number)?$/.test(norm(h));
const isName = (h: string) => /^(student )?name$/.test(norm(h)) || norm(h) === 'student';

/**
 * CSV import: Admission No. (or Roll No.) + one column per subject. The file is checked and
 * previewed here; applying only fills the grid — nothing is saved until Save Draft.
 */
export function ImportPanel({ data, cells, disabled, onApply }: {
  data: MarkSheetView; cells: Record<string, Cell>; disabled: boolean; onApply: (changes: Record<string, Cell>) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const editable = data.subjects.filter((s) => s.editable);
  const sheetName = `${data.exam.name}-${data.section.className}-${data.section.name}`.replace(/[^\w-]+/g, '_');

  function template() {
    downloadCsv(`marks-${sheetName}.csv`, [
      ['Admission No', 'Roll No', 'Student Name', ...editable.map((s) => `${s.name} (${s.totalMarks})`)],
      ...data.students.map((st) => [st.admissionNo, st.rollNo ?? '', st.name, ...editable.map((s) => cells[cellKey(st.id, s.id)] ?? '')]),
    ]);
  }

  async function read(file: File) {
    if (file.size > 2 * 1024 * 1024) { toast.error('The file is too large (max 2 MB)'); return; }
    if (!/\.csv$/i.test(file.name) && file.type && !/csv|text\/plain|excel/.test(file.type)) { toast.error('Upload a .csv file'); return; }
    const rows = parseCsv(await file.text());
    if (rows.length < 2) { toast.error('The file has no data rows'); return; }
    const [header, ...body] = rows;
    const errors: string[] = [];
    const warnings: string[] = [];
    const admCol = header.findIndex(isAdmission);
    const rollCol = header.findIndex(isRoll);
    if (admCol < 0 && rollCol < 0) {
      setParsed({ file: file.name, rows: body.length, changes: [], errors: ['The first row must have an “Admission No” or “Roll No” column. Download the template to see the format.'], warnings });
      return;
    }
    const cols: { index: number; subject: (typeof editable)[number] }[] = [];
    header.forEach((h, i) => {
      if (i === admCol || i === rollCol || isName(h) || !h.trim()) return;
      const sub = data.subjects.find((s) => norm(s.name) === norm(h));
      if (!sub) warnings.push(`Column “${h}” is not a subject of this exam for ${data.section.className}; it was ignored.`);
      else if (!sub.editable) warnings.push(`You cannot enter ${sub.name} marks in this section; that column was ignored.`);
      else cols.push({ index: i, subject: sub });
    });
    if (!cols.length) errors.push('No subject columns found. Column headings must match the subject names (e.g. “Mathematics”).');

    const byAdm = new Map(data.students.map((s) => [s.admissionNo.trim().toLowerCase(), s]));
    const byRoll = new Map(data.students.filter((s) => s.rollNo).map((s) => [s.rollNo!.trim().toLowerCase(), s]));
    const seen = new Set<string>();
    const changes: Change[] = [];
    body.forEach((r, i) => {
      const line = i + 2;
      const adm = admCol >= 0 ? (r[admCol] ?? '').trim() : '';
      const roll = rollCol >= 0 ? (r[rollCol] ?? '').trim() : '';
      const st = (adm && byAdm.get(adm.toLowerCase())) || (roll && byRoll.get(roll.toLowerCase())) || null;
      if (!st) { errors.push(`Row ${line}: no student with ${adm ? `admission no. “${adm}”` : roll ? `roll no. “${roll}”` : 'an admission / roll no.'} in this section.`); return; }
      if (seen.has(st.id)) { errors.push(`Row ${line}: ${st.name} appears more than once.`); return; }
      seen.add(st.id);
      for (const { index, subject } of cols) {
        const raw = (r[index] ?? '').trim();
        if (raw === '') continue; // empty = leave as it is
        const v = normaliseInput(raw);
        const err = v === null ? 'is not a number' : cellError(v, subject) ? `must be between 0 and ${subject.totalMarks} (steps of 0.25)` : null;
        if (err || v === null) { errors.push(`Row ${line}, ${subject.name}: “${raw}” ${err}.`); continue; }
        const key = cellKey(st.id, subject.id);
        const from = cells[key] ?? '';
        const numeric = (c: Cell) => c !== '' && c !== ABSENT;
        const same = from === v || (numeric(from) && numeric(v) && Number(from) === Number(v));
        if (!same) changes.push({ key, student: st.name, subject: subject.name, from, to: v });
      }
    });
    const missing = data.students.filter((s) => !seen.has(s.id)).length;
    if (missing) warnings.push(`${missing} student${missing === 1 ? ' is' : 's are'} not in the file; their marks stay as they are.`);
    setParsed({ file: file.name, rows: body.length, changes, errors, warnings });
  }

  function apply() {
    if (!parsed?.changes.length) return;
    onApply(Object.fromEntries(parsed.changes.map((c) => [c.key, c.to])));
    toast.success(`${parsed.changes.length} mark${parsed.changes.length === 1 ? '' : 's'} filled in from ${parsed.file}. Review them, then Save Draft.`);
    setParsed(null);
  }

  if (disabled) return <p className="rounded-xl bg-slate-50 p-4 text-sm text-gray-500">The sheet is read-only, so marks cannot be imported. You can still download the sheet as CSV.<button type="button" className="ml-2 text-primary-600 hover:underline" onClick={template}>Download CSV</button></p>;

  return (
    <div className="space-y-3 rounded-2xl border border-gray-100 bg-slate-50/60 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-secondary" onClick={template}><Download className="h-4 w-4" /> Download template</button>
        <button type="button" className="btn-primary" onClick={() => fileRef.current?.click()}><FileUp className="h-4 w-4" /> Choose CSV file</button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) read(f).catch(() => toast.error('Could not read the file')); }} />
        <p className="text-xs text-gray-500">Columns: Admission No (or Roll No) and one column per subject. Use AB for absent; empty cells are left unchanged.</p>
      </div>

      {parsed && (
        <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-3">
          <p className="text-sm font-medium text-gray-900">
            {parsed.file}: {parsed.rows} row{parsed.rows === 1 ? '' : 's'}, {parsed.changes.length} change{parsed.changes.length === 1 ? '' : 's'}
            {parsed.errors.length ? `, ${parsed.errors.length} error${parsed.errors.length === 1 ? '' : 's'}` : ''}
          </p>
          {parsed.errors.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {parsed.errors.map((e) => <li key={e} className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />{e}</li>)}
            </ul>
          )}
          {parsed.warnings.length > 0 && (
            <ul className="space-y-1 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{parsed.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          )}
          {parsed.changes.length > 0 && (
            <div className="max-h-60 overflow-y-auto rounded-lg border border-gray-100">
              <table className="table">
                <thead><tr><th>Student</th><th>Subject</th><th className="text-center">Now</th><th className="text-center">From file</th></tr></thead>
                <tbody>
                  {parsed.changes.map((c) => (
                    <tr key={c.key}><td>{c.student}</td><td>{c.subject}</td><td className="text-center text-gray-400">{c.from || '—'}</td><td className="text-center font-semibold">{c.to}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {parsed.errors.length > 0 && parsed.changes.length > 0 && <span className="text-xs text-gray-500">Rows and cells with errors are skipped.</span>}
            <button type="button" className="btn-secondary" onClick={() => setParsed(null)}>Cancel</button>
            <button type="button" className="btn-primary" disabled={!parsed.changes.length} onClick={apply}>
              <Upload className="h-4 w-4" /> Apply {parsed.changes.length} mark{parsed.changes.length === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
