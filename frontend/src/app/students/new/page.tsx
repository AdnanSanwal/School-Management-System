'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Trash2, Search, Users } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Field, SectionSelect, PasswordNotice, Modal, useSections } from '@/components/ui/kit';
import { studentsAPI, feesAPI, apiError } from '@/lib/api';
import { CAN, can } from '@/lib/roles';
import { formatMoney } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';

type GuardianDraft =
  | { kind: 'existing'; guardianId: string; name: string; phone: string; children: string[]; relation: string; isPrimary: boolean }
  | { kind: 'new'; name: string; phone: string; email: string; cnic: string; occupation: string; relation: string; isPrimary: boolean; loginEmail: string };

const blankGuardian = (primary: boolean): GuardianDraft => ({
  kind: 'new', name: '', phone: '', email: '', cnic: '', occupation: '', relation: 'FATHER', isPrimary: primary, loginEmail: '',
});

export default function AdmissionPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [s, setS] = useState({ name: '', gender: '', dateOfBirth: '', sectionId: '', rollNo: '', admissionNo: '', bloodGroup: '', address: '' });
  const [guardians, setGuardians] = useState<GuardianDraft[]>([blankGuardian(true)]);
  const [lookup, setLookup] = useState('');
  const [matches, setMatches] = useState<any[] | null>(null);
  const [done, setDone] = useState<any>(null);

  // CR-04: the student's own Monthly Fee, prefilled from their class's monthly fee.
  const me = useAuthStore((st) => st.user);
  const setsFee = can(me?.role, 'setStudentFee');
  const canGiveLogins = can(me?.role, 'manageUsers');
  const currency = me?.school?.currency ?? 'PKR';
  const { data: sections = [] } = useSections();
  const structure = useQuery({ queryKey: ['fee-structure'], queryFn: feesAPI.structure, enabled: setsFee });
  const [fee, setFee] = useState('');
  const [feeTouched, setFeeTouched] = useState(false);
  const classId = sections.find((x) => x.id === s.sectionId)?.classId;
  const classMonthly = (structure.data as any)?.classes?.find((c: any) => c.id === classId)?.monthlyTotal;
  useEffect(() => {
    if (!feeTouched && classMonthly !== undefined) setFee(String(Number(classMonthly)));
  }, [classMonthly, feeTouched]);

  const set = (k: keyof typeof s) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setS({ ...s, [k]: e.target.value });
  const setG = (i: number, patch: Partial<GuardianDraft>) => setGuardians(guardians.map((g, j) => (j === i ? { ...g, ...patch } as GuardianDraft : g)));

  const findSibling = async () => {
    if (lookup.trim().length < 4) return toast.error('Enter at least 4 digits of the phone or CNIC');
    try { setMatches(await studentsAPI.searchGuardians(lookup.trim())); } catch (e) { toast.error(apiError(e)); }
  };

  const linkExisting = (g: any) => {
    if (guardians.some(x => x.kind === 'existing' && x.guardianId === g.id)) return toast.error('This guardian is already linked');
    const existing: GuardianDraft = {
      kind: 'existing', guardianId: g.id, name: g.name, phone: g.phone, children: g.children.map((c: any) => c.name),
      relation: 'FATHER', isPrimary: !guardians.some((x) => x.isPrimary && (x.kind === 'existing' || x.name)),
    };
    // Replace the empty first guardian, otherwise add.
    const firstEmpty = guardians.findIndex((x) => x.kind === 'new' && !x.name && !x.phone);
    setGuardians(firstEmpty >= 0 ? guardians.map((x, i) => (i === firstEmpty ? { ...existing, isPrimary: x.isPrimary } : x)) : [...guardians, existing]);
    setMatches(null);
    setLookup('');
  };

  // Admission number is compulsory (CR-02). The form starts with the next number; the office may change it.
  const nextNo = useQuery({ queryKey: ['students', 'next-admission-no'], queryFn: studentsAPI.nextAdmissionNo, staleTime: 0 });
  const [admTouched, setAdmTouched] = useState(false);
  const [admServerError, setAdmServerError] = useState('');
  const admissionNo = admTouched ? s.admissionNo : (s.admissionNo || nextNo.data?.admissionNo || '');
  const admError = admServerError || (admTouched && !admissionNo.trim() ? 'Admission number is required' : '');

  const admit = useMutation({
    mutationFn: () => studentsAPI.admit({
      ...Object.fromEntries(Object.entries(s).filter(([, v]) => v !== '')),
      admissionNo: admissionNo.trim(),
      ...(setsFee && fee !== '' ? { monthlyFee: Number(fee) } : {}),
      guardians: guardians.map((g) => g.kind === 'existing'
        ? { guardianId: g.guardianId, relation: g.relation, isPrimary: g.isPrimary }
        : Object.fromEntries(Object.entries({ ...g, kind: undefined }).filter(([, v]) => v !== '' && v !== undefined))),
    }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['students'] });
      qc.invalidateQueries({ queryKey: ['classes'] });
      toast.success(`${res.student.name} admitted — ${res.student.admissionNo}`);
      if (res.parentLogins.length) setDone(res);
      else router.push(`/students/${res.student.id}`);
    },
    onError: (e) => {
      const msg = apiError(e, 'Admission failed');
      if (/admission number/i.test(msg)) { setAdmTouched(true); setAdmServerError(msg); }
      toast.error(msg);
    },
  });
  const submit = () => {
    if (!admissionNo.trim()) {
      setAdmTouched(true);
      toast.error('Enter the admission number');
      document.getElementById('admission-no')?.focus();
      return;
    }
    admit.mutate();
  };

  return (
    <DashboardLayout title="New admission" allowedRoles={CAN.admitStudents} subtitle="Student details, class and guardians">
      <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="card">
          <h3 className="section-title mb-4">Student</h3>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Full name *" className="md:col-span-2"><input className="input" required minLength={2} value={s.name} onChange={set('name')} /></Field>
            <Field label="Class / section *"><SectionSelect value={s.sectionId} onChange={(v) => setS({ ...s, sectionId: v })} /></Field>
            <Field label="Gender">
              <select className="select" value={s.gender} onChange={set('gender')}>
                <option value="">—</option><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option>
              </select>
            </Field>
            <Field label="Date of birth"><input type="date" className="input" value={s.dateOfBirth} onChange={set('dateOfBirth')} /></Field>
            <Field label="Roll no."><input className="input" value={s.rollNo} onChange={set('rollNo')} /></Field>
            <div>
              <label htmlFor="admission-no" className="mb-1.5 block text-sm font-medium text-gray-700">Admission no. <span className="text-red-500">*</span></label>
              <input id="admission-no" className={`input font-mono ${admError ? 'border-red-400 ring-1 ring-red-200' : ''}`} required maxLength={30}
                value={admissionNo} aria-invalid={!!admError} aria-describedby="admission-no-msg"
                onChange={(e) => { setAdmTouched(true); setAdmServerError(''); setS({ ...s, admissionNo: e.target.value }); }}
                onBlur={() => setAdmTouched(true)} />
              <p id="admission-no-msg" className={`mt-1 text-xs ${admError ? 'text-red-600' : 'text-gray-500'}`}>
                {admError || (nextNo.data && admissionNo === nextNo.data.admissionNo ? 'Next number suggested — you can change it' : 'Required, must be unique')}
              </p>
            </div>
            <Field label="Blood group"><input className="input" value={s.bloodGroup} onChange={set('bloodGroup')} maxLength={8} /></Field>
            {setsFee && (
              <Field label="Monthly Fee *" hint={classMonthly !== undefined
                ? `Class fee is ${formatMoney(classMonthly, currency)}/month. Change it for this student only.`
                : 'Choose the class first to prefill its monthly fee'}>
                <input type="number" min="0" step="1" required className="input" value={fee}
                  onChange={(e) => { setFee(e.target.value); setFeeTouched(true); }} placeholder="e.g. 4500" />
              </Field>
            )}
            <Field label="Address" className="md:col-span-3"><textarea className="input" rows={2} value={s.address} onChange={set('address')} /></Field>
          </div>
        </div>

        <div className="card space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="section-title">Guardians</h3>
              <p className="text-xs text-gray-500">Already have a child here? Look up the parent to link siblings.</p>
            </div>
            <div className="flex gap-2">
              <input className="input w-56" placeholder="Parent phone or CNIC" value={lookup} onChange={(e) => setLookup(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); findSibling(); } }} aria-label="Find existing parent" />
              <button type="button" className="btn btn-secondary" onClick={findSibling}><Search className="h-4 w-4" /> Find</button>
            </div>
          </div>

          {guardians.map((g, i) => (
            <div key={i} className="rounded-xl border border-slate-200 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-3 text-sm">
                  <select className="select w-36" value={g.relation} onChange={(e) => setG(i, { relation: e.target.value })} aria-label="Relation">
                    <option value="FATHER">Father</option><option value="MOTHER">Mother</option><option value="GUARDIAN">Guardian</option><option value="OTHER">Other</option>
                  </select>
                  <label className="flex items-center gap-1.5 text-gray-600">
                    <input type="radio" name="primary" checked={g.isPrimary} onChange={() => setGuardians(guardians.map((x, j) => ({ ...x, isPrimary: j === i })))} />
                    Primary contact
                  </label>
                </div>
                {guardians.length > 1 && (
                  <button type="button" className="btn-icon btn-ghost text-red-500" onClick={() => setGuardians(guardians.filter((_, j) => j !== i))} aria-label="Remove guardian">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              {g.kind === 'existing' ? (
                <div className="flex items-center gap-2 text-sm">
                  <Users className="h-4 w-4 text-primary-500" />
                  <span className="font-medium">{g.name}</span> · {g.phone}
                  <span className="badge badge-indigo">Sibling of {g.children.join(', ')}</span>
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-3">
                  <Field label="Name *"><input className="input" required minLength={2} value={g.name} onChange={(e) => setG(i, { name: e.target.value })} /></Field>
                  <Field label="Phone *"><input className="input" required minLength={7} value={g.phone} onChange={(e) => setG(i, { phone: e.target.value })} /></Field>
                  <Field label="CNIC"><input className="input" value={g.cnic} onChange={(e) => setG(i, { cnic: e.target.value })} /></Field>
                  <Field label="Email"><input type="email" className="input" value={g.email} onChange={(e) => setG(i, { email: e.target.value })} /></Field>
                  <Field label="Occupation"><input className="input" value={g.occupation} onChange={(e) => setG(i, { occupation: e.target.value })} /></Field>
                  {canGiveLogins && (
                    <Field label="Parent app login" hint="Email to sign in with; leave blank for no app access">
                      <input type="email" className="input" value={g.loginEmail} onChange={(e) => setG(i, { loginEmail: e.target.value })} />
                    </Field>
                  )}
                </div>
              )}
            </div>
          ))}
          {guardians.length < 4 && (
            <button type="button" className="btn btn-ghost" onClick={() => setGuardians([...guardians, blankGuardian(false)])}>
              <Plus className="h-4 w-4" /> Add another guardian
            </button>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => router.back()}>Cancel</button>
          <button className="btn btn-primary" disabled={admit.isPending || !s.sectionId}>{admit.isPending ? 'Saving…' : 'Admit student'}</button>
        </div>
      </form>

      <Modal open={!!matches} onClose={() => setMatches(null)} title="Existing parents">
        {matches?.length === 0 && <p className="text-sm text-gray-500">No parent found with that phone or CNIC.</p>}
        <ul className="space-y-2">
          {matches?.map((g) => (
            <li key={g.id} className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
              <div className="text-sm">
                <p className="font-medium">{g.name} · {g.phone}</p>
                <p className="text-gray-500">Children: {g.children.map((c: any) => `${c.name} (${c.admissionNo})`).join(', ') || '—'}</p>
              </div>
              <button className="btn btn-primary" onClick={() => linkExisting(g)}>Link</button>
            </li>
          ))}
        </ul>
      </Modal>

      <Modal open={!!done} onClose={() => router.push(`/students/${done.student.id}`)} title="Student admitted">
        <div className="space-y-3">
          {done?.parentLogins.map((l: any) => <PasswordNotice key={l.user.id} email={l.user.email} password={l.temporaryPassword} />)}
          <button className="btn btn-primary w-full" onClick={() => router.push(`/students/${done.student.id}`)}>Open student profile</button>
        </div>
      </Modal>
    </DashboardLayout>
  );
}
