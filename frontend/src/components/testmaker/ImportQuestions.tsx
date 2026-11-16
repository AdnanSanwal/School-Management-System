'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Field, Modal } from '@/components/ui/kit';
import { testmakerAPI } from '@/lib/api';

const COLUMNS = ['type', 'question_en', 'question_ur', 'marks', 'a', 'b', 'c', 'd', 'answer', 'a_ur', 'b_ur', 'c_ur', 'd_ur', 'answer_ur'];
const TEMPLATE = [
  COLUMNS.join(','),
  'MCQ,What is 2 + 2?,,1,3,4,5,6,B,,,,,',
  'TRUE_FALSE,Zero is a natural number.,,1,,,,,false,,,,,',
  'BLANK,The square root of 49 is ____.,,1,,,,,7,,,,,',
  'SHORT,Define a rational number.,ناطق عدد کی تعریف کریں۔,2,,,,,,,,,,',
  'LONG,Prove that the square root of 2 is irrational.,,8,,,,,,,,,,',
].join('\n');

/** Splits pasted spreadsheet text (commas or tabs, with "quoted, cells") into rows of cells. */
export function parseTable(text: string): string[][] {
  const delimiter = text.split('\n')[0].includes('\t') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

/** Turns spreadsheet rows into questions. Returns problems by row number instead of throwing. */
export function rowsToQuestions(table: string[][]): { rows: any[]; problems: string[] } {
  if (table.length < 2) return { rows: [], problems: ['Paste the heading row and at least one question.'] };
  const head = table[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  if (!head.includes('type') || (!head.includes('question_en') && !head.includes('question_ur'))) {
    return { rows: [], problems: ['The first row must be the headings, including "type" and "question_en" or "question_ur".'] };
  }
  const problems: string[] = [];
  const rows = table.slice(1).map((cells, i) => {
    const v = (name: string) => (cells[head.indexOf(name)] ?? '').trim();
    const type = v('type').toUpperCase().replace(/[\s/-]+/g, '_');
    const base: any = { type, textEn: v('question_en') || null, textUr: v('question_ur') || null, marks: Number(v('marks')) || 1 };
    const words = (en: string, ur: string) => ({ ...(en ? { en } : {}), ...(ur ? { ur } : {}) });
    if (type === 'MCQ') {
      const letters = ['a', 'b', 'c', 'd'].filter((l) => v(l) || v(`${l}_ur`));
      base.options = letters.map((l) => words(v(l), v(`${l}_ur`)));
      const index = letters.indexOf(v('answer').toLowerCase());
      if (index < 0) problems.push(`Row ${i + 2}: the answer must be the letter of the correct choice (A to D).`);
      base.answer = { index: Math.max(index, 0) };
    } else if (type === 'TRUE_FALSE') {
      const a = v('answer').toLowerCase();
      if (!['true', 'false', 't', 'f'].includes(a)) problems.push(`Row ${i + 2}: the answer must be true or false.`);
      base.answer = { value: a.startsWith('t') };
    } else if (type === 'MATCH') {
      problems.push(`Row ${i + 2}: matching questions cannot be imported; add them one at a time.`);
    } else {
      const answer = words(v('answer'), v('answer_ur'));
      if (answer.en || answer.ur) base.answer = answer;
    }
    return base;
  });
  return { rows, problems };
}

export function ImportQuestions({ chapters, chapterId, onClose, onDone }: { chapters: { id: string; number: number; name: string }[]; chapterId: string; onClose: () => void; onDone: () => void }) {
  const [chapter, setChapter] = useState(chapterId || chapters[0]?.id || '');
  const [text, setText] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const send = useMutation({
    mutationFn: (rows: any[]) => testmakerAPI.importQuestions(chapter, rows),
    onSuccess: (r) => { toast.success(r.message); onDone(); },
    onError: (e: any) => {
      const errors: { row: number; message: string }[] = e?.response?.data?.errors ?? [];
      setProblems(errors.length ? errors.map((x) => `Row ${x.row + 1}: ${x.message}`) : [e?.response?.data?.message ?? 'Could not import']);
    },
  });
  const submit = () => {
    const { rows, problems: found } = rowsToQuestions(parseTable(text));
    setProblems(found);
    if (!found.length && rows.length) send.mutate(rows);
  };
  const readFile = (file?: File) => { if (file) file.text().then(setText); };

  return (
    <Modal open onClose={onClose} title="Import questions from a spreadsheet" wide>
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          Copy the rows from Excel or Google Sheets and paste them below, or choose a .csv file. The first row must be the headings.
          Either every row is imported, or none: fix the rows listed and try again.{' '}
          <a className="text-primary-600 hover:underline" download="question-import-template.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent('﻿' + TEMPLATE)}`}>Download a template</a>
        </p>
        <Field label="Into chapter">
          <select className="select" value={chapter} onChange={(e) => setChapter(e.target.value)}>
            {chapters.map((c) => <option key={c.id} value={c.id}>{c.number}. {c.name}</option>)}
          </select>
        </Field>
        <Field label="Rows" hint={`Headings: ${COLUMNS.join(', ')}`}>
          <textarea className="input min-h-[160px] font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder={TEMPLATE} />
        </Field>
        <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => readFile(e.target.files?.[0])} aria-label="Choose a CSV file" className="text-sm" />
        {problems.length > 0 && (
          <ul className="max-h-40 list-disc space-y-0.5 overflow-y-auto rounded-xl border border-red-200 bg-red-50 py-2 pl-8 pr-3 text-sm text-red-700" role="alert">
            {problems.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
          <button className="btn btn-primary" disabled={send.isPending || !text.trim() || !chapter} onClick={submit}>Import</button>
        </div>
      </div>
    </Modal>
  );
}
