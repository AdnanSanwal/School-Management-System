'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Pencil, Plus, Save, ShieldPlus, Trash2, X } from 'lucide-react';
import { rolesAPI, apiError, RoleMatrix } from '@/lib/api';
import { cn } from '@/lib/utils';

type Draft = { id?: string; name: string; baseRole: string; permissions: Set<string> };

/**
 * The school's own access roles (e.g. Receptionist, Librarian). Each is built on a standard
 * staff role: people with it sign in as that role, but can do only what is ticked here.
 */
export function CustomRoles({ matrix }: { matrix: RoleMatrix }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const done = (r: { data: { data: RoleMatrix; message: string } }) => {
    toast.success(r.data.message);
    qc.setQueryData(['roles'], r.data.data);
    qc.invalidateQueries({ queryKey: ['session'] });
    setDraft(null);
  };
  const onError = (e: unknown) => toast.error(apiError(e), { duration: 7000 });
  const save = useMutation({
    mutationFn: (d: Draft) => d.id
      ? rolesAPI.saveCustom(d.id, { name: d.name.trim(), permissions: [...d.permissions] })
      : rolesAPI.createCustom({ name: d.name.trim(), baseRole: d.baseRole, permissions: [...d.permissions] }),
    onSuccess: done, onError,
  });
  const remove = useMutation({ mutationFn: (id: string) => rolesAPI.deleteCustom(id), onSuccess: done, onError });

  const choices = draft ? matrix.customChoices[draft.baseRole] ?? [] : [];
  const modules = [...new Set(choices.map((c) => c.module))];
  const base = draft ? matrix.customBases.find((b) => b.role === draft.baseRole) : undefined;
  const toggle = (key: string) => setDraft((d) => {
    if (!d) return d;
    const next = new Set(d.permissions);
    if (next.has(key)) next.delete(key); else next.add(key);
    return { ...d, permissions: next };
  });
  // A new role starts from what its base role can do as standard.
  const startNew = (baseRole = 'ADMIN', name = '') => {
    const std = matrix.roles.find((r) => r.role === baseRole)?.permissions.filter((p) => p.standard).map((p) => p.key) ?? [];
    const allowed = new Set((matrix.customChoices[baseRole] ?? []).map((c) => c.key));
    setDraft({ name, baseRole, permissions: new Set(std.filter((k) => allowed.has(k))) });
  };

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="section-title flex items-center gap-2"><ShieldPlus className="h-4 w-4 text-primary-600" /> Your own roles</h3>
          <p className="text-xs text-gray-500">Make roles such as Receptionist or Librarian with exactly the permissions they need, then give them to people when you create or change their login.</p>
        </div>
        {!draft && <button className="btn-primary" onClick={() => startNew()}><Plus className="h-4 w-4" /> New role</button>}
      </div>

      {matrix.custom.length === 0 && !draft && <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-sm text-gray-500">No roles of your own yet.</p>}

      {matrix.custom.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {matrix.custom.map((r) => (
            <div key={r.id} className={cn('rounded-xl border p-4', draft?.id === r.id ? 'border-primary-300 ring-2 ring-primary-200' : 'border-slate-200')}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{r.name}</p>
                  <p className="text-xs text-gray-500">Built on {r.baseLabel} · {r.permissions.length} permission{r.permissions.length === 1 ? '' : 's'}</p>
                </div>
                <div className="flex gap-1">
                  <button className="btn-ghost p-1.5" aria-label={`Edit ${r.name}`} onClick={() => setDraft({ id: r.id, name: r.name, baseRole: r.baseRole, permissions: new Set(r.permissions) })}><Pencil className="h-4 w-4" /></button>
                  <button className="btn-ghost p-1.5 text-red-600" aria-label={`Delete ${r.name}`} disabled={remove.isPending}
                    onClick={() => window.confirm(r.users ? `Delete “${r.name}”? Its ${r.users} ${r.users > 1 ? 'people' : 'person'} will go back to the standard ${r.baseLabel} role.` : `Delete “${r.name}”?`) && remove.mutate(r.id)}><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
              <p className="mt-2 text-xs text-gray-400">{r.users} active login{r.users === 1 ? '' : 's'}</p>
            </div>
          ))}
        </div>
      )}

      {draft && (
        <form className="space-y-4 rounded-xl border border-primary-200 bg-primary-50/30 p-4"
          onSubmit={(e) => { e.preventDefault(); if (draft.name.trim().length < 2) { toast.error('Give the role a name'); return; } save.mutate(draft); }}>
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[12rem] flex-1 text-sm">
              <span className="mb-1 block font-medium text-gray-700">Role name <span className="text-red-500">*</span></span>
              <input className="input" value={draft.name} maxLength={60} autoFocus placeholder="e.g. Receptionist" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="min-w-[14rem] text-sm">
              <span className="mb-1 block font-medium text-gray-700">Built on</span>
              <select className="select" value={draft.baseRole} disabled={!!draft.id} onChange={(e) => startNew(e.target.value, draft.name)}>
                {matrix.customBases.map((b) => <option key={b.role} value={b.role}>{b.label}</option>)}
              </select>
            </label>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary" onClick={() => setDraft(null)}><X className="h-4 w-4" /> Cancel</button>
              <button className="btn-primary" disabled={save.isPending}><Save className="h-4 w-4" /> {draft.id ? 'Save role' : 'Create role'}</button>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            {base?.about}. People with this role sign in with the {base?.label.toLowerCase()} dashboard and may create the same logins, but can only do what is ticked below.
          </p>
          <div className="grid gap-x-8 gap-y-4 lg:grid-cols-2">
            {modules.map((m) => (
              <fieldset key={m}>
                <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">{m}</legend>
                <ul className="space-y-0.5">
                  {choices.filter((c) => c.module === m).map((c) => (
                    <li key={c.key}>
                      <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1 text-sm hover:bg-white">
                        <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={draft.permissions.has(c.key)} onChange={() => toggle(c.key)} />
                        {c.label}
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
            ))}
          </div>
        </form>
      )}
    </div>
  );
}
