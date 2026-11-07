'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Bus, Pencil, Trash2, UserPlus, X, ArrowUp, ArrowDown } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Field, Modal, Spinner, Empty, StudentPicker } from '@/components/ui/kit';
import { transportAPI, apiError } from '@/lib/api';
import { CAN, can } from '@/lib/roles';
import { cn, formatMoney } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';

export default function TransportPage() {
  const user = useAuthStore((s) => s.user);
  const manage = can(user?.role, 'manageTransport');
  const currency = user?.school?.currency ?? 'PKR';
  const { data: routes = [], isLoading, error } = useQuery({ queryKey: ['transport', 'routes'], queryFn: transportAPI.routes });
  const [selected, setSelected] = useState<string>('');
  const [edit, setEdit] = useState<any | null>(null);
  useEffect(() => { if (!selected && routes[0]) setSelected(routes[0].id); }, [routes, selected]);
  const route = routes.find((r: any) => r.id === selected);

  return (
    <DashboardLayout title="Transport" allowedRoles={CAN.viewTransport} subtitle="Routes, stops and who rides them. The monthly fee is added to each rider’s invoice."
      actions={manage && <button className="btn btn-primary" onClick={() => setEdit({})}><Plus className="h-4 w-4" /> New route</button>}>
      {isLoading ? <Spinner /> : error ? <div className="card text-sm text-red-600">{apiError(error)}</div> : !routes.length ? (
        <div className="card"><Empty title="No routes yet">{manage ? 'Add a route with its van/bus, driver and monthly fee.' : null}</Empty></div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <ul className="card h-fit divide-y divide-slate-100 p-2">
            {routes.map((r: any) => (
              <li key={r.id}>
                <button className={cn('w-full rounded-lg px-3 py-2.5 text-left', r.id === selected ? 'bg-primary-50' : 'hover:bg-slate-50')} onClick={() => setSelected(r.id)}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{r.name}</span>
                    {!r.isActive && <span className="badge badge-gray">inactive</span>}
                  </div>
                  <p className="text-xs text-gray-500">
                    {r.riders}{r.capacity ? `/${r.capacity}` : ''} riders · {formatMoney(r.monthlyFee, currency)}/month{r.vehicleNo ? ` · ${r.vehicleNo}` : ''}
                  </p>
                </button>
              </li>
            ))}
          </ul>
          {route && <RouteDetail key={route.id} route={route} manage={manage} currency={currency} onEdit={() => setEdit(route)} onDeleted={() => setSelected('')} />}
        </div>
      )}
      {edit && <RouteModal route={edit} onClose={() => setEdit(null)} onSaved={(id) => { setEdit(null); if (id) setSelected(id); }} />}
    </DashboardLayout>
  );
}

function RouteDetail({ route, manage, currency, onEdit, onDeleted }: { route: any; manage: boolean; currency: string; onEdit: () => void; onDeleted: () => void }) {
  const qc = useQueryClient();
  const riders = useQuery({ queryKey: ['transport', 'riders', route.id], queryFn: () => transportAPI.riders(route.id) });
  const [adding, setAdding] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['transport'] });
  const remove = useMutation({
    mutationFn: () => transportAPI.deleteRoute(route.id),
    onSuccess: () => { toast.success('Route removed'); refresh(); onDeleted(); },
    onError: (e) => toast.error(apiError(e)),
  });
  const unassign = useMutation({
    mutationFn: transportAPI.unassign,
    onSuccess: () => { toast.success('Removed from route'); refresh(); },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <div className="space-y-4 lg:col-span-2">
      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="section-title flex items-center gap-2"><Bus className="h-4 w-4" /> {route.name}</h3>
            <p className="mt-1 text-sm text-gray-600">
              {route.vehicleNo ?? 'No vehicle no.'} · Driver: {route.driverName ?? '—'}{route.driverPhone ? ` (${route.driverPhone})` : ''}
            </p>
            <p className="text-sm text-gray-600">Fee {formatMoney(route.monthlyFee, currency)}/month · {route.riders}{route.capacity ? ` of ${route.capacity}` : ''} seats used</p>
          </div>
          {manage && (
            <div className="flex gap-1">
              <button className="btn btn-ghost px-2 py-1 text-xs" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /> Edit</button>
              <button className="btn btn-ghost px-2 py-1 text-xs text-red-600" onClick={() => confirm(`Remove ${route.name}?`) && remove.mutate()}><Trash2 className="h-3.5 w-3.5" /> Remove</button>
            </div>
          )}
        </div>
        <Stops route={route} manage={manage} />
      </div>

      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="section-title">Riders</h3>
          {manage && <button className="btn btn-secondary px-3 py-1.5 text-sm" onClick={() => setAdding(true)}><UserPlus className="h-4 w-4" /> Add student</button>}
        </div>
        {riders.isLoading ? <Spinner /> : !riders.data?.length ? <Empty title="No riders on this route" /> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Student</th><th>Class</th><th>Stop</th><th>Parent</th><th /></tr></thead>
              <tbody>
                {riders.data.map((r: any) => (
                  <tr key={r.studentId}>
                    <td><p className="font-medium">{r.name}</p><p className="text-xs text-gray-500">{r.admissionNo}</p></td>
                    <td className="text-sm">{r.section ?? '—'}</td>
                    <td className="text-sm">{r.stop ?? '—'}{r.pickupTime ? <span className="text-gray-500"> · {r.pickupTime}</span> : null}</td>
                    <td className="text-sm">{r.guardian ? `${r.guardian.name}${r.guardian.phone ? ` · ${r.guardian.phone}` : ''}` : '—'}</td>
                    <td>{manage && <button className="btn-icon btn-ghost h-7 w-7 text-red-500" aria-label={`Remove ${r.name}`} onClick={() => confirm(`Remove ${r.name} from this route? The transport fee stops from the next invoice.`) && unassign.mutate(r.studentId)}><X className="h-3.5 w-3.5" /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {adding && <AssignModal route={route} onClose={() => setAdding(false)} />}
    </div>
  );
}

function Stops({ route, manage }: { route: any; manage: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [stops, setStops] = useState<any[]>(route.stops);
  useEffect(() => setStops(route.stops), [route.stops]);
  const save = useMutation({
    mutationFn: () => transportAPI.saveStops(route.id, stops.filter((s) => s.name.trim()).map((s) => ({
      id: s.id, name: s.name.trim(), pickupTime: s.pickupTime || null, dropTime: s.dropTime || null,
    }))),
    onSuccess: () => { toast.success('Stops saved'); setEditing(false); qc.invalidateQueries({ queryKey: ['transport'] }); },
    onError: (e) => toast.error(apiError(e)),
  });
  const move = (i: number, d: number) => {
    const next = [...stops];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setStops(next);
  };

  if (!editing) {
    return (
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-gray-700">Stops</h4>
          {manage && <button className="text-xs text-primary-600 hover:underline" onClick={() => setEditing(true)}>Edit stops</button>}
        </div>
        {!route.stops.length ? <p className="text-sm text-gray-500">No stops added.</p> : (
          <ol className="space-y-1 text-sm">
            {route.stops.map((s: any, i: number) => (
              <li key={s.id} className="flex gap-3"><span className="w-5 text-gray-400">{i + 1}.</span><span className="flex-1">{s.name}</span>
                <span className="text-gray-500">{s.pickupTime ?? '—'} / {s.dropTime ?? '—'}</span></li>
            ))}
          </ol>
        )}
      </div>
    );
  }
  return (
    <div className="mt-4 space-y-2">
      <div className="grid grid-cols-[1fr_7rem_7rem_4.5rem] gap-2 text-xs text-gray-500"><span>Stop</span><span>Pick-up</span><span>Drop</span><span /></div>
      {stops.map((s, i) => (
        <div key={s.id ?? `new-${i}`} className="grid grid-cols-[1fr_7rem_7rem_4.5rem] items-center gap-2">
          <input className="input py-1.5" value={s.name} aria-label="Stop name" onChange={(e) => setStops(stops.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
          <input type="time" className="input py-1.5" value={s.pickupTime ?? ''} aria-label="Pick-up time" onChange={(e) => setStops(stops.map((x, j) => j === i ? { ...x, pickupTime: e.target.value } : x))} />
          <input type="time" className="input py-1.5" value={s.dropTime ?? ''} aria-label="Drop time" onChange={(e) => setStops(stops.map((x, j) => j === i ? { ...x, dropTime: e.target.value } : x))} />
          <div className="flex">
            <button type="button" className="btn-icon btn-ghost h-7 w-7" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp className="h-3.5 w-3.5" /></button>
            <button type="button" className="btn-icon btn-ghost h-7 w-7" disabled={i === stops.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown className="h-3.5 w-3.5" /></button>
            <button type="button" className="btn-icon btn-ghost h-7 w-7 text-red-500" onClick={() => setStops(stops.filter((_, j) => j !== i))} aria-label="Remove stop"><X className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap justify-between gap-2">
        <button type="button" className="btn btn-ghost px-2 py-1 text-sm" onClick={() => setStops([...stops, { name: '', pickupTime: '', dropTime: '' }])}><Plus className="h-4 w-4" /> Add stop</button>
        <div className="flex gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => { setStops(route.stops); setEditing(false); }}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>Save stops</button>
        </div>
      </div>
      <p className="text-xs text-gray-500">Removing a stop leaves its riders on the route without a stop.</p>
    </div>
  );
}

function RouteModal({ route, onClose, onSaved }: { route: any; onClose: () => void; onSaved: (id?: string) => void }) {
  const qc = useQueryClient();
  const isNew = !route.id;
  const [f, setF] = useState({
    name: route.name ?? '', vehicleNo: route.vehicleNo ?? '', driverName: route.driverName ?? '', driverPhone: route.driverPhone ?? '',
    capacity: route.capacity ? String(route.capacity) : '', monthlyFee: route.monthlyFee !== undefined ? String(Number(route.monthlyFee)) : '0',
    isActive: route.isActive ?? true,
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const m = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name, vehicleNo: f.vehicleNo || null, driverName: f.driverName || null, driverPhone: f.driverPhone || null,
        capacity: f.capacity ? Number(f.capacity) : null, monthlyFee: Number(f.monthlyFee || 0), isActive: f.isActive,
      };
      return isNew ? transportAPI.createRoute(body) : transportAPI.updateRoute(route.id, body);
    },
    onSuccess: (r: any) => { toast.success(isNew ? 'Route added' : 'Route updated'); qc.invalidateQueries({ queryKey: ['transport'] }); onSaved(r?.id); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={onClose} title={isNew ? 'New route' : `Edit ${route.name}`}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Route name"><input className="input" required minLength={2} placeholder="Route 1 — Model Town" value={f.name} onChange={set('name')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Vehicle no."><input className="input" value={f.vehicleNo} onChange={set('vehicleNo')} /></Field>
          <Field label="Seats" hint="blank = no limit"><input type="number" min="1" max="200" className="input" value={f.capacity} onChange={set('capacity')} /></Field>
          <Field label="Driver"><input className="input" value={f.driverName} onChange={set('driverName')} /></Field>
          <Field label="Driver phone"><input className="input" value={f.driverPhone} onChange={set('driverPhone')} /></Field>
        </div>
        <Field label="Monthly fee" hint="Added as a “Transport” line to each rider’s monthly invoice">
          <input type="number" min="0" className="input" required value={f.monthlyFee} onChange={set('monthlyFee')} />
        </Field>
        {!isNew && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Route is running</label>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={m.isPending}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

function AssignModal({ route, onClose }: { route: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [student, setStudent] = useState<any>(null);
  const [stopId, setStopId] = useState('');
  const m = useMutation({
    mutationFn: () => transportAPI.assign(student.id, route.id, stopId || null),
    onSuccess: () => { toast.success(`${student.name} added to ${route.name}`); qc.invalidateQueries({ queryKey: ['transport'] }); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={onClose} title={`Add student to ${route.name}`}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (student) m.mutate(); }}>
        <Field label="Student"><StudentPicker value={student} onChange={setStudent} /></Field>
        <Field label="Stop">
          <select className="select" value={stopId} onChange={(e) => setStopId(e.target.value)}>
            <option value="">No particular stop</option>
            {route.stops.map((s: any) => <option key={s.id} value={s.id}>{s.name}{s.pickupTime ? ` (${s.pickupTime})` : ''}</option>)}
          </select>
        </Field>
        <p className="text-xs text-gray-500">A student already on another route is moved to this one.</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!student || m.isPending}>Add</button>
        </div>
      </form>
    </Modal>
  );
}
