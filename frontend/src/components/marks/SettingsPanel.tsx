'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Save } from 'lucide-react';
import { apiError } from '@/lib/api';
import { marksAPI, type GradeBand } from '@/lib/marksApi';

/** School-wide retake rule (exam managers can change it) and the grade scale in use. */
export function SettingsPanel({ retakeMax, scale, canManage, onSaved }: {
  retakeMax: number; scale: GradeBand[]; canManage: boolean; onSaved: (n: number) => void;
}) {
  const qc = useQueryClient();
  const [value, setValue] = useState(String(retakeMax));
  const n = Number(value);
  const error = value.trim() === '' ? 'Enter a number' : !Number.isInteger(n) ? 'Whole numbers only' : n < 0 ? 'Cannot be negative' : n > 20 ? 'Cannot be more than 20' : null;

  const save = useMutation({
    mutationFn: () => marksAPI.saveSettings(n),
    onSuccess: (r) => {
      toast.success('Retake rule saved');
      onSaved(r.retakeMaxSubjects);
      qc.invalidateQueries({ queryKey: ['marks-options'] });
      // Other loaded sheets show the new rule next time they are opened (without losing edits here).
      qc.invalidateQueries({ queryKey: ['mark-sheet'], refetchType: 'none' });
    },
    onError: (e) => toast.error(apiError(e, 'Could not save the setting')),
  });

  return (
    <div className="grid gap-4 rounded-2xl border border-gray-100 bg-slate-50/60 p-4 lg:grid-cols-2">
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (!error && n !== retakeMax) save.mutate(); }}>
        <p className="font-medium text-gray-900">Keep for Retake rule</p>
        <p className="text-sm text-gray-600">
          A student who fails no subject passes. Failing up to <b>N</b> subjects means <b>keep for retake</b>; failing more than N means <b>fail</b>.
          An absent subject counts as failed. This applies to the whole school.
        </p>
        <div className="flex items-start gap-2">
          <label className="block">
            <span className="label">N (subjects)</span>
            <input className={`input w-28 ${error ? 'input-error' : ''}`} inputMode="numeric" value={value} disabled={!canManage}
              onChange={(e) => /^\d{0,2}$/.test(e.target.value) && setValue(e.target.value)} aria-invalid={!!error} />
            {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
          </label>
          {canManage && (
            <button className="btn-primary mt-7" disabled={!!error || n === retakeMax || save.isPending}>
              <Save className="h-4 w-4" /> {save.isPending ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
        {!canManage && <p className="text-xs text-gray-500">Only the principal or office (exam managers) can change this.</p>}
      </form>
      <div className="space-y-2">
        <p className="font-medium text-gray-900">Grade scale</p>
        {scale.length ? (
          <div className="flex flex-wrap gap-2">
            {scale.map((g) => (
              <span key={g.grade} className="badge badge-indigo">{g.grade}: {g.minPercent}–{g.maxPercent}%</span>
            ))}
          </div>
        ) : <p className="text-sm text-amber-700">No grade scale is set, so grades stay empty.</p>}
        <p className="text-xs text-gray-500">
          Pass marks come from each subject in the exam&apos;s date sheet.
          {canManage && <> Change the grade scale and pass marks under <Link href="/exams" className="text-primary-600 hover:underline">Exams &amp; results</Link>.</>}
        </p>
      </div>
    </div>
  );
}
