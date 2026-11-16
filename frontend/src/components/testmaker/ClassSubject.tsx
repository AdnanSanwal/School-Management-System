'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Field } from '@/components/ui/kit';
import { testmakerAPI } from '@/lib/api';

/** The class and subject pickers shared by the bank and the paper wizard. Remembers the last choice. */
export function useClassSubject() {
  const { data: scope } = useQuery({ queryKey: ['testmaker-scope'], queryFn: testmakerAPI.scope });
  const [classId, setClassId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  // A teacher only sees the subjects they teach in the chosen class.
  const subjects = useMemo(() => (scope?.subjects ?? []).filter((s) => !scope?.pairs || scope.pairs.some((p) => p.classId === classId && p.subjectId === s.id)), [scope, classId]);
  useEffect(() => {
    if (!scope) return;
    if (!classId) {
      let saved: { classId?: string; subjectId?: string } = {};
      try { saved = JSON.parse(localStorage.getItem('testmaker-choice') ?? '{}'); } catch { /* first visit */ }
      const cls = scope.classes.find((c) => c.id === saved.classId) ?? scope.classes[0];
      if (cls) { setClassId(cls.id); if (saved.subjectId) setSubjectId(saved.subjectId); }
      return;
    }
    if (!subjects.some((s) => s.id === subjectId)) setSubjectId(subjects[0]?.id ?? '');
  }, [scope, classId, subjectId, subjects]);
  useEffect(() => {
    if (classId && subjectId) { try { localStorage.setItem('testmaker-choice', JSON.stringify({ classId, subjectId })); } catch { /* private window */ } }
  }, [classId, subjectId]);
  return { scope, classId, setClassId, subjectId, setSubjectId, subjects, ready: !!classId && !!subjectId };
}

export function ClassSubjectPickers({ pick }: { pick: ReturnType<typeof useClassSubject> }) {
  return (
    <div className="flex flex-wrap gap-3">
      <Field label="Class">
        <select className="select w-44" value={pick.classId} onChange={(e) => pick.setClassId(e.target.value)}>
          {(pick.scope?.classes ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Subject">
        <select className="select w-52" value={pick.subjectId} onChange={(e) => pick.setSubjectId(e.target.value)}>
          {pick.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Field>
    </div>
  );
}
