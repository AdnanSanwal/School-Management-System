'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Lock } from 'lucide-react';
import { notificationsAPI, schoolAPI, apiError } from '@/lib/api';
import { useEffect, useState } from 'react';

interface TypeRow { type: string; label: string; canMute: boolean; urgent: boolean; muted: boolean }

/** "What should alert me": each person switches routine types on or off for themselves. */
export function NotificationPreferences() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['notification-preferences'], queryFn: notificationsAPI.preferences });
  const save = useMutation({
    mutationFn: (muted: string[]) => notificationsAPI.savePreferences(muted),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notification-preferences'] }),
    onError: (e) => toast.error(apiError(e)),
  });
  if (!data) return null;
  const types: TypeRow[] = data.types;
  const toggle = (type: string) => {
    const muted = new Set(types.filter((t) => t.muted).map((t) => t.type));
    if (muted.has(type)) muted.delete(type); else muted.add(type);
    save.mutate([...muted]);
  };
  return (
    <details className="card">
      <summary className="cursor-pointer text-sm font-medium text-gray-900">What should alert me</summary>
      <p className="mt-2 text-xs text-gray-500">
        Switch off the kinds you don’t want a push alert or pop-up for. They still appear in this list. Urgent alerts and messages from the school office always come through.
      </p>
      <ul className="mt-3 divide-y divide-gray-50">
        {types.map((t) => (
          <li key={t.type} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span className="text-gray-800">{t.label}{t.urgent && <span className="badge badge-red ml-2 text-2xs">urgent</span>}</span>
            {t.canMute ? (
              <label className="flex items-center gap-2 text-gray-600">
                <input type="checkbox" checked={!t.muted} disabled={save.isPending} onChange={() => toggle(t.type)} aria-label={`Alert me about: ${t.label}`} />
                {t.muted ? 'Off' : 'On'}
              </label>
            ) : (
              <span className="flex items-center gap-1 text-xs text-gray-400"><Lock className="h-3 w-3" /> Always on</span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** School setting: hold routine push alerts overnight. */
export function QuietHours() {
  const qc = useQueryClient();
  const { data: school } = useQuery({ queryKey: ['school'], queryFn: schoolAPI.get });
  const [on, setOn] = useState(false);
  const [start, setStart] = useState('21:00');
  const [end, setEnd] = useState('07:00');
  useEffect(() => {
    if (!school) return;
    setOn(!!school.quietHoursStart);
    if (school.quietHoursStart) { setStart(school.quietHoursStart); setEnd(school.quietHoursEnd); }
  }, [school]);
  const save = useMutation({
    mutationFn: () => schoolAPI.update(on ? { quietHoursStart: start, quietHoursEnd: end } : { quietHoursStart: null, quietHoursEnd: null }),
    onSuccess: () => { toast.success(on ? `Quiet hours set: ${start} to ${end}` : 'Quiet hours off'); qc.invalidateQueries({ queryKey: ['school'] }); },
    onError: (e) => toast.error(apiError(e)),
  });
  if (!school) return null;
  return (
    <div className="card space-y-3 lg:col-span-2">
      <h3 className="section-title">Quiet hours for app alerts</h3>
      <p className="text-sm text-gray-500">
        Routine alerts raised during these hours (a late diary post, a notice) reach phones when the hours end. They are in the app straight away.
        Urgent alerts (absence, fee due, low attendance) and messages the office sends by hand are never held back. Times are on the school’s clock ({school.timezone}).
      </p>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /> Hold routine alerts</label>
        <label className="flex items-center gap-2">from <input type="time" className="input w-auto" disabled={!on} value={start} onChange={(e) => setStart(e.target.value)} aria-label="Quiet hours start" /></label>
        <label className="flex items-center gap-2">until <input type="time" className="input w-auto" disabled={!on} value={end} onChange={(e) => setEnd(e.target.value)} aria-label="Quiet hours end" /></label>
        <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>Save quiet hours</button>
      </div>
    </div>
  );
}
