'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { BookOpen, Bus, CalendarDays, ChevronLeft, ChevronRight, Clock, Download, GraduationCap, Home, Library, Wallet } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Empty, Spinner } from '@/components/ui/kit';
import { familyAPI, apiError } from '@/lib/api';
import { cn, formatDate, formatMoney, formatPeriod, todayIso } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';

// The student's (or a parent's children's) own record on the web: the same information as the
// mobile app. Everything here is limited by the server to the signed-in person's own data.

type Tab = 'home' | 'attendance' | 'diary' | 'exams' | 'timetable' | 'fees' | 'library' | 'transport';
const STATUS: Record<string, [string, string]> = {
  PRESENT: ['Present', 'bg-emerald-100 text-emerald-800'], ABSENT: ['Absent', 'bg-red-100 text-red-800'], LATE: ['Late', 'bg-amber-100 text-amber-800'],
  LEAVE: ['Leave', 'bg-blue-100 text-blue-800'], HALF_DAY: ['Half day', 'bg-orange-100 text-orange-800'],
};
const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const title = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const klass = (s?: { name: string; class?: { name: string } } | null) => (s ? `${s.class?.name ?? ''}-${s.name}`.replace(/^-/, '') : '');

export default function FamilyPage() {
  const user = useAuthStore((s) => s.user);
  const isStudent = user?.role === 'STUDENT';
  const may = (p: string, standard: boolean) => (user?.permissions ? user.permissions.includes(p) : standard);
  const kids = useQuery({ queryKey: ['family', 'children'], queryFn: familyAPI.children });
  const [childId, setChildId] = useState('');
  const [tab, setTab] = useState<Tab>('home');
  const child = kids.data?.find((k) => k.id === childId) ?? kids.data?.[0];
  useEffect(() => { if (child && child.id !== childId) setChildId(child.id); }, [child, childId]);

  const tabs = ([
    ['home', 'Overview', Home, true], ['attendance', 'Attendance', CalendarDays, true], ['diary', 'Diary & homework', BookOpen, true],
    ['exams', 'Exams & results', GraduationCap, true], ['timetable', 'Timetable', Clock, true],
    ['fees', 'Fees', Wallet, may('fee.view', !isStudent)], ['library', 'Library', Library, may('library.view', true)], ['transport', 'Transport', Bus, may('transport.view', true)],
  ] as [Tab, string, React.ElementType, boolean][]).filter((t) => t[3]);

  return (
    <DashboardLayout title={isStudent ? 'My school record' : 'My children'} allowedRoles={['PARENT', 'STUDENT']}
      subtitle={child ? `${child.name} · ${klass(child.section)} · admission no. ${child.admissionNo}${child.rollNo ? ` · roll no. ${child.rollNo}` : ''}` : undefined}>
      {kids.isLoading ? <Spinner /> : kids.error ? <div className="card text-sm text-red-600">{apiError(kids.error)}</div> : !child ? (
        <div className="card"><Empty title={isStudent ? 'No student record is linked to this login' : 'No children are linked to this login'}>Please ask the school office to link it.</Empty></div>
      ) : (
        <>
          {(kids.data?.length ?? 0) > 1 && (
            <div className="flex flex-wrap gap-2">
              {kids.data!.map((k) => (
                <button key={k.id} onClick={() => setChildId(k.id)} className={cn('rounded-xl border px-4 py-2 text-left text-sm', k.id === child.id ? 'border-primary-400 bg-primary-50' : 'border-slate-200 bg-white hover:bg-slate-50')}>
                  <span className="font-semibold">{k.name}</span><span className="block text-xs text-gray-500">{klass(k.section)}</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
            {tabs.map(([k, label, Icon]) => (
              <button key={k} onClick={() => setTab(k)} className={cn('flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium', tab === k ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600 hover:text-gray-900')}>
                <Icon className="h-4 w-4" />{label}
              </button>
            ))}
          </div>
          {tab === 'home' && <Overview child={child} isStudent={isStudent} go={setTab} />}
          {tab === 'attendance' && <Attendance id={child.id} />}
          {tab === 'diary' && <Diary id={child.id} />}
          {tab === 'exams' && <Exams id={child.id} />}
          {tab === 'timetable' && <Timetable sectionId={child.section?.id} />}
          {tab === 'fees' && <Fees id={child.id} />}
          {tab === 'library' && <LibraryTab id={child.id} />}
          {tab === 'transport' && <Transport id={child.id} />}
        </>
      )}
    </DashboardLayout>
  );
}

const Loading = ({ q }: { q: { isLoading: boolean; error: unknown } }) => (q.isLoading ? <div className="card"><Spinner /></div> : q.error ? <div className="card text-sm text-red-600">{apiError(q.error)}</div> : null);
const useCurrency = () => useAuthStore((s) => s.user?.school?.currency ?? 'PKR');

function Overview({ child, isStudent, go }: { child: any; isStudent: boolean; go: (t: Tab) => void }) {
  const currency = useCurrency();
  const q = useQuery({ queryKey: ['family', 'home', child.id], queryFn: () => familyAPI.home(child.id) });
  const today = useQuery({ queryKey: ['family', 'today', child.id], queryFn: familyAPI.today });
  if (!q.data) return <Loading q={q} />;
  const h = q.data;
  const st = h.today?.status ? STATUS[h.today.status] : null;
  const m = h.attendanceThisMonth ?? {};
  const slots: any[] = today.data?.slots ?? [];
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="card space-y-2">
        <h3 className="section-title">Today</h3>
        {h.today?.holiday ? <p className="text-sm">Holiday: <b>{h.today.holiday}</b></p>
          : st ? <p><span className={cn('rounded-lg px-2.5 py-1 text-sm font-semibold', st[1])}>{st[0]}</span>{h.today.remarks ? <span className="ml-2 text-sm text-gray-500">{h.today.remarks}</span> : null}</p>
            : <p className="text-sm text-gray-500">Attendance has not been marked yet today.</p>}
        <p className="text-sm text-gray-600">Class teacher: <b>{child.section?.classTeacher?.name ?? '—'}</b></p>
        {h.unreadNotices > 0 && <Link href="/notices" className="inline-block text-sm font-medium text-primary-700 hover:underline">{h.unreadNotices} unread notice{h.unreadNotices > 1 ? 's' : ''}</Link>}
      </div>
      <button className="card space-y-1 text-left hover:shadow-md" onClick={() => go('attendance')}>
        <h3 className="section-title">Attendance this month</h3>
        <p className="text-3xl font-bold text-emerald-700">{m.percent ?? '—'}{m.percent != null ? '%' : ''}</p>
        <p className="text-sm text-gray-500">{m.PRESENT ?? 0} present{m.ABSENT ? ` · ${m.ABSENT} absent` : ''}{m.LATE ? ` · ${m.LATE} late` : ''}{m.LEAVE ? ` · ${m.LEAVE} leave` : ''} of {m.total ?? 0} days</p>
      </button>
      {h.fees ? (
        <button className="card space-y-1 text-left hover:shadow-md" onClick={() => go('fees')}>
          <h3 className="section-title">Fees</h3>
          <p className={cn('text-3xl font-bold', Number(h.fees.pending) > 0 ? 'text-red-600' : 'text-emerald-700')}>{formatMoney(h.fees.pending, currency)}</p>
          <p className="text-sm text-gray-500">{Number(h.fees.pending) > 0 ? 'pending' : 'Nothing pending'}{h.fees.nextDue ? ` · ${h.fees.nextDue.overdue ? 'overdue since' : 'next due'} ${formatDate(h.fees.nextDue.dueDate)}` : ''}{h.fees.paidTill ? ` · paid till ${formatPeriod(h.fees.paidTill)}` : ''}</p>
        </button>
      ) : (
        <div className="card space-y-2">
          <h3 className="section-title">Coming up</h3>
          {(h.upcoming ?? []).length === 0 ? <p className="text-sm text-gray-500">Nothing scheduled.</p> : h.upcoming.map((e: any) => (
            <p key={e.id} className="flex justify-between gap-2 text-sm"><span>{e.type === 'HOLIDAY' ? 'Holiday: ' : ''}{e.title}</span><span className="whitespace-nowrap text-gray-500">{formatDate(e.startDate)}</span></p>
          ))}
        </div>
      )}
      <div className="card space-y-2 lg:col-span-2">
        <div className="flex items-center justify-between"><h3 className="section-title">Latest from the diary</h3><button className="text-sm font-medium text-primary-700 hover:underline" onClick={() => go('diary')}>All entries</button></div>
        {h.latestDiary ? <DiaryEntry e={h.latestDiary} /> : <p className="text-sm text-gray-500">Nothing posted yet.</p>}
      </div>
      <div className="card space-y-2">
        <div className="flex items-center justify-between"><h3 className="section-title">Today’s classes</h3><button className="text-sm font-medium text-primary-700 hover:underline" onClick={() => go('timetable')}>Week</button></div>
        {slots.length === 0 ? <p className="text-sm text-gray-500">{isStudent ? 'No classes on the timetable today.' : 'No classes on the timetable today.'}</p> : (
          <ul className="space-y-1 text-sm">{slots.map((s) => (
            <li key={s.id} className="flex justify-between gap-2"><span><span className="font-mono text-xs text-gray-500">{s.startTime}</span> {s.subject?.name ?? 'Break'}</span><span className="text-gray-500">{s.teacher?.name ?? ''}</span></li>
          ))}</ul>
        )}
      </div>
      {h.fees && (h.upcoming ?? []).length > 0 && (
        <div className="card space-y-2 lg:col-span-3">
          <h3 className="section-title">Coming up</h3>
          <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">{h.upcoming.map((e: any) => (
            <p key={e.id} className="flex justify-between gap-2 text-sm"><span>{e.type === 'HOLIDAY' ? 'Holiday: ' : ''}{e.title}</span><span className="whitespace-nowrap text-gray-500">{formatDate(e.startDate)}</span></p>
          ))}</div>
        </div>
      )}
    </div>
  );
}

function DiaryEntry({ e }: { e: any }) {
  return (
    <div className="rounded-xl border border-slate-100 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{e.subject?.name ?? 'General'}{e.title ? ` · ${e.title}` : ''}
          {e.isHomework && <span className="badge badge-yellow ml-2">Homework{e.dueDate ? ` · due ${formatDate(e.dueDate)}` : ''}</span>}
          {e.isHomework && e.done && <span className="badge badge-green ml-1">done</span>}</p>
        <p className="text-xs text-gray-500">{formatDate(e.date)}{e.teacher?.name ? ` · ${e.teacher.name}` : ''}</p>
      </div>
      <p className="mt-1 whitespace-pre-line text-gray-700">{e.content}</p>
      {(e.attachments ?? []).length > 0 && (
        <p className="mt-2 flex flex-wrap gap-2">{e.attachments.map((a: any, i: number) => (
          <a key={a.id ?? i} href={a.href ?? a.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-xs text-primary-700 hover:underline"><Download className="h-3 w-3" />{a.name ?? a.title ?? `Attachment ${i + 1}`}</a>
        ))}</p>
      )}
    </div>
  );
}

function Attendance({ id }: { id: string }) {
  const thisMonth = todayIso().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const q = useQuery({ queryKey: ['family', 'calendar', id, month], queryFn: () => familyAPI.calendar(id, month) });
  const shift = (by: number) => { const [y, m] = month.split('-').map(Number); setMonth(new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7)); };
  const cells = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const lead = (first.getUTCDay() + 6) % 7; // Monday first
    const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)] as (string | null)[];
  }, [month]);
  const d = q.data;
  const mark = (date: string) => d?.days.find((x: any) => x.date === date);
  const holiday = (date: string) => d?.holidays.find((x: any) => x.startDate <= date && x.endDate >= date);
  const s = d?.summary ?? {};
  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button className="btn-icon btn-ghost" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" /></button>
          <h3 className="section-title w-40 text-center">{formatPeriod(month)}</h3>
          <button className="btn-icon btn-ghost" aria-label="Next month" disabled={month >= thisMonth} onClick={() => shift(1)}><ChevronRight className="h-4 w-4" /></button>
        </div>
        {d && <p className="text-sm text-gray-600"><b className="text-emerald-700">{s.percent ?? '—'}{s.percent != null ? '%' : ''}</b> · {s.PRESENT ?? 0} present{s.ABSENT ? ` · ${s.ABSENT} absent` : ''}{s.LATE ? ` · ${s.LATE} late` : ''}{s.LEAVE ? ` · ${s.LEAVE} leave` : ''}{s.HALF_DAY ? ` · ${s.HALF_DAY} half day` : ''}</p>}
      </div>
      {!d ? <Loading q={q} /> : (
        <>
          <div className="grid grid-cols-7 gap-1.5 text-center text-xs">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => <div key={w} className="py-1 font-semibold text-gray-500">{w}</div>)}
            {cells.map((date, i) => {
              if (!date) return <div key={`x${i}`} />;
              const a = mark(date); const hol = holiday(date);
              const look = a ? STATUS[a.status]?.[1] : hol ? 'bg-slate-200 text-slate-600' : 'bg-slate-50 text-gray-400';
              return (
                <div key={date} className={cn('rounded-lg px-1 py-2', look)} title={a?.remarks ?? hol?.title ?? ''}>
                  <div className="text-sm font-semibold">{Number(date.slice(8))}</div>
                  <div className="truncate text-[10px]">{a ? STATUS[a.status]?.[0] : hol ? hol.title : ''}</div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2 text-xs">{Object.values(STATUS).map(([l, c]) => <span key={l} className={cn('rounded px-2 py-0.5', c)}>{l}</span>)}<span className="rounded bg-slate-200 px-2 py-0.5 text-slate-600">Holiday</span></div>
        </>
      )}
    </div>
  );
}

function Diary({ id }: { id: string }) {
  const [only, setOnly] = useState(false);
  const q = useQuery({ queryKey: ['family', 'diary', id], queryFn: () => familyAPI.diary(id) });
  if (!q.data) return <Loading q={q} />;
  const rows = q.data.filter((e: any) => !only || e.isHomework);
  return (
    <div className="card space-y-3">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> Homework only</label>
      {rows.length === 0 ? <Empty title="Nothing posted yet" /> : rows.map((e: any) => <DiaryEntry key={e.id} e={e} />)}
    </div>
  );
}

function Exams({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['family', 'exams', id], queryFn: () => familyAPI.exams(id) });
  const card = useMutation({
    mutationFn: (examId: string) => familyAPI.reportCard(examId, id),
    onSuccess: (r) => { window.open(r.url, '_blank', 'noopener'); },
    onError: (e) => toast.error(apiError(e)),
  });
  if (!q.data) return <Loading q={q} />;
  if (q.data.length === 0) return <div className="card"><Empty title="No exams yet">The date sheet appears here once the school schedules an exam.</Empty></div>;
  return (
    <div className="space-y-4">
      {q.data.map((e: any) => {
        const r = e.result;
        return (
          <div key={e.id} className="card space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><h3 className="section-title">{e.name}</h3>{e.startDate && <p className="text-xs text-gray-500">{formatDate(e.startDate)}{e.endDate ? ` – ${formatDate(e.endDate)}` : ''}</p>}</div>
              {r ? <span className="badge badge-green">Result out</span> : <span className="badge badge-blue">Upcoming</span>}
            </div>
            {r && (
              <div className="grid grid-cols-3 gap-3 text-center">
                {[['Percentage', r.percent != null ? `${r.percent}%` : '—'], ['Grade', r.grade ?? '—'], ['Position', r.position ?? '—']].map(([l, v]) => (
                  <div key={l} className="rounded-xl bg-slate-50 py-3"><p className="text-2xl font-bold">{v}</p><p className="text-xs text-gray-500">{l}</p></div>
                ))}
              </div>
            )}
            {r && r.passed === false && <p className="text-sm font-semibold text-red-600">Did not pass every subject</p>}
            <div className="table-container">
              <table className="table">
                {r ? <>
                  <thead><tr><th>Subject</th><th className="text-right">Marks</th><th className="text-right">Grade</th></tr></thead>
                  <tbody>{r.subjects.map((x: any) => (
                    <tr key={x.subject} className={x.passed === false ? 'text-red-600' : ''}><td>{x.subject}</td><td className="text-right tabular-nums">{x.isAbsent ? 'Absent' : `${x.obtained ?? '—'} / ${x.totalMarks}`}</td><td className="text-right">{x.grade ?? ''}</td></tr>
                  ))}</tbody>
                </> : <>
                  <thead><tr><th>Subject</th><th>Date</th><th>Syllabus</th></tr></thead>
                  <tbody>{(e.papers ?? []).map((p: any) => (
                    <tr key={p.id}><td>{p.subject}</td><td className="whitespace-nowrap">{p.date ? formatDate(p.date, { weekday: 'short', day: 'numeric', month: 'short' }) : 'To be announced'}</td><td className="text-sm text-gray-500">{p.syllabus ?? ''}</td></tr>
                  ))}</tbody>
                </>}
              </table>
            </div>
            {r && <button className="btn-secondary" disabled={card.isPending} onClick={() => card.mutate(e.id)}><Download className="h-4 w-4" /> Report card (PDF)</button>}
          </div>
        );
      })}
    </div>
  );
}

function Timetable({ sectionId }: { sectionId?: string }) {
  const q = useQuery({ queryKey: ['family', 'timetable', sectionId], queryFn: () => familyAPI.timetable(sectionId!), enabled: !!sectionId });
  if (!sectionId) return <div className="card"><Empty title="Not placed in a class yet" /></div>;
  if (!q.data) return <Loading q={q} />;
  const slots: any[] = q.data;
  if (slots.length === 0) return <div className="card"><Empty title="The timetable has not been published yet" /></div>;
  const days = DAYS.filter((d) => slots.some((s) => s.dayOfWeek === d));
  const periods = [...new Set(slots.map((s) => s.period))].sort((a, b) => a - b);
  const today = DAYS[(new Date().getDay() + 6) % 7];
  return (
    <div className="card">
      <div className="table-container">
        <table className="table">
          <thead><tr><th>Period</th>{days.map((d) => <th key={d} className={d === today ? 'text-primary-700' : ''}>{title(d)}</th>)}</tr></thead>
          <tbody>
            {periods.map((p) => {
              const any = slots.find((s) => s.period === p);
              return (
                <tr key={p}>
                  <td className="whitespace-nowrap text-sm"><b>{p}</b><span className="block font-mono text-xs text-gray-500">{any?.startTime}–{any?.endTime}</span></td>
                  {days.map((d) => {
                    const s = slots.find((x) => x.dayOfWeek === d && x.period === p);
                    return <td key={d} className={cn('text-sm', d === today && 'bg-primary-50/50')}>{s ? <>{s.subject?.name ?? '—'}<span className="block text-xs text-gray-500">{s.teacher?.name ?? ''}{s.room ? ` · ${s.room}` : ''}</span></> : ''}</td>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Fees({ id }: { id: string }) {
  const currency = useCurrency();
  const q = useQuery({ queryKey: ['family', 'fees', id], queryFn: () => familyAPI.fees(id) });
  if (!q.data) return <Loading q={q} />;
  const L = q.data;
  return (
    <div className="space-y-4">
      <div className="card">
        <p className="text-sm text-gray-500">Total pending</p>
        <p className={cn('text-3xl font-bold', Number(L.pending) > 0 ? 'text-red-600' : 'text-emerald-700')}>{formatMoney(L.pending, currency)}</p>
        {L.paidTill && <p className="text-sm text-gray-500">Paid till {formatPeriod(L.paidTill)}</p>}
      </div>
      <div className="card space-y-2">
        <h3 className="section-title">Monthly fees</h3>
        <div className="table-container">
          <table className="table">
            <thead><tr><th>Month</th><th>Details</th><th>Due</th><th className="text-right">Amount</th><th className="text-right">Paid</th><th>Status</th></tr></thead>
            <tbody>{(L.invoices ?? []).map((i: any) => (
              <tr key={i.id}>
                <td className="whitespace-nowrap font-medium">{formatPeriod(i.period)}</td>
                <td className="text-sm text-gray-500">{(i.items ?? []).map((it: any) => `${it.feeHead.name} ${formatMoney(it.amount, currency)}${Number(it.discount) ? ` − ${formatMoney(it.discount, currency)}` : ''}`).join(', ')}{Number(i.fineAmount) ? `, late fee ${formatMoney(i.fineAmount, currency)}` : ''}</td>
                <td className="whitespace-nowrap text-sm">{formatDate(i.dueDate)}</td>
                <td className="text-right tabular-nums">{formatMoney(Number(i.netAmount) + Number(i.fineAmount), currency)}</td>
                <td className="text-right tabular-nums">{formatMoney(i.paidAmount, currency)}</td>
                <td><span className={cn('badge', i.status === 'PAID' ? 'badge-green' : i.status === 'PARTIAL' ? 'badge-yellow' : i.status === 'CANCELLED' ? 'badge-gray' : 'badge-red')}>{String(i.status).toLowerCase()}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
      <div className="card space-y-2">
        <h3 className="section-title">Payments</h3>
        {(L.payments ?? []).length === 0 ? <p className="text-sm text-gray-500">No payments yet.</p> : (
          <div className="table-container">
            <table className="table">
              <thead><tr><th>Date</th><th>Receipt</th><th>For</th><th className="text-right">Amount</th><th /></tr></thead>
              <tbody>{L.payments.map((p: any) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap text-sm">{formatDate(p.paidAt)}</td><td className="font-mono text-xs">{p.receiptNo}</td>
                  <td className="text-sm text-gray-500">{(p.allocations ?? []).map((a: any) => formatPeriod(a.invoice.period)).join(', ')}</td>
                  <td className="text-right tabular-nums">{formatMoney(p.amount, currency)}</td>
                  <td className="text-right"><Link href={`/fees/receipt/${p.id}`} className="text-sm font-medium text-primary-700 hover:underline">Receipt</Link></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-gray-500">To pay online, use the mobile app.</p>
      </div>
    </div>
  );
}

function LibraryTab({ id }: { id: string }) {
  const currency = useCurrency();
  const q = useQuery({ queryKey: ['family', 'library', id], queryFn: () => familyAPI.library(id) });
  if (!q.data) return <Loading q={q} />;
  const d = q.data;
  return (
    <div className="card space-y-4">
      {Number(d.unpaidFines) > 0 && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">Unpaid library fines: {formatMoney(d.unpaidFines, currency)}</p>}
      <div>
        <h3 className="section-title mb-1">Books with you</h3>
        {d.current.length === 0 ? <p className="text-sm text-gray-500">No books issued.</p> : (
          <ul className="divide-y divide-slate-100 text-sm">{d.current.map((l: any) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span className="font-medium">{l.book.title}</span>
              <span className={l.overdue ? 'font-semibold text-red-600' : 'text-gray-500'}>{l.overdue ? `${l.daysLate} day(s) late${Number(l.fineSoFar) > 0 ? ` · ${formatMoney(l.fineSoFar, currency)}` : ''}` : `Due ${formatDate(l.dueDate)}`}</span></li>
          ))}</ul>
        )}
      </div>
      {d.history.length > 0 && (
        <div>
          <h3 className="section-title mb-1">Returned</h3>
          <ul className="divide-y divide-slate-100 text-sm">{d.history.slice(0, 30).map((l: any) => (
            <li key={l.id} className="flex flex-wrap justify-between gap-2 py-1.5"><span>{l.book.title}</span><span className="text-gray-500">{formatDate(l.returnedAt)}{Number(l.fine) > 0 ? ` · fine ${formatMoney(l.fine, currency)}${l.finePaid ? ' (paid)' : ''}` : ''}</span></li>
          ))}</ul>
        </div>
      )}
    </div>
  );
}

function Transport({ id }: { id: string }) {
  const currency = useCurrency();
  const q = useQuery({ queryKey: ['family', 'transport', id], queryFn: () => familyAPI.transport(id) });
  if (q.isLoading || q.error) return <Loading q={q} />;
  const t = q.data;
  if (!t) return <div className="card"><Empty title="Not using school transport">Ask the school office if you would like a seat on a route.</Empty></div>;
  const row = (l: string, v: React.ReactNode) => v ? <div className="flex justify-between gap-4 py-1 text-sm"><span className="text-gray-500">{l}</span><span className="font-medium">{v}</span></div> : null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card">
        <h3 className="section-title mb-1">{t.route.name}</h3>
        {row('Stop', t.stop?.name)}{row('Pick-up', t.stop?.pickupTime)}{row('Drop', t.stop?.dropTime)}{row('Vehicle', t.route.vehicleNo)}
        {row('Driver', t.route.driverName)}{row('Driver’s phone', t.route.driverPhone)}{row('Monthly fee', formatMoney(t.route.monthlyFee, currency))}{row('Since', t.since ? formatDate(t.since) : null)}
      </div>
      {(t.route.stops ?? []).length > 0 && (
        <div className="card">
          <h3 className="section-title mb-1">Stops on this route</h3>
          <ol className="space-y-1 text-sm">{t.route.stops.map((s: any, i: number) => (
            <li key={s.id ?? i} className={cn('flex justify-between gap-2', s.name === t.stop?.name && 'font-semibold text-primary-700')}><span>{i + 1}. {s.name}</span><span className="font-mono text-xs text-gray-500">{s.pickupTime ?? ''}</span></li>
          ))}</ol>
        </div>
      )}
    </div>
  );
}
