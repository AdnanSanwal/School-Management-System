'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { CheckCircle2, ExternalLink, PlugZap, Save, Sparkles, Unplug } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Field, Spinner } from '@/components/ui/kit';
import { aiAPI, apiError } from '@/lib/api';
import { CAN } from '@/lib/roles';

/** A school connects its own AI account here, and sees what the platform provides. */
export default function AiSettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['ai-settings'], queryFn: aiAPI.settings });
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');

  useEffect(() => {
    if (!data) return;
    setProvider(data.own.provider ?? data.providers[0]?.id ?? '');
    setModel(data.own.model ?? '');
    setApiKey('');
  }, [data]);

  const done = (message: string) => (fresh: any) => { toast.success(message); qc.setQueryData(['ai-settings'], (old: any) => ({ ...old, ...fresh })); qc.invalidateQueries({ queryKey: ['testmaker-scope'] }); };
  const save = useMutation({ mutationFn: () => aiAPI.save({ provider, model: model.trim() || null, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) }), onSuccess: done('AI settings saved'), onError: (e) => toast.error(apiError(e)) });
  const remove = useMutation({ mutationFn: aiAPI.remove, onSuccess: done('Your AI account was disconnected'), onError: (e) => toast.error(apiError(e)) });
  const test = useMutation({ mutationFn: aiAPI.test, onSuccess: (r) => toast.success(r.message, { duration: 6000 }), onError: (e) => toast.error(apiError(e), { duration: 9000 }) });

  if (isLoading || !data) return <DashboardLayout title="AI" allowedRoles={CAN.manageSchool}><Spinner /></DashboardLayout>;

  const label = (id?: string | null) => data.providers.find((p) => p.id === id)?.label ?? id ?? '';
  const chosen = data.providers.find((p) => p.id === provider);
  const sameProvider = data.own.provider === provider && !!data.own.keyHint;
  const p = data.platform;

  return (
    <DashboardLayout title="AI" allowedRoles={CAN.manageSchool} subtitle="Used by the test maker to write papers from a topic">
      <div className="max-w-3xl space-y-4">
        <div className="card flex flex-wrap items-center gap-3">
          <Sparkles className={`h-5 w-5 ${data.active ? 'text-emerald-600' : 'text-gray-400'}`} />
          <div className="flex-1 text-sm">
            {data.active ? (
              <>
                <p className="font-medium text-gray-900">AI is on, using {data.active.source === 'OWN' ? 'your own account' : 'the account your platform provides'}.</p>
                <p className="text-gray-500">{label(data.active.provider)} · model {data.active.model}</p>
              </>
            ) : (
              <>
                <p className="font-medium text-gray-900">AI is off for this school.</p>
                <p className="text-gray-500">Connect your own account below{p.enabled ? '. Your platform has switched AI on for you, but its key is not set up yet' : ', or ask your platform administrator to provide it'}.</p>
              </>
            )}
          </div>
          {data.active && <button className="btn btn-secondary" disabled={test.isPending} onClick={() => test.mutate()}><PlugZap className="h-4 w-4" /> {test.isPending ? 'Testing…' : 'Test the connection'}</button>}
        </div>

        <div className="card space-y-4">
          <div>
            <h3 className="section-title">Your own AI account</h3>
            <p className="mt-1 text-sm text-gray-500">Use an API key from a provider your school has an account with. Your school pays that provider directly for what it uses. When a key is saved here it is used first.</p>
          </div>
          {!data.own.allowed ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Your platform administrator has switched off the use of your own AI account for this school.</p>
          ) : (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Provider">
                  <select className="select" value={provider} onChange={(e) => { setProvider(e.target.value); setModel(''); }}>
                    {data.providers.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                  </select>
                </Field>
                <Field label="Model" hint={`Leave empty to use ${chosen?.defaultModel}. Providers rename models, so check theirs if a test fails.`}>
                  <input className="input" maxLength={80} placeholder={chosen?.defaultModel} value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} />
                </Field>
              </div>
              <Field label="API key" hint={sameProvider ? `A key ending ${data.own.keyHint?.slice(-4)} is saved. Leave this empty to keep it.` : 'Stored encrypted. It is never shown again after saving.'}>
                <input className="input font-mono" type="password" autoComplete="off" maxLength={400} placeholder={sameProvider ? data.own.keyHint ?? '' : 'Paste the key here'} value={apiKey} onChange={(e) => setApiKey(e.target.value)} required={!sameProvider} />
              </Field>
              {chosen && <a className="inline-flex items-center gap-1 text-sm text-primary-600 hover:underline" href={chosen.keysUrl} target="_blank" rel="noreferrer">Get a key from {chosen.label} <ExternalLink className="h-3.5 w-3.5" /></a>}
              <div className="flex flex-wrap justify-end gap-2">
                {data.own.keyHint && <button type="button" className="btn btn-secondary text-red-600" disabled={remove.isPending} onClick={() => { if (confirm('Disconnect your AI account? The saved key is deleted.')) remove.mutate(); }}><Unplug className="h-4 w-4" /> Disconnect</button>}
                <button className="btn btn-primary" disabled={save.isPending}><Save className="h-4 w-4" /> {save.isPending ? 'Saving…' : 'Save'}</button>
              </div>
            </form>
          )}
        </div>

        <div className="card space-y-3">
          <h3 className="section-title">Provided by your platform</h3>
          {!p.enabled ? (
            <p className="text-sm text-gray-500">Your platform administrator has not switched AI on for this school.</p>
          ) : (
            <>
              <p className="flex items-center gap-2 text-sm text-gray-700"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> {label(p.provider)} is provided to this school{data.active?.source === 'OWN' ? '. It is not being used while your own key is saved' : ''}.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Allowance title="Today" limit={p.dailyLimit} left={p.leftToday} used={data.usage.platform.today} />
                <Allowance title="This month" limit={p.monthlyLimit} left={p.leftThisMonth} used={data.usage.platform.month} />
              </div>
            </>
          )}
          {(data.usage.own.month > 0 || data.own.keyHint) && <p className="text-sm text-gray-500">On your own account this month: {data.usage.own.month} draft{data.usage.own.month === 1 ? '' : 's'}.</p>}
        </div>

        <p className="text-xs text-gray-500">What is sent to the AI provider when a teacher drafts a paper: the class name, subject name, kind of test, board, topic and the teacher&apos;s instructions. Nothing about pupils, staff or the school is sent.</p>
      </div>
    </DashboardLayout>
  );
}

function Allowance({ title, limit, left, used }: { title: string; limit: number | null; left: number | null; used: number }) {
  return (
    <div className="rounded-xl border border-gray-100 p-3 text-sm">
      <p className="text-xs text-gray-500">{title}</p>
      {limit == null ? <p className="font-medium text-gray-900">{used} used · no limit</p> : (
        <>
          <p className="font-medium text-gray-900">{left} of {limit} drafts left</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={Math.min(used, limit)} aria-label={`${title}: drafts used`}>
            <div className={`h-full ${left === 0 ? 'bg-red-500' : 'bg-primary-500'}`} style={{ width: `${limit ? Math.min(100, (used / limit) * 100) : 100}%` }} />
          </div>
        </>
      )}
    </div>
  );
}
