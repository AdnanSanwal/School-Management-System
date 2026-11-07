'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowUpCircle } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Field, Spinner, Empty } from '@/components/ui/kit';
import { promotionsAPI, schoolAPI, examsAPI, apiError } from '@/lib/api';
import { CAN } from '@/lib/roles';

type Outcome = 'PROMOTED' | 'RETAINED' | 'GRADUATED' | 'LEFT';
type Decision = { outcome: Outcome; toSectionId: string | null };

const OUTCOME_LABEL: Record<Outcome, string> = { PROMOTED: 'Promote', RETAINED: 'Repeat class', GRADUATED: 'Graduate', LEFT: 'Leaving' };

export default function PromotionsPage() {
  const qc = useQueryClient();
  const years = useQuery({ queryKey: ['years'], queryFn: schoolAPI.years });
  const exams = useQuery({ queryKey: ['exams'], queryFn: examsAPI.list });
  const current = years.data?.find((y: any) => y.isCurrent);
  const nextYears = (years.data ?? []).filter((y: any) => !y.isCurrent && (!current || y.startDate > current.startDate));
  const [toYear, setToYear] = useState('');
  const [examId, setExamId] = useState('');
  const [opts, setOpts] = useState({ makeCurrent: true, copyTeachers: true, copyFeeStructure: true });
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});

  useEffect(() => { if (!toYear && nextYears[0]) setToYear(nextYears[0].id); }, [nextYears, toYear]);

  const preview = useQuery({
    queryKey: ['promotion-preview', toYear, examId],
    queryFn: () => promotionsAPI.preview(toYear, examId || undefined),
    enabled: !!toYear,
    retry: false,
  });
  useEffect(() => {
    if (!preview.data) return;
    const d: Record<string, Decision> = {};
    for (const g of preview.data.classes) for (const s of g.students) d[s.id] = { outcome: s.outcome, toSectionId: s.toSectionId };
    setDecisions(d);
  }, [preview.data]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    Object.values(decisions).forEach((d) => { c[d.outcome] = (c[d.outcome] ?? 0) + 1; });
    return c;
  }, [decisions]);

  const run = useMutation({
    mutationFn: () => promotionsAPI.run({
      toAcademicYearId: toYear, ...opts,
      decisions: Object.entries(decisions).map(([studentId, d]) => ({ studentId, outcome: d.outcome, toSectionId: d.toSectionId })),
    }),
    onSuccess: (r: any) => {
      toast.success(`Done: ${Object.entries(r.counts).map(([k, v]) => `${v} ${String(k).toLowerCase()}`).join(', ')}. Current year: ${r.currentYear}`, { duration: 8000 });
      setToYear('');
      setDecisions({});
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const set = (id: string, patch: Partial<Decision>) => setDecisions((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  const missingSection = Object.values(decisions).some((d) => d.outcome === 'PROMOTED' && !d.toSectionId);
  const total = Object.keys(decisions).length;

  return (
    <DashboardLayout title="Year-end promotion" allowedRoles={CAN.promotion}
      subtitle={current ? `Move students from ${current.name} into the next academic year` : undefined}>
      <div className="card grid gap-3 sm:grid-cols-3">
        <Field label="Promote into" hint={!nextYears.length ? 'Add the next academic year in School settings first' : undefined}>
          <select className="select" value={toYear} onChange={(e) => setToYear(e.target.value)}>
            {!nextYears.length && <option value="">No later year</option>}
            {nextYears.map((y: any) => <option key={y.id} value={y.id}>{y.name}</option>)}
          </select>
        </Field>
        <Field label="Use exam results" hint="Students who failed it are set to repeat the class">
          <select className="select" value={examId} onChange={(e) => setExamId(e.target.value)}>
            <option value="">Don’t use results</option>
            {(exams.data ?? []).filter((x: any) => x.status === 'PUBLISHED').map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        <div className="space-y-1.5 text-sm">
          <span className="label">Also</span>
          {([['makeCurrent', 'Make it the current year'], ['copyTeachers', 'Copy subject teachers'], ['copyFeeStructure', 'Copy fee structure']] as const).map(([k, l]) => (
            <label key={k} className="flex items-center gap-2">
              <input type="checkbox" checked={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} /> {l}
            </label>
          ))}
        </div>
      </div>

      {toYear && (preview.isLoading ? <Spinner /> : preview.error ? <div className="card text-sm text-red-600">{apiError(preview.error)}</div> : preview.data && (
        <>
          {preview.data.alreadyPromoted > 0 && (
            <div className="card border-amber-200 bg-amber-50 text-sm text-amber-800">{preview.data.alreadyPromoted} student(s) are already moved into {preview.data.to.name} and are not listed.</div>
          )}
          {!preview.data.classes.length ? <div className="card"><Empty title="Nobody left to promote" /></div> : preview.data.classes.map((g: any) => (
            <div key={g.class.id} className="card">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="section-title">{g.class.name} → {g.nextClass?.name ?? 'leaves school'}</h3>
                <span className="text-xs text-gray-500">{g.students.length} student(s)</span>
              </div>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr><th>Roll</th><th>Student</th><th>Now</th><th>Decision</th><th>Next year’s section</th></tr></thead>
                  <tbody>
                    {g.students.map((s: any) => {
                      const d = decisions[s.id];
                      if (!d) return null;
                      const options = d.outcome === 'PROMOTED' ? (g.nextClass?.sections ?? []).map((x: any) => ({ id: x.id, label: `${g.nextClass.name}-${x.name}` }))
                        : d.outcome === 'RETAINED' ? g.sections.map((x: any) => ({ id: x.id, label: `${g.class.name}-${x.name}` })) : [];
                      return (
                        <tr key={s.id}>
                          <td>{s.rollNo ?? '—'}</td>
                          <td><p className="font-medium">{s.name}</p><p className="text-xs text-gray-500">{s.admissionNo}{s.failedPercent !== null ? ` · failed (${s.failedPercent}%)` : ''}</p></td>
                          <td className="text-sm">{g.class.name}-{s.section}</td>
                          <td>
                            <select className="select py-1 text-sm" value={d.outcome} aria-label={`Decision for ${s.name}`}
                              onChange={(e) => {
                                const outcome = e.target.value as Outcome;
                                const same = (list: any[]) => list.find((x: any) => x.name === s.section)?.id ?? list[0]?.id ?? null;
                                set(s.id, {
                                  outcome,
                                  toSectionId: outcome === 'PROMOTED' ? same(g.nextClass?.sections ?? []) : outcome === 'RETAINED' ? same(g.sections) : null,
                                });
                              }}>
                              {(Object.keys(OUTCOME_LABEL) as Outcome[]).filter((o) => o !== 'PROMOTED' || g.nextClass).map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
                            </select>
                          </td>
                          <td>
                            {options.length ? (
                              <select className="select py-1 text-sm" value={d.toSectionId ?? ''} aria-label={`Section for ${s.name}`} onChange={(e) => set(s.id, { toSectionId: e.target.value })}>
                                {options.map((o: any) => <option key={o.id} value={o.id}>{o.label}</option>)}
                              </select>
                            ) : <span className="text-sm text-gray-400">{d.outcome === 'PROMOTED' ? 'Next class has no sections' : '—'}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {total > 0 && (
            <div className="card sticky bottom-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-gray-600">
                {total} student(s): {Object.entries(counts).map(([k, v]) => `${v} ${OUTCOME_LABEL[k as Outcome].toLowerCase()}`).join(' · ')}
                {missingSection && <span className="ml-2 text-red-600">Some promoted students have no section.</span>}
              </p>
              <button className="btn btn-primary" disabled={run.isPending || missingSection}
                onClick={() => confirm(`Move ${total} student(s) into ${preview.data.to.name}? This can't be undone automatically.`) && run.mutate()}>
                <ArrowUpCircle className="h-4 w-4" /> Run promotion
              </button>
            </div>
          )}
        </>
      ))}
    </DashboardLayout>
  );
}
