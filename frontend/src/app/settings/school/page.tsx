'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Field, Spinner } from '@/components/ui/kit';
import { schoolAPI, apiError } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { formatDate } from '@/lib/utils';

export default function SchoolSettingsPage() {
  const qc = useQueryClient();
  const school = useQuery({ queryKey: ['school'], queryFn: schoolAPI.get });
  const years = useQuery({ queryKey: ['years'], queryFn: schoolAPI.years });
  const [f, setF] = useState({ name: '', address: '', phone: '', email: '', timezone: '' });
  const [y, setY] = useState({ name: '', startDate: '', endDate: '' });

  useEffect(() => {
    if (school.data) setF({ name: school.data.name, address: school.data.address ?? '', phone: school.data.phone ?? '', email: school.data.email ?? '', timezone: school.data.timezone });
  }, [school.data]);

  const save = useMutation({
    mutationFn: () => schoolAPI.update({ name: f.name, address: f.address || null, phone: f.phone || null, email: f.email || null, timezone: f.timezone }),
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
        </div>
      )}
    </DashboardLayout>
  );
}
