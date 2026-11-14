'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowRight, ArrowUpCircle, CalendarRange, ClipboardCheck, GitBranch, Users } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Field, Modal, Spinner, Empty } from '@/components/ui/kit';
import { promotionsAPI, schoolAPI, examsAPI, apiError } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { cn } from '@/lib/utils';

type Outcome = 'PROMOTED' | 'RETAINED' | 'GRADUATED' | 'LEFT';
type Decision = { outcome: Outcome; toSectionId: string | null; include: boolean };

const OUTCOME_LABEL: Record<Outcome, string> = { PROMOTED: 'Promote', RETAINED: 'Repeat class', GRADUATED: 'Graduate', LEFT: 'Leaving' };
const GRADUATE = 'GRADUATE';

/**
 * End of year / student promotion (client change request 05):
 *  1. choose the current and the next academic year;
 *  2. map each class to its destination class (or "graduates");
 *  3. pick the students — all, a class, or a few — and set who repeats;
 *  4. review the summary and confirm. Records, results, attendance and fees stay with the student.
 */
export default function PromotionWorkspace({ embedded = false }: { embedded?: boolean }) {
  const qc = useQueryClient();
  const years = useQuery({ queryKey: ['years'], queryFn: schoolAPI.years });
  const exams = useQuery({ queryKey: ['exams'], queryFn: ()=>examsAPI.list() });
  const allYears: any[] = useMemo(() => [...(years.data ?? [])].sort((a, b) => String(a.startDate).localeCompare(String(b.startDate))), [years.data]);
  const [fromYear, setFromYear] = useState('');
  const [toYear, setToYear] = useState('');
  const [examId, setExamId] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [opts, setOpts] = useState({ makeCurrent: true, copyTeachers: true, copyFeeStructure: true });
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [reviewing, setReviewing] = useState(false);

  // Start with the current year; the user still confirms both.
  useEffect(() => {
    if (!fromYear && allYears.length) setFromYear(allYears.find((y) => y.isCurrent)?.id ?? '');
  }, [allYears, fromYear]);
  const from = allYears.find((y) => y.id === fromYear);
  const laterYears = allYears.filter((y) => from && y.startDate > from.startDate);
  const yearsChosen = !!fromYear && !!toYear;

  const mappingKey = JSON.stringify(mapping);
  const preview = useQuery({
    queryKey: ['promotion-preview', fromYear, toYear, examId, mappingKey],
    queryFn: () => promotionsAPI.preview({ fromAcademicYearId: fromYear, toAcademicYearId: toYear, examId: examId || undefined, mapping: Object.keys(mapping).length ? mappingKey : undefined }),
    enabled: yearsChosen,
    retry: false,
  });
  const p = preview.data;

  useEffect(() => {
    if (!p) return;
    const d: Record<string, Decision> = {};
    for (const g of p.classes) for (const s of g.students) d[s.id] = { outcome: s.outcome, toSectionId: s.toSectionId, include: true };
    setDecisions(d);
  }, [p]);

  const set = (id: string, patch: Partial<Decision>) => setDecisions((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  const sameSection = (list: any[], name: string) => list.find((x: any) => x.name === name)?.id ?? list[0]?.id ?? null;
  const decide = (g: any, s: any, outcome: Outcome) => set(s.id, {
    outcome,
    toSectionId: outcome === 'PROMOTED' ? sameSection(g.nextClass?.sections ?? [], s.section) : outcome === 'RETAINED' ? sameSection(g.sections, s.section) : null,
  });

  const chosen = Object.entries(decisions).filter(([, d]) => d.include);
  const total = Object.keys(decisions).length;
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const [, d] of chosen) c[d.outcome] = (c[d.outcome] ?? 0) + 1;
    return c;
  }, [chosen]);
  const missingSection = chosen.some(([, d]) => (d.outcome === 'PROMOTED' || d.outcome === 'RETAINED') && !d.toSectionId);

  const run = useMutation({
    mutationFn: () => promotionsAPI.run({
      fromAcademicYearId: fromYear, toAcademicYearId: toYear, ...opts,
      decisions: chosen.map(([studentId, d]) => ({ studentId, outcome: d.outcome, toSectionId: d.toSectionId })),
    }),
    onSuccess: (r: any) => {
      toast.success(`Done: ${Object.entries(r.counts).map(([k, v]) => `${v} ${OUTCOME_LABEL[k as Outcome]?.toLowerCase() ?? k}`).join(', ')}. Current year: ${r.currentYear}`, { duration: 8000 });
      setReviewing(false);
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(apiError(e), { duration: 7000 }),
  });

  return (
    <PromotionFrame embedded={embedded} title="End of year · Student promotion" allowedRoles={CAN.promotion}
      subtitle="Move students to their next class for the new academic year. Their records, results, attendance and fees are kept.">
      {/* 1. Academic years */}
      <div className="card space-y-3">
        <Step n={1} icon={CalendarRange} title="Academic years" done={yearsChosen} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Current academic year *">
            <select className="select" value={fromYear} onChange={(e) => { setFromYear(e.target.value); setToYear(''); setMapping({}); }}>
              <option value="">Choose…</option>
              {allYears.map((y) => <option key={y.id} value={y.id}>{y.name}{y.isCurrent ? ' (current)' : ''}</option>)}
            </select>
          </Field>
          <Field label="Next academic year *" hint={fromYear && !laterYears.length ? 'Add the next academic year in School settings first' : undefined}>
            <select className="select" value={toYear} disabled={!fromYear} onChange={(e) => setToYear(e.target.value)}>
              <option value="">Choose…</option>
              {laterYears.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
            </select>
          </Field>
          <Field label="Use exam results" hint="Students who failed it are set to repeat the class">
            <select className="select" value={examId} onChange={(e) => setExamId(e.target.value)}>
              <option value="">Don’t use results</option>
              {(exams.data ?? []).filter((x: any) => x.status === 'PUBLISHED' && (!fromYear || x.academicYearId === fromYear)).map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
        </div>
        {!yearsChosen && <p className="text-sm text-amber-700">Choose both academic years to continue.</p>}
      </div>

      {yearsChosen && (preview.isLoading ? <Spinner /> : preview.error ? <div className="card text-sm text-red-600">{apiError(preview.error)}</div> : p && (
        <>
          {/* 2. Class mapping */}
          <div className="card space-y-3">
            <Step n={2} icon={GitBranch} title="Class-to-class mapping" done />
            <p className="text-sm text-gray-500">Where does each class go in {p.to.name}? It starts with the next class by level; the top class graduates. Change any row.</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {p.allClasses.map((c: any) => (
                <div key={c.id} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
                  <span className="w-24 flex-shrink-0 truncate text-sm font-medium" title={c.name}>{c.name}</span>
                  <ArrowRight className="h-4 w-4 flex-shrink-0 text-gray-400" />
                  <select className="select flex-1 py-1 text-sm" aria-label={`Destination for ${c.name}`} value={p.mapping[c.id]}
                    onChange={(e) => setMapping({ ...p.mapping, [c.id]: e.target.value })}>
                    {p.allClasses.filter((x: any) => x.id !== c.id).map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    <option value={GRADUATE}>Graduates (leaves school)</option>
                  </select>
                  <span className="text-xs text-gray-400" title="Students waiting">{c.waiting}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 3. Students */}
          <div className="card space-y-1">
            <Step n={3} icon={Users} title="Choose students" done={chosen.length > 0} />
            <p className="text-sm text-gray-500">Untick students who should not move now (you can promote them later). Set “Repeat class” for students who stay in the same class.</p>
          </div>
          {p.alreadyPromoted > 0 && (
            <div className="card border-amber-200 bg-amber-50 text-sm text-amber-800">{p.alreadyPromoted} student(s) are already promoted into {p.to.name} and are not listed again.</div>
          )}
          {!p.classes.length ? <div className="card"><Empty title="Nobody left to promote">Every active student has been moved into {p.to.name}.</Empty></div> : p.classes.map((g: any) => {
            const inClass = g.students.filter((s: any) => decisions[s.id]);
            const ticked = inClass.filter((s: any) => decisions[s.id].include);
            const all = ticked.length === inClass.length;
            return (
              <div key={g.class.id} className="card">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="section-title">{g.class.name} <ArrowRight className="inline h-4 w-4 text-gray-400" /> {g.nextClass?.name ?? 'Graduates'}</h3>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-gray-500">{ticked.length} of {inClass.length} selected</span>
                    <button className="btn-ghost px-2 py-1" onClick={() => inClass.forEach((s: any) => set(s.id, { include: !all }))}>{all ? 'Select none' : 'Select all'}</button>
                    {g.nextClass && <button className="btn-ghost px-2 py-1" onClick={() => ticked.forEach((s: any) => decide(g, s, 'PROMOTED'))}>Promote selected</button>}
                    <button className="btn-ghost px-2 py-1" onClick={() => ticked.forEach((s: any) => decide(g, s, 'RETAINED'))}>Repeat selected</button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead><tr><th className="w-8" /><th>Roll</th><th>Student</th><th>Now</th><th>Decision</th><th>Class / section in {p.to.name}</th></tr></thead>
                    <tbody>
                      {g.students.map((s: any) => {
                        const d = decisions[s.id];
                        if (!d) return null;
                        const options = d.outcome === 'PROMOTED' ? (g.nextClass?.sections ?? []).map((x: any) => ({ id: x.id, label: `${g.nextClass.name}-${x.name}` }))
                          : d.outcome === 'RETAINED' ? g.sections.map((x: any) => ({ id: x.id, label: `${g.class.name}-${x.name}` })) : [];
                        return (
                          <tr key={s.id} className={cn(!d.include && 'opacity-50')}>
                            <td><input type="checkbox" className="h-4 w-4" checked={d.include} aria-label={`Include ${s.name}`} onChange={(e) => set(s.id, { include: e.target.checked })} /></td>
                            <td>{s.rollNo ?? '—'}</td>
                            <td><p className="font-medium">{s.name}</p><p className="text-xs text-gray-500">{s.admissionNo}{s.failedPercent !== null ? ` · failed (${s.failedPercent}%)` : ''}</p></td>
                            <td className="text-sm">{g.class.name}-{s.section}</td>
                            <td>
                              <select className="select py-1 text-sm" value={d.outcome} disabled={!d.include} aria-label={`Decision for ${s.name}`}
                                onChange={(e) => decide(g, s, e.target.value as Outcome)}>
                                {(Object.keys(OUTCOME_LABEL) as Outcome[]).filter((o) => o !== 'PROMOTED' || g.nextClass).map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
                              </select>
                            </td>
                            <td>
                              {options.length ? (
                                <select className="select py-1 text-sm" value={d.toSectionId ?? ''} disabled={!d.include} aria-label={`Section for ${s.name}`} onChange={(e) => set(s.id, { toSectionId: e.target.value })}>
                                  {options.map((o: any) => <option key={o.id} value={o.id}>{o.label}</option>)}
                                </select>
                              ) : <span className="text-sm text-gray-400">{d.outcome === 'PROMOTED' ? 'Destination class has no sections' : '—'}</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}

          {total > 0 && (
            <div className="card sticky bottom-4 space-y-3">
              <Step n={4} icon={ClipboardCheck} title="Review and confirm" done={false} />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-gray-600">
                  {chosen.length} of {total} selected: {Object.entries(counts).map(([k, v]) => `${v} ${OUTCOME_LABEL[k as Outcome].toLowerCase()}`).join(' · ') || 'none'}
                  {missingSection && <span className="ml-2 text-red-600">Some selected students have no class/section for next year.</span>}
                </p>
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  {([['makeCurrent', `Make ${p.to.name} the current year`], ['copyTeachers', 'Copy subject teachers'], ['copyFeeStructure', 'Copy fee structure']] as const).map(([k, l]) => (
                    <label key={k} className="flex items-center gap-1.5">
                      <input type="checkbox" checked={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} /> {l}
                    </label>
                  ))}
                  <button className="btn btn-primary" disabled={!chosen.length || missingSection} onClick={() => setReviewing(true)}>
                    <ClipboardCheck className="h-4 w-4" /> Review promotion
                  </button>
                </div>
              </div>
            </div>
          )}

          {reviewing && <Review p={p} decisions={decisions} opts={opts} pending={run.isPending} onClose={() => setReviewing(false)} onConfirm={() => run.mutate()} />}
        </>
      ))}
    </PromotionFrame>
  );
}

function Step({ n, icon: Icon, title, done }: { n: number; icon: React.ComponentType<{ className?: string }>; title: string; done: boolean }) {
  return (
    <h3 className="section-title flex items-center gap-2">
      <span className={cn('flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold', done ? 'bg-emerald-100 text-emerald-700' : 'bg-primary-100 text-primary-700')}>{n}</span>
      <Icon className="h-4 w-4 text-gray-400" /> {title}
    </h3>
  );
}

/** The summary shown before anything changes; the admin must tick a box to confirm. */
function Review({ p, decisions, opts, pending, onClose, onConfirm }: {
  p: any; decisions: Record<string, Decision>; opts: { makeCurrent: boolean; copyTeachers: boolean; copyFeeStructure: boolean };
  pending: boolean; onClose: () => void; onConfirm: () => void;
}) {
  const [sure, setSure] = useState(false);
  const rows = p.classes.map((g: any) => {
    const ds = g.students.map((s: any) => decisions[s.id]).filter(Boolean) as Decision[];
    const sel = ds.filter((d) => d.include);
    return {
      id: g.class.id, from: g.class.name, to: g.nextClass?.name ?? 'Graduates', total: ds.length, selected: sel.length,
      promoted: sel.filter((d) => d.outcome === 'PROMOTED').length,
      repeating: sel.filter((d) => d.outcome === 'RETAINED').length,
      leaving: sel.filter((d) => d.outcome === 'GRADUATED' || d.outcome === 'LEFT').length,
      notIncluded: ds.length - sel.length,
    };
  }).filter((r: any) => r.total);
  const sum = (k: string) => rows.reduce((t: number, r: any) => t + r[k], 0);
  return (
    <Modal open onClose={onClose} title={`Promote into ${p.to.name}?`} wide>
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-5">
          <Tile k="Selected" v={sum('selected')} />
          <Tile k="To be promoted" v={sum('promoted')} tone="text-emerald-700" />
          <Tile k="Repeating" v={sum('repeating')} tone="text-amber-700" />
          <Tile k="Graduating / leaving" v={sum('leaving')} tone="text-violet-700" />
          <Tile k="Not promoted now" v={sum('notIncluded')} tone="text-gray-500" />
        </div>
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Current class ({p.from.name})</th><th>Destination ({p.to.name})</th><th className="text-right">Selected</th><th className="text-right">Promoted</th><th className="text-right">Repeating</th><th className="text-right">Leaving</th><th className="text-right">Not now</th></tr></thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.id}>
                  <td className="font-medium">{r.from}</td><td>{r.to}</td>
                  <td className="text-right">{r.selected}</td><td className="text-right">{r.promoted}</td><td className="text-right">{r.repeating}</td>
                  <td className="text-right">{r.leaving}</td><td className="text-right text-gray-500">{r.notIncluded}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-gray-600">
          <li>Each student’s previous results, attendance, fee history and documents stay with them.</li>
          <li>A student can be promoted into {p.to.name} only once; unselected students can be promoted later.</li>
          {opts.makeCurrent && <li>{p.to.name} becomes the current academic year.</li>}
          {opts.copyTeachers && <li>Subject teachers are copied into {p.to.name} (if it has none yet).</li>}
          {opts.copyFeeStructure && <li>The fee structure is copied into {p.to.name} (if it has none yet).</li>}
        </ul>
        <label className="flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          <input type="checkbox" className="h-4 w-4" checked={sure} onChange={(e) => setSure(e.target.checked)} />
          I have checked the classes and students above.
        </label>
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Back</button>
          <button className="btn btn-primary" disabled={!sure || pending} onClick={onConfirm}><ArrowUpCircle className="h-4 w-4" /> Confirm promotion</button>
        </div>
      </div>
    </Modal>
  );
}

function Tile({ k, v, tone }: { k: string; v: number; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 text-center">
      <p className={cn('text-2xl font-bold', tone ?? 'text-gray-900')}>{v}</p>
      <p className="text-xs text-gray-500">{k}</p>
    </div>
  );
}


function PromotionFrame({embedded,children,...props}:{embedded:boolean;children:React.ReactNode;title:string;allowedRoles:string[];subtitle:string}) {
 return embedded?<div className="space-y-4">{children}</div>:<DashboardLayout {...props}>{children}</DashboardLayout>;
}
