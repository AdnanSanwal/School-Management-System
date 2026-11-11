'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Lock, RotateCcw, Save } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Spinner } from '@/components/ui/kit';
import { rolesAPI, apiError, RoleMatrix } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { cn } from '@/lib/utils';

/** The owner decides what each staff role may do in this school. */
export default function RolesPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['roles'], queryFn: rolesAPI.matrix });
  const [role, setRole] = useState('PRINCIPAL');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const current = data?.roles.find((r) => r.role === role);
  const saved = useMemo(() => new Set(current?.permissions.filter((p) => p.granted).map((p) => p.key)), [current]);
  useEffect(() => { setPicked(new Set(saved)); }, [saved]);

  const dirty = current ? current.permissions.some((p) => picked.has(p.key) !== saved.has(p.key)) : false;
  const done = (r: { data: { data: RoleMatrix; message: string } }) => { toast.success(r.data.message); qc.setQueryData(['roles'], r.data.data); qc.invalidateQueries({ queryKey: ['session'] }); };
  const onError = (e: unknown) => toast.error(apiError(e), { duration: 7000 });
  const save = useMutation({ mutationFn: () => rolesAPI.save(role, [...picked]), onSuccess: done, onError });
  const reset = useMutation({ mutationFn: () => rolesAPI.reset(role), onSuccess: done, onError });
  const toggle = (key: string) => setPicked((old) => { const next = new Set(old); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const switchRole = (next: string) => { if (!dirty || window.confirm('Leave without saving the changes to this role?')) setRole(next); };

  return (
    <DashboardLayout title="Roles & permissions" allowedRoles={CAN.manageRoles} subtitle="Choose what each staff role may do in your school. Changes apply straight away.">
      {isLoading ? <Spinner /> : error ? <div className="card text-sm text-red-600">{apiError(error)}</div> : data && current && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {data.roles.map((r) => (
              <button key={r.role} onClick={() => switchRole(r.role)} className={cn('card text-left transition', r.role === role ? 'ring-2 ring-primary-400' : 'hover:shadow-md')}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{r.label}</span>
                  {r.changed > 0 ? <span className="badge badge-yellow">{r.changed} changed</span> : <span className="badge badge-gray">standard</span>}
                </div>
                <p className="mt-1 text-xs text-gray-500">{r.about}</p>
                <p className="mt-2 text-xs text-gray-400">{r.users} active login{r.users === 1 ? '' : 's'}</p>
              </button>
            ))}
          </div>

          <div className="card space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="section-title">{current.label} may…</h3>
                <p className="text-xs text-gray-500">Ticked = allowed. A yellow dot marks a difference from the standard set.</p>
              </div>
              <div className="flex gap-2">
                <button className="btn-secondary" disabled={reset.isPending || (current.changed === 0 && !dirty)}
                  onClick={() => window.confirm(`Put ${current.label} back to the standard permissions?`) && reset.mutate()}><RotateCcw className="h-4 w-4" /> Standard set</button>
                <button className="btn-primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}><Save className="h-4 w-4" /> Save</button>
              </div>
            </div>
            <div className="grid gap-x-8 gap-y-5 lg:grid-cols-2">
              {data.modules.map((m) => {
                const items = current.permissions.filter((p) => p.module === m);
                if (!items.length) return null;
                return (
                  <fieldset key={m}>
                    <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">{m}</legend>
                    <ul className="space-y-1">
                      {items.map((p) => {
                        const on = picked.has(p.key);
                        const locked = !p.available;
                        return (
                          <li key={p.key}>
                            <label className={cn('flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm', locked ? 'text-gray-400' : 'cursor-pointer hover:bg-slate-50')}>
                              <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={on} disabled={locked} onChange={() => toggle(p.key)} />
                              <span className="flex-1">{p.label}</span>
                              {locked && <Lock className="h-3.5 w-3.5" aria-label="Not available for this role" />}
                              {on !== p.standard && <span className="h-2 w-2 rounded-full bg-amber-400" title={p.standard ? 'Standard: allowed' : 'Standard: not allowed'} />}
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </fieldset>
                );
              })}
            </div>
            <ul className="space-y-1 border-t border-slate-100 pt-3 text-xs text-gray-500">
              <li>The owner always has full access, and parents and students only ever see their own information.</li>
              <li>Approvals (payroll, large expenses, results, concessions) can be given only to the principal, so the person who prepares something is not the one who approves it.</li>
              <li>Teachers always work inside their own classes; only a few school-wide jobs can be added to them.</li>
              <li>Everyone can read notices, the calendar and the timetable.</li>
            </ul>
          </div>
        </>
      )}
    </DashboardLayout>
  );
}
