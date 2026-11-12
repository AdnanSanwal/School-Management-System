'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { Zap } from 'lucide-react';
import type { SheetSubject } from '@/lib/marksApi';
import { ABSENT, cellError, cellKey, normaliseInput, type Cell } from './calc';

type Action = 'absent' | 'clear' | 'set';

/** Changes many cells at once for the ticked students. Nothing is saved until Save Draft. */
export function BulkPanel({ subjects, selected, disabled, onApply }: {
  subjects: SheetSubject[]; selected: string[]; disabled: boolean; onApply: (changes: Record<string, Cell>) => void;
}) {
  const [action, setAction] = useState<Action>('absent');
  const [subjectId, setSubjectId] = useState<string>('all');
  const [value, setValue] = useState('');

  const target = subjectId === 'all' ? subjects : subjects.filter((s) => s.id === subjectId);
  const needsSubject = action === 'set' && subjectId === 'all';
  const valueError = action === 'set' && target[0] ? (value === '' ? 'Enter marks' : value === ABSENT ? 'Use “Mark absent”' : cellError(value, target[0])) : null;

  function apply() {
    if (disabled) return;
    if (!selected.length) { toast.error('Tick the students first (checkbox column)'); return; }
    if (needsSubject) { toast.error('Choose the subject to set marks for'); return; }
    if (valueError) { toast.error(valueError === `0–${target[0]?.totalMarks}` ? `Marks must be between 0 and ${target[0]?.totalMarks}` : valueError); return; }
    const changes: Record<string, Cell> = {};
    const v: Cell = action === 'absent' ? ABSENT : action === 'clear' ? '' : value;
    for (const st of selected) for (const s of target) changes[cellKey(st, s.id)] = v;
    onApply(changes);
    const what = action === 'absent' ? 'marked absent' : action === 'clear' ? 'cleared' : `set to ${value}`;
    toast.success(`${selected.length} student${selected.length === 1 ? '' : 's'} ${what}${subjectId === 'all' ? ' in all subjects' : ` in ${target[0]?.name}`}. Save the draft to keep it.`);
  }

  if (disabled) return <p className="rounded-xl bg-slate-50 p-4 text-sm text-gray-500">The sheet is read-only, so bulk actions are not available.</p>;

  return (
    <div className="rounded-2xl border border-gray-100 bg-slate-50/60 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="label">Action</span>
          <select className="select w-48" value={action} onChange={(e) => setAction(e.target.value as Action)}>
            <option value="absent">Mark absent</option>
            <option value="clear">Clear marks</option>
            <option value="set">Set the same marks</option>
          </select>
        </label>
        <label className="block">
          <span className="label">Subject</span>
          <select className="select w-56" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="all">{action === 'set' ? 'Choose subject…' : 'All subjects you can edit'}</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.totalMarks})</option>)}
          </select>
        </label>
        {action === 'set' && (
          <label className="block">
            <span className="label">Marks</span>
            <input className={`input w-28 ${value && valueError ? 'input-error' : ''}`} inputMode="decimal" value={value}
              onChange={(e) => { const v = normaliseInput(e.target.value); if (v !== null && v !== ABSENT) setValue(v); }} />
          </label>
        )}
        <button type="button" className="btn-primary" onClick={apply}>
          <Zap className="h-4 w-4" /> Apply to {selected.length} selected
        </button>
      </div>
      {action === 'set' && value && valueError && !needsSubject && <p className="mt-2 text-xs text-red-600">{valueError === `0–${target[0]?.totalMarks}` ? `Marks must be between 0 and ${target[0]?.totalMarks}` : valueError}</p>}
      <p className="mt-2 text-xs text-gray-500">Tick students in the table below, choose an action, then Save Draft. Only subjects you may edit are listed.</p>
    </div>
  );
}
