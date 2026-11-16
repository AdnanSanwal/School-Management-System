'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Send, Clock, X, BarChart3 } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Field, Modal, Spinner, Empty, StudentPicker, useSections } from '@/components/ui/kit';
import { broadcastsAPI, apiError } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { cn, formatDateTime } from '@/lib/utils';

const ROLES: [string, string][] = [
  ['PARENT', 'Parents'], ['STUDENT', 'Students'], ['TEACHER', 'Teachers'],
  ['ADMIN', 'Office admins'], ['ACCOUNTANT', 'Accountants'], ['PRINCIPAL', 'Principal'], ['OWNER', 'Owner'],
];
const STATUS: Record<string, [string, string]> = {
  SCHEDULED: ['Scheduled', 'badge-yellow'], SENDING: ['Sending…', 'badge-blue'], SENT: ['Sent', 'badge-green'], CANCELLED: ['Cancelled', 'badge-gray'],
};

interface Audience { everyone?: boolean; roles?: string[]; classIds?: string[]; sectionIds?: string[]; studentIds?: string[] }
interface Report { sent: number; delivered: number; unreached: number; failed: number; waiting: number; muted: number; read: number }

export default function BroadcastsPage() {
  const qc = useQueryClient();
  const [composing, setComposing] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);
  // Keep the numbers moving: quickly while something is still going out, slowly otherwise (reads trickle in).
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['broadcasts'],
    queryFn: broadcastsAPI.list,
    refetchInterval: (q) => ((q.state.data as any[] | undefined)?.some((b) => b.status === 'SENDING' || b.report?.waiting) ? 4000 : 20_000),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['broadcasts'] });
  const cancel = useMutation({
    mutationFn: broadcastsAPI.cancel,
    onSuccess: () => { toast.success('Scheduled message cancelled'); refresh(); },
    onError: (e) => toast.error(apiError(e)),
  });
  const sections = useSections().data ?? [];
  const describe = (a: Audience) => {
    if (a.everyone) return 'Everyone';
    const parts: string[] = [];
    if (a.roles?.length) parts.push(a.roles.map((r) => ROLES.find(([k]) => k === r)?.[1] ?? r).join(', '));
    if (a.classIds?.length) parts.push([...new Set(sections.filter((s) => a.classIds!.includes(s.classId)).map((s) => s.className))].join(', ') || `${a.classIds.length} class(es)`);
    if (a.sectionIds?.length) parts.push(sections.filter((s) => a.sectionIds!.includes(s.id)).map((s) => s.label).join(', ') || `${a.sectionIds.length} section(s)`);
    if (a.studentIds?.length) parts.push(`${a.studentIds.length} student${a.studentIds.length === 1 ? '' : 's'}`);
    return parts.join(' · ');
  };

  return (
    <DashboardLayout title="Messages to families and staff" allowedRoles={CAN.sendBroadcasts}
      subtitle="Sent to the app: the bell, a pop-up on open screens, and a push alert on phones"
      actions={<button className="btn btn-primary" onClick={() => setComposing(true)}><Plus className="h-4 w-4" /> New message</button>}>
      <div className="space-y-3">
        {isLoading ? <Spinner /> : rows.length === 0 ? <div className="card"><Empty title="No messages sent yet" /></div> : rows.map((b: any) => (
          <div key={b.id} className="card">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="flex-1 font-semibold text-gray-900">{b.title}</h3>
              <span className={cn('badge', STATUS[b.status]?.[1])}>{STATUS[b.status]?.[0] ?? b.status}</span>
            </div>
            <p className="mt-1 whitespace-pre-line text-sm text-gray-600">{b.body}</p>
            <p className="mt-2 text-xs text-gray-500">
              To: {describe(b.audience)} · by {b.createdBy ?? 'the office'} ·{' '}
              {b.status === 'SCHEDULED' ? <>goes out {formatDateTime(b.scheduledAt)}</> : b.sentAt ? <>sent {formatDateTime(b.sentAt)}</> : <>created {formatDateTime(b.createdAt)}</>}
            </p>
            {b.report && <Numbers report={b.report} recipients={b.recipients} />}
            <div className="mt-3 flex gap-2">
              {b.status === 'SENT' && <button className="btn btn-secondary" onClick={() => setReportId(b.id)}><BarChart3 className="h-4 w-4" /> Delivery report</button>}
              {b.status === 'SCHEDULED' && (
                <button className="btn btn-secondary" disabled={cancel.isPending} onClick={() => { if (confirm('Cancel this scheduled message? It will not be sent.')) cancel.mutate(b.id); }}>
                  <X className="h-4 w-4" /> Cancel
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {composing && <Composer onClose={() => setComposing(false)} onDone={() => { setComposing(false); refresh(); }} />}
      {reportId && <ReportModal id={reportId} onClose={() => setReportId(null)} />}
    </DashboardLayout>
  );
}

function Numbers({ report, recipients }: { report: Report; recipients: number }) {
  const cells: [string, number, string][] = [
    ['Sent to', report.sent || recipients, 'text-gray-900'],
    ['Push delivered', report.delivered, 'text-green-700'],
    ['No phone or browser', report.unreached, 'text-amber-700'],
    ['Push failed', report.failed, 'text-red-700'],
    ['Still going out', report.waiting, 'text-blue-700'],
    ['Read in the app', report.read, 'text-primary-700'],
  ];
  return (
    <dl className="mt-3 grid grid-cols-3 gap-2 text-center md:grid-cols-6">
      {cells.map(([label, value, tone]) => (
        <div key={label} className="rounded-xl bg-slate-50 px-2 py-2">
          <dd className={cn('text-lg font-bold', tone)}>{value}</dd>
          <dt className="text-2xs text-gray-500">{label}</dt>
        </div>
      ))}
    </dl>
  );
}

function ReportModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['broadcasts', id], queryFn: () => broadcastsAPI.get(id), refetchInterval: (q) => ((q.state.data as any)?.report?.waiting ? 4000 : false) });
  return (
    <Modal open onClose={onClose} title="Delivery report" wide>
      {isLoading || !data ? <Spinner /> : (
        <div className="space-y-4">
          <div>
            <h3 className="font-semibold text-gray-900">{data.title}</h3>
            <p className="text-xs text-gray-500">Sent {data.sentAt ? formatDateTime(data.sentAt) : ''}</p>
          </div>
          <Numbers report={data.report} recipients={data.recipients} />
          <p className="text-xs text-gray-500">
            Everyone it was sent to has it in the app’s notification list. “Push delivered” means a phone or browser alert was accepted for delivery.
          </p>
          <div>
            <h4 className="section-title">Not reached by push and not read yet ({data.notReached.length})</h4>
            {data.notReached.length === 0 ? <p className="text-sm text-gray-500">Nobody: everyone was either reached or has read it.</p> : (
              <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-gray-100">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs text-gray-500"><tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">Phone</th><th className="px-3 py-2">Why</th></tr></thead>
                  <tbody className="divide-y divide-gray-50">
                    {data.notReached.map((p: any) => (
                      <tr key={p.id}>
                        <td className="px-3 py-2">{p.name}</td>
                        <td className="px-3 py-2 capitalize text-gray-500">{p.role.toLowerCase()}</td>
                        <td className="px-3 py-2 text-gray-500">{p.phone ?? '—'}</td>
                        <td className="px-3 py-2 text-gray-500">{p.state === 'UNREACHED' ? 'No phone or browser signed in' : 'Push failed'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function Composer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const sections = useSections().data ?? [];
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [everyone, setEveryone] = useState(true);
  const [roles, setRoles] = useState<string[]>([]);
  const [sectionIds, setSectionIds] = useState<string[]>([]);
  const [students, setStudents] = useState<{ id: string; name: string }[]>([]);
  const [later, setLater] = useState(false);
  const [when, setWhen] = useState('');
  const [count, setCount] = useState<number | null>(null);

  const audience: Audience = everyone ? { everyone: true } : {
    ...(roles.length ? { roles } : {}), ...(sectionIds.length ? { sectionIds } : {}), ...(students.length ? { studentIds: students.map((s) => s.id) } : {}),
  };
  const key = JSON.stringify(audience);
  const chosen = everyone || roles.length + sectionIds.length + students.length > 0;

  // How many people this comes to, a moment after the choice settles.
  useEffect(() => {
    if (!chosen) return;
    let stale = false;
    const timer = setTimeout(() => {
      broadcastsAPI.preview(JSON.parse(key)).then((r) => { if (!stale) setCount(r.recipients); }).catch(() => { if (!stale) setCount(null); });
    }, 300);
    return () => { stale = true; clearTimeout(timer); };
  }, [key, chosen]);

  const send = useMutation({
    mutationFn: () => broadcastsAPI.create({ title, message, audience, scheduledAt: later && when ? new Date(when).toISOString() : null }),
    onSuccess: (r) => { toast.success(r.message); onDone(); },
    onError: (e) => toast.error(apiError(e)),
  });
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const classes = [...new Map(sections.map((s) => [s.classId, s.className])).entries()];

  return (
    <Modal open onClose={onClose} title="New message" wide>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
        <Field label="Title"><input className="input" required maxLength={150} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="School closed tomorrow" /></Field>
        <Field label="Message"><textarea className="input min-h-[96px]" required maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} /></Field>

        <div className="space-y-2">
          <span className="label">Send to</span>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" checked={everyone} onChange={() => setEveryone(true)} /> Everyone in the school</label>
            <label className="flex items-center gap-2"><input type="radio" checked={!everyone} onChange={() => setEveryone(false)} /> Choose who</label>
          </div>
          {!everyone && (
            <div className="space-y-3 rounded-xl border border-gray-100 bg-slate-50/60 p-3 text-sm">
              <div>
                <p className="mb-1 font-medium text-gray-700">Whole groups</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {ROLES.map(([k, label]) => <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={roles.includes(k)} onChange={() => toggle(roles, setRoles, k)} /> {label}</label>)}
                </div>
              </div>
              <div>
                <p className="mb-1 font-medium text-gray-700">Families of these classes</p>
                <div className="max-h-40 space-y-1 overflow-y-auto">
                  {classes.map(([classId, name]) => {
                    const own = sections.filter((s) => s.classId === classId);
                    const all = own.every((s) => sectionIds.includes(s.id));
                    return (
                      <div key={classId} className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <label className="flex w-28 items-center gap-2 font-medium">
                          <input type="checkbox" checked={all} onChange={() => setSectionIds(all ? sectionIds.filter((x) => !own.some((s) => s.id === x)) : [...new Set([...sectionIds, ...own.map((s) => s.id)])])} /> {name}
                        </label>
                        {own.map((s) => <label key={s.id} className="flex items-center gap-1.5 text-gray-600"><input type="checkbox" checked={sectionIds.includes(s.id)} onChange={() => toggle(sectionIds, setSectionIds, s.id)} /> {s.label}</label>)}
                      </div>
                    );
                  })}
                  {classes.length === 0 && <p className="text-gray-500">No classes yet.</p>}
                </div>
              </div>
              <div>
                <p className="mb-1 font-medium text-gray-700">Families of individual students</p>
                <StudentPicker value={null} onChange={(s) => { if (s && !students.some((x) => x.id === s.id)) setStudents([...students, { id: s.id, name: s.name }]); }} />
                {students.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {students.map((s) => (
                      <span key={s.id} className="badge badge-indigo flex items-center gap-1">{s.name}
                        <button type="button" aria-label={`Remove ${s.name}`} onClick={() => setStudents(students.filter((x) => x.id !== s.id))}><X className="h-3 w-3" /></button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          <p className="text-xs text-gray-500" aria-live="polite">
            {!chosen ? 'Choose at least one group, class or student.' : count === null ? 'Counting…' : `${count} ${count === 1 ? 'person has' : 'people have'} an app login in this audience.`}
          </p>
        </div>

        <div className="space-y-2">
          <span className="label">When</span>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" checked={!later} onChange={() => setLater(false)} /> Now</label>
            <label className="flex items-center gap-2"><input type="radio" checked={later} onChange={() => setLater(true)} /> At a set time</label>
            {later && <input type="datetime-local" className="input w-auto" required value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Send at" />}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          <button className="btn btn-primary" disabled={send.isPending || !chosen || (later && !when)}>
            {later ? <><Clock className="h-4 w-4" /> Schedule</> : <><Send className="h-4 w-4" /> Send now</>}
          </button>
        </div>
      </form>
    </Modal>
  );
}
