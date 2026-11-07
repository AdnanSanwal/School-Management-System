'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Field, Spinner } from '@/components/ui/kit';
import { schoolAPI, paymentsAPI, messagingAPI, apiError } from '@/lib/api';
import { CAN, can } from '@/lib/roles';
import { useAuthStore } from '@/store/authStore';
import { formatDate, formatDateTime } from '@/lib/utils';

export default function SchoolSettingsPage() {
  const role = useAuthStore((s) => s.user?.role);
  const qc = useQueryClient();
  const school = useQuery({ queryKey: ['school'], queryFn: schoolAPI.get });
  const years = useQuery({ queryKey: ['years'], queryFn: schoolAPI.years });
  const [f, setF] = useState({ name: '', address: '', phone: '', email: '', timezone: '', lateFeeAmount: '0', lateFeeGraceDays: '7', lowAttendanceThreshold: '75', libraryFinePerDay: '0' });
  const [y, setY] = useState({ name: '', startDate: '', endDate: '' });

  useEffect(() => {
    if (school.data) setF({
      name: school.data.name, address: school.data.address ?? '', phone: school.data.phone ?? '', email: school.data.email ?? '', timezone: school.data.timezone,
      lateFeeAmount: String(Number(school.data.lateFeeAmount)), lateFeeGraceDays: String(school.data.lateFeeGraceDays), lowAttendanceThreshold: String(school.data.lowAttendanceThreshold),
      libraryFinePerDay: String(Number(school.data.libraryFinePerDay ?? 0)),
    });
  }, [school.data]);

  const save = useMutation({
    mutationFn: () => schoolAPI.update({
      name: f.name, address: f.address || null, phone: f.phone || null, email: f.email || null, timezone: f.timezone,
      lateFeeAmount: Number(f.lateFeeAmount), lateFeeGraceDays: Number(f.lateFeeGraceDays), lowAttendanceThreshold: Number(f.lowAttendanceThreshold),
      libraryFinePerDay: Number(f.libraryFinePerDay),
    }),
    onSuccess: () => { toast.success('Saved'); qc.invalidateQueries({ queryKey: ['school'] }); },
    onError: (e) => toast.error(apiError(e)),
  });
  const addYear = useMutation({
    mutationFn: () => schoolAPI.createYear(y),
    onSuccess: () => { toast.success('Academic year added'); setY({ name: '', startDate: '', endDate: '' }); qc.invalidateQueries({ queryKey: ['years'] }); },
    onError: (e) => toast.error(apiError(e)),
  });
  const makeCurrent = useMutation({
    mutationFn: (id: string) => schoolAPI.makeCurrent(id),
    onSuccess: () => { toast.success('Current year changed'); qc.invalidateQueries(); },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <DashboardLayout title="School settings" allowedRoles={CAN.manageSchool}>
      {school.isLoading ? <Spinner /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <form className="card space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <h3 className="section-title">School profile</h3>
            <Field label="Name"><input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Address" hint="Printed on receipts"><input className="input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Phone"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
              <Field label="Email"><input type="email" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            </div>
            <Field label="Timezone" hint="Decides what “today” means for attendance and collections"><input className="input" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Late fee" hint="0 = no late fee"><input type="number" min="0" className="input" value={f.lateFeeAmount} onChange={(e) => setF({ ...f, lateFeeAmount: e.target.value })} /></Field>
              <Field label="Grace days" hint="after the due date"><input type="number" min="0" max="90" className="input" value={f.lateFeeGraceDays} onChange={(e) => setF({ ...f, lateFeeGraceDays: e.target.value })} /></Field>
              <Field label="Low attendance %" hint="alert below this"><input type="number" min="0" max="100" className="input" value={f.lowAttendanceThreshold} onChange={(e) => setF({ ...f, lowAttendanceThreshold: e.target.value })} /></Field>
            </div>
            <Field label="Library fine per day" hint="charged for each day a book is returned late; 0 = none"><input type="number" min="0" className="input" value={f.libraryFinePerDay} onChange={(e) => setF({ ...f, libraryFinePerDay: e.target.value })} /></Field>
            <p className="text-xs text-gray-500">Late fees are added automatically every morning; fee reminders and low-attendance alerts go out on Mondays.</p>
            <p className="text-xs text-gray-500">School code: <code>{school.data?.code}</code> · Currency: {school.data?.currency}</p>
            <button className="btn btn-primary" disabled={save.isPending}>Save</button>
          </form>

          <div className="card space-y-3">
            <h3 className="section-title">Academic years</h3>
            <ul className="divide-y divide-slate-100">
              {(years.data ?? []).map((yr: any) => (
                <li key={yr.id} className="flex items-center justify-between py-2 text-sm">
                  <span><b>{yr.name}</b> <span className="text-gray-500">{formatDate(yr.startDate)} – {formatDate(yr.endDate)}</span></span>
                  {yr.isCurrent ? <span className="badge badge-green">current</span> : (
                    <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => confirm(`Make ${yr.name} the current year? New invoices and subject assignments will use it.`) && makeCurrent.mutate(yr.id)}>Make current</button>
                  )}
                </li>
              ))}
            </ul>
            <form className="grid grid-cols-3 gap-2" onSubmit={(e) => { e.preventDefault(); addYear.mutate(); }}>
              <input className="input" required placeholder="2027-28" value={y.name} onChange={(e) => setY({ ...y, name: e.target.value })} aria-label="Year name" />
              <input type="date" className="input" required value={y.startDate} onChange={(e) => setY({ ...y, startDate: e.target.value })} aria-label="Start date" />
              <input type="date" className="input" required value={y.endDate} onChange={(e) => setY({ ...y, endDate: e.target.value })} aria-label="End date" />
              <button className="btn btn-secondary col-span-3" disabled={addYear.isPending}>Add academic year</button>
            </form>
          </div>
          {can(role, 'manageFeeStructure') && <PaymentAccounts />}
          <Messaging />
        </div>
      )}
    </DashboardLayout>
  );
}

function PaymentAccounts() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['payment-options'], queryFn: paymentsAPI.options });
  const [a, setA] = useState({ method: 'JAZZCASH', title: '', accountNo: '', bankName: '', iban: '' });
  const add = useMutation({
    mutationFn: () => paymentsAPI.addAccount({ ...a, bankName: a.bankName || null, iban: a.iban || null }),
    onSuccess: () => { toast.success('Account added'); setA({ ...a, title: '', accountNo: '', bankName: '', iban: '' }); qc.invalidateQueries({ queryKey: ['payment-options'] }); },
    onError: (e) => toast.error(apiError(e)),
  });
  const remove = useMutation({
    mutationFn: paymentsAPI.removeAccount,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payment-options'] }),
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <div className="card space-y-3 lg:col-span-2">
      <h3 className="section-title">Accounts for online fee payment</h3>
      <p className="text-xs text-gray-500">
        Parents see these in the app, pay into one, and submit the transaction ID; the accountant verifies it under Approvals.
        {data?.gateway ? ` Online checkout: ${data.gateway.label}.` : ' Card/wallet checkout turns on once a payment gateway is configured.'}
      </p>
      <ul className="divide-y divide-slate-100">
        {(data?.accounts ?? []).map((x: any) => (
          <li key={x.id} className="flex items-center justify-between py-2 text-sm">
            <span><b>{x.method.replace('_', ' ').toLowerCase()}</b> · {x.title} · <code>{x.accountNo}</code>{x.bankName ? ` · ${x.bankName}` : ''}{x.iban ? ` · ${x.iban}` : ''}</span>
            <button className="btn btn-ghost px-2 py-1 text-xs text-red-600" onClick={() => confirm('Remove this account?') && remove.mutate(x.id)}>Remove</button>
          </li>
        ))}
        {data?.accounts?.length === 0 && <li className="py-2 text-sm text-gray-500">No accounts yet.</li>}
      </ul>
      <form className="grid gap-2 md:grid-cols-6" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <select className="select" value={a.method} onChange={(e) => setA({ ...a, method: e.target.value })} aria-label="Method">
          <option value="JAZZCASH">JazzCash</option><option value="EASYPAISA">Easypaisa</option><option value="BANK_TRANSFER">Bank</option>
        </select>
        <input className="input" required placeholder="Account title" value={a.title} onChange={(e) => setA({ ...a, title: e.target.value })} aria-label="Account title" />
        <input className="input" required placeholder="Account / mobile no." value={a.accountNo} onChange={(e) => setA({ ...a, accountNo: e.target.value })} aria-label="Account number" />
        <input className="input" placeholder="Bank (optional)" value={a.bankName} onChange={(e) => setA({ ...a, bankName: e.target.value })} aria-label="Bank name" />
        <input className="input" placeholder="IBAN (optional)" value={a.iban} onChange={(e) => setA({ ...a, iban: e.target.value })} aria-label="IBAN" />
        <button className="btn btn-secondary" disabled={add.isPending}>Add</button>
      </form>
    </div>
  );
}

const TYPE_LABEL: Record<string, string> = {
  ATTENDANCE_ABSENT: 'Child marked absent',
  FEE_DUE: 'Fee reminders',
  FEE_PAID: 'Fee received',
  RESULT_PUBLISHED: 'Results published',
  LOW_ATTENDANCE: 'Low attendance alert',
};

function Messaging() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['messaging'], queryFn: messagingAPI.get });
  const [f, setF] = useState<{ messagingEnabled: boolean; messagingChannel: string; messagingTypes: string[] }>({ messagingEnabled: false, messagingChannel: 'SMS', messagingTypes: [] });
  const [phone, setPhone] = useState('');
  useEffect(() => {
    if (data) setF({ messagingEnabled: data.messagingEnabled, messagingChannel: data.messagingChannel, messagingTypes: data.messagingTypes });
  }, [data]);
  const save = useMutation({
    mutationFn: () => messagingAPI.save(f),
    onSuccess: () => { toast.success(f.messagingEnabled ? 'WhatsApp/SMS alerts on' : 'WhatsApp/SMS alerts off'); qc.invalidateQueries({ queryKey: ['messaging'] }); },
    onError: (e) => toast.error(apiError(e)),
  });
  const test = useMutation({
    mutationFn: () => messagingAPI.test(phone),
    onSuccess: (r: any) => {
      if (r.status === 'SENT') toast.success(`Sent to ${r.to}`); else toast.error(`Failed: ${r.error}`);
      qc.invalidateQueries({ queryKey: ['messaging'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });
  if (!data) return null;
  const toggleType = (t: string) => setF({ ...f, messagingTypes: f.messagingTypes.includes(t) ? f.messagingTypes.filter((x) => x !== t) : [...f.messagingTypes, t] });

  return (
    <div className="card space-y-3 lg:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="section-title">WhatsApp / SMS alerts</h3>
        <span className="text-xs text-gray-500">
          Provider: {data.provider ?? <span className="text-red-600">not configured on the server</span>}
          {' · '}last 30 days: {data.last30Days.SENT ?? 0} sent, {data.last30Days.FAILED ?? 0} failed
        </span>
      </div>
      <p className="text-sm text-gray-500">Sent to the primary guardian’s phone, on top of the app notification. Each message may cost money with your provider.</p>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={f.messagingEnabled} onChange={(e) => setF({ ...f, messagingEnabled: e.target.checked })} /> Send alerts</label>
          <Field label="Channel">
            <select className="select" value={f.messagingChannel} onChange={(e) => setF({ ...f, messagingChannel: e.target.value })}>
              <option value="SMS">SMS</option><option value="WHATSAPP">WhatsApp</option>
            </select>
          </Field>
        </div>
        <div className="space-y-1.5 text-sm">
          <span className="label">Send for</span>
          {data.availableTypes.map((t: string) => (
            <label key={t} className="flex items-center gap-2"><input type="checkbox" checked={f.messagingTypes.includes(t)} onChange={() => toggleType(t)} /> {TYPE_LABEL[t] ?? t}</label>
          ))}
        </div>
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); test.mutate(); }}>
          <Field label="Send a test message" hint="e.g. 0300 1234567"><input className="input" required value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          <button className="btn btn-secondary w-full" disabled={test.isPending || !data.provider}>Send test</button>
        </form>
      </div>
      <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>Save alert settings</button>
      {data.recent.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-gray-600">Recent messages ({data.recent.length})</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="table">
              <thead><tr><th>When</th><th>To</th><th>Type</th><th>Message</th><th>Status</th></tr></thead>
              <tbody>
                {data.recent.map((m: any) => (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap text-xs">{formatDateTime(m.createdAt)}</td>
                    <td className="text-xs">{m.to}</td>
                    <td className="text-xs">{TYPE_LABEL[m.type] ?? m.type.toLowerCase()}</td>
                    <td className="max-w-md text-xs text-gray-600">{m.body}</td>
                    <td><span className={`badge ${m.status === 'SENT' ? 'badge-green' : m.status === 'FAILED' ? 'badge-red' : 'badge-yellow'}`} title={m.error ?? undefined}>{m.status.toLowerCase()}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
