'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Save } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Spinner, Modal, Field, Empty } from '@/components/ui/kit';
import { feesAPI, apiError } from '@/lib/api';
import { CAN, can } from '@/lib/roles';
import { formatMoney } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';

export default function FeeStructurePage() {
  const user = useAuthStore((s) => s.user);
  const currency = user?.school?.currency ?? 'PKR';
  const editable = can(user?.role, 'manageFeeStructure');
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['fee-structure'], queryFn: feesAPI.structure });
  const [grid, setGrid] = useState<Record<string, Record<string, string>>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [addHead, setAddHead] = useState(false);

  useEffect(() => {
    if (!data) return;
    setGrid(Object.fromEntries(data.classes.map((c: any) => [c.id, Object.fromEntries(Object.entries(c.amounts).map(([h, v]) => [h, String(Number(v))]))])));
    setDirty(new Set());
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      for (const classId of dirty) {
        const items = Object.entries(grid[classId] ?? {}).filter(([, v]) => v !== '' && Number(v) > 0).map(([feeHeadId, v]) => ({ feeHeadId, amount: Number(v) }));
        await feesAPI.saveStructure(classId, items);
      }
    },
    onSuccess: () => { toast.success('Fee structure saved'); qc.invalidateQueries({ queryKey: ['fee-structure'] }); },
    onError: (e) => toast.error(apiError(e)),
  });

  const heads: any[] = data?.heads ?? [];
  return (
    <DashboardLayout title="Fee structure" allowedRoles={CAN.viewFees}
      subtitle={data ? `Class-wise fee for ${data.academicYear.name}. Changes apply to invoices generated afterwards.` : undefined}
      actions={editable && <>
        <button className="btn btn-secondary" onClick={() => setAddHead(true)}><Plus className="h-4 w-4" /> Fee head</button>
        <button className="btn btn-primary" disabled={!dirty.size || save.isPending} onClick={() => save.mutate()}><Save className="h-4 w-4" /> Save changes</button>
      </>}>
      <div className="card">
        {isLoading || !data ? <Spinner /> : heads.length === 0 ? <Empty title="No fee heads yet">Add heads such as Tuition, Lab or Transport first.</Empty> : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr><th>Class</th>{heads.map((h) => <th key={h.id} className="text-right">{h.name}<span className="block text-2xs font-normal text-gray-400">{h.frequency.replace('_', ' ').toLowerCase()}</span></th>)}<th className="text-right">Monthly total</th><th className="text-right">Yearly total<span className="block text-2xs font-normal text-gray-400">12 months + annual</span></th></tr>
              </thead>
              <tbody>
                {data.classes.map((c: any) => {
                  const sum = (freq: string) => heads.filter((h) => h.frequency === freq).reduce((s, h) => s + Number(grid[c.id]?.[h.id] || 0), 0);
                  const monthly = sum('MONTHLY');
                  const yearly = monthly * 12 + sum('ANNUAL');
                  return (
                    <tr key={c.id}>
                      <td className="font-medium">{c.name}</td>
                      {heads.map((h) => (
                        <td key={h.id} className="text-right">
                          {editable ? (
                            <input type="number" min="0" step="1" className="input ml-auto w-28 text-right" aria-label={`${c.name} ${h.name}`}
                              value={grid[c.id]?.[h.id] ?? ''} placeholder="—"
                              onChange={(e) => { setGrid({ ...grid, [c.id]: { ...grid[c.id], [h.id]: e.target.value } }); setDirty(new Set(dirty).add(c.id)); }} />
                          ) : grid[c.id]?.[h.id] ? formatMoney(grid[c.id][h.id], currency) : '—'}
                        </td>
                      ))}
                      <td className="text-right font-semibold">{monthly ? formatMoney(monthly, currency) : <span className="text-gray-300">—</span>}</td>
                      <td className="text-right font-semibold text-gray-900">{yearly ? formatMoney(yearly, currency) : <span className="text-gray-300">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {addHead && <HeadModal onClose={() => setAddHead(false)} />}
    </DashboardLayout>
  );
}

function HeadModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', frequency: 'MONTHLY' });
  const m = useMutation({
    mutationFn: () => feesAPI.createHead(f),
    onSuccess: () => { toast.success('Fee head added'); qc.invalidateQueries({ queryKey: ['fee-structure'] }); qc.invalidateQueries({ queryKey: ['fee-heads'] }); onClose(); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <Modal open onClose={onClose} title="New fee head">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Name"><input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Transport" /></Field>
        <Field label="Billed">
          <select className="select" value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })}>
            <option value="MONTHLY">Every month</option><option value="ANNUAL">Once a year</option><option value="ONE_TIME">One time (e.g. admission)</option>
          </select>
        </Field>
        <button className="btn btn-primary w-full" disabled={m.isPending}>Add</button>
      </form>
    </Modal>
  );
}
