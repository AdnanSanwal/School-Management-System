'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Building2, Users, GraduationCap } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Field, Modal, Spinner, Empty, Stat } from '@/components/ui/kit';
import { platformAPI, apiError } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { formatDate, formatDateTime } from '@/lib/utils';

export default function PlatformPage() {
  const qc = useQueryClient();
  const { data = [], isLoading, error } = useQuery({ queryKey: ['platform', 'schools'], queryFn: platformAPI.schools });
  const [open, setOpen] = useState(false);
  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => platformAPI.setActive(id, isActive),
    onSuccess: (_r, v) => { toast.success(v.isActive ? 'School activated' : 'School suspended'); qc.invalidateQueries({ queryKey: ['platform'] }); },
    onError: (e) => toast.error(apiError(e)),
  });
  const active = data.filter((s: any) => s.isActive);

  return (
    <DashboardLayout title="Schools" allowedRoles={CAN.platform} subtitle="Every school on this platform"
      actions={<button className="btn btn-primary" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New school</button>}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Schools" value={data.length} sub={`${active.length} active`} icon={Building2} />
        <Stat label="Active students" value={data.reduce((n: number, s: any) => n + s.activeStudents, 0)} icon={GraduationCap} tone="good" />
        <Stat label="User accounts" value={data.reduce((n: number, s: any) => n + s._count.users, 0)} icon={Users} />
      </div>
      <div className="card">
        {isLoading ? <Spinner /> : error ? <p className="text-sm text-red-600">{apiError(error)}</p> : !data.length ? <Empty title="No schools yet" /> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>School</th><th>Owner</th><th>Students</th><th>Users</th><th>Joined</th><th>Status</th><th /></tr></thead>
              <tbody>
                {data.map((s: any) => (
                  <tr key={s.id}>
                    <td><p className="font-medium">{s.name}</p><p className="text-xs text-gray-500"><code>{s.code}</code>{s.phone ? ` · ${s.phone}` : ''}</p></td>
                    <td className="text-sm">{s.owners.map((o: any) => (
                      <div key={o.email}>{o.name} <span className="text-gray-500">{o.email}</span>
                        <span className="block text-xs text-gray-400">{o.lastLoginAt ? `last login ${formatDateTime(o.lastLoginAt)}` : 'never logged in'}</span></div>
                    ))}</td>
                    <td>{s.activeStudents}</td>
                    <td>{s._count.users}</td>
                    <td className="text-sm">{formatDate(s.createdAt)}</td>
                    <td>{s.isActive ? <span className="badge badge-green">active</span> : <span className="badge badge-red">suspended</span>}</td>
                    <td>
                      <button className="btn btn-ghost px-2 py-1 text-xs" disabled={toggle.isPending}
                        onClick={() => confirm(s.isActive ? `Suspend ${s.name}? Its users will not be able to log in.` : `Activate ${s.name}?`) && toggle.mutate({ id: s.id, isActive: !s.isActive })}>
                        {s.isActive ? 'Suspend' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {open && <NewSchool onClose={() => setOpen(false)} />}
    </DashboardLayout>
  );
}

function NewSchool({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const y = new Date().getFullYear();
  const [f, setF] = useState({
    name: '', code: '', phone: '', email: '', address: '',
    yearName: `${y}-${String(y + 1).slice(2)}`, startDate: `${y}-04-01`, endDate: `${y + 1}-03-31`,
    ownerName: '', ownerEmail: '', ownerPhone: '', ownerPassword: '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const m = useMutation({
    mutationFn: () => platformAPI.create({
      name: f.name, code: f.code, phone: f.phone || undefined, email: f.email || undefined, address: f.address || undefined,
      academicYear: { name: f.yearName, startDate: f.startDate, endDate: f.endDate },
      owner: { name: f.ownerName, email: f.ownerEmail, phone: f.ownerPhone || undefined, password: f.ownerPassword },
    }),
    onSuccess: () => { toast.success('School created — the owner can log in now'); qc.invalidateQueries({ queryKey: ['platform'] }); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={onClose} title="New school" wide>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="School name"><input className="input" required minLength={2} value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value, code: f.code || '' })} /></Field>
          <Field label="Code" hint="lowercase letters, digits, dashes — used at login"><input className="input" required pattern="[a-z0-9-]{2,40}" value={f.code} onChange={set('code')} /></Field>
          <Field label="Phone"><input className="input" value={f.phone} onChange={set('phone')} /></Field>
          <Field label="Email"><input type="email" className="input" value={f.email} onChange={set('email')} /></Field>
          <Field label="Address" className="sm:col-span-2"><input className="input" value={f.address} onChange={set('address')} /></Field>
        </div>
        <div>
          <h4 className="mb-2 text-sm font-semibold text-gray-700">First academic year</h4>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Name"><input className="input" required value={f.yearName} onChange={set('yearName')} /></Field>
            <Field label="Starts"><input type="date" className="input" required value={f.startDate} onChange={set('startDate')} /></Field>
            <Field label="Ends"><input type="date" className="input" required value={f.endDate} onChange={set('endDate')} /></Field>
          </div>
        </div>
        <div>
          <h4 className="mb-2 text-sm font-semibold text-gray-700">Owner login</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><input className="input" required minLength={2} value={f.ownerName} onChange={set('ownerName')} /></Field>
            <Field label="Email"><input type="email" className="input" required value={f.ownerEmail} onChange={set('ownerEmail')} /></Field>
            <Field label="Phone"><input className="input" value={f.ownerPhone} onChange={set('ownerPhone')} /></Field>
            <Field label="Password" hint="at least 8 characters; share it with the owner"><input type="password" className="input" required minLength={8} autoComplete="new-password" value={f.ownerPassword} onChange={set('ownerPassword')} /></Field>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={m.isPending}>Create school</button>
        </div>
      </form>
    </Modal>
  );
}
