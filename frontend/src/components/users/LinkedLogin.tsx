'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Modal, Field, StudentPicker, Spinner } from '@/components/ui/kit';
import { LoginFields, emptyLogin, loginBody, loginProblems, type LoginValue } from '@/components/ui/LoginFields';
import { studentsAPI, staffAPI, apiError, type UsernameCheck } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

export type Issued = { name: string; username: string };

/** The roles the signed-in user may create logins for (the owner sets this per role). */
export function useCreatableRoles(): string[] {
  const user = useAuthStore((s) => s.user);
  if (!user) return [];
  if (user.creatableRoles) return user.creatableRoles;
  // Older session without the list: the standard rule.
  const standard: Record<string, string[]> = {
    OWNER: ['OWNER', 'PRINCIPAL', 'ADMIN', 'ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT'],
    PRINCIPAL: ['ADMIN', 'ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT'],
    ADMIN: ['ACCOUNTANT', 'TEACHER', 'PARENT', 'STUDENT'],
  };
  return standard[user.role] ?? [];
}

/** Username, optional email and a starting password for a login tied to a student or a guardian. */
function LinkedLoginForm({ kind, target, onDone }: { kind: 'STUDENT' | 'PARENT'; target: { id: string; name: string }; onDone: (r: Issued) => void }) {
  const [login, setLogin] = useState<LoginValue>(emptyLogin(kind));
  const [check, setCheck] = useState<UsernameCheck | null>(null);
  const problems = loginProblems(login, check);
  const m = useMutation({
    mutationFn: () => {
      const { role: _role, ...body } = loginBody(login);
      return kind === 'STUDENT' ? studentsAPI.studentLogin(target.id, body) : studentsAPI.guardianLogin(target.id, body);
    },
    onSuccess: (r: any) => onDone({ name: target.name, username: r.user.username ?? r.user.email }),
    onError: (e) => toast.error(apiError(e), { duration: 6000 }),
  });
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (problems.length) return toast.error(problems[0]); m.mutate(); }}>
      <LoginFields value={login} onChange={setLogin} roles={[]} personName={target.name} onCheck={setCheck} />
      <p className="text-xs text-gray-500">{kind === 'STUDENT'
        ? 'The student signs in to the app and sees only their own attendance, diary, results and timetable.'
        : 'One login covers all of this guardian’s children at the school.'}</p>
      <button className="btn btn-primary w-full" disabled={m.isPending || problems.length > 0} title={problems[0]}>Create login</button>
    </form>
  );
}

/** From a student's profile: a login for that student, or for one of their guardians. */
export function LinkedLoginModal({ kind, target, onClose, onDone }: { kind: 'STUDENT' | 'PARENT'; target: { id: string; name: string }; onClose: () => void; onDone: (r: Issued) => void }) {
  return (
    <Modal open onClose={onClose} title={`${kind === 'STUDENT' ? 'Student' : 'Parent'} login for ${target.name}`} wide>
      <LinkedLoginForm kind={kind} target={target} onDone={(r) => { onDone(r); onClose(); }} />
    </Modal>
  );
}

/** From Users & logins: find the student first, then (for a parent) pick the guardian. */
export function StudentOrParentLogin({ kind, onDone }: { kind: 'STUDENT' | 'PARENT'; onDone: (r: Issued) => void }) {
  const [student, setStudent] = useState<any | null>(null);
  const [guardianId, setGuardianId] = useState('');
  const detail = useQuery({ queryKey: ['student', student?.id], queryFn: () => studentsAPI.get(student.id), enabled: !!student });
  const guardians: any[] = (detail.data?.guardians ?? []).map((g: any) => ({ ...g.guardian, relation: g.relation }));
  const free = guardians.filter((g) => !g.user);
  const guardian = free.find((g) => g.id === guardianId) ?? (free.length === 1 ? free[0] : null);

  return (
    <div className="space-y-3">
      <Field label={kind === 'STUDENT' ? 'Student' : 'Whose parent?'}><StudentPicker value={student} onChange={(s) => { setStudent(s); setGuardianId(''); }} /></Field>
      {student && detail.isLoading && <Spinner />}
      {student && detail.data && kind === 'STUDENT' && (detail.data.user
        ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{student.name} already has a login ({detail.data.user.username ?? detail.data.user.email}).</p>
        : <LinkedLoginForm key={student.id} kind="STUDENT" target={{ id: student.id, name: detail.data.name }} onDone={onDone} />)}
      {student && detail.data && kind === 'PARENT' && (
        free.length === 0
          ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{guardians.length ? 'Every guardian of this student already has a login.' : 'This student has no guardian on record. Add one on the student’s profile first.'}</p>
          : <>
            {free.length > 1 && (
              <Field label="Guardian"><select className="select" value={guardian?.id ?? ''} onChange={(e) => setGuardianId(e.target.value)}>
                <option value="">Choose…</option>{free.map((g) => <option key={g.id} value={g.id}>{g.name} ({String(g.relation).toLowerCase()})</option>)}</select></Field>
            )}
            {guardian && <>
              <p className="text-sm text-gray-600">Login for <b>{guardian.name}</b> ({String(guardian.relation).toLowerCase()}){guardian.phone ? ` · ${guardian.phone}` : ''}</p>
              <LinkedLoginForm key={guardian.id} kind="PARENT" target={{ id: guardian.id, name: guardian.name }} onDone={onDone} />
            </>}
          </>
      )}
    </div>
  );
}

/** From Users & logins: a login for a teacher who is already on the staff list. */
export function TeacherLogin({ onDone }: { onDone: (r: Issued) => void }) {
  const staff = useQuery({ queryKey: ['staff', 'active-all'], queryFn: () => staffAPI.list({ limit: 200 }) });
  const [staffId, setStaffId] = useState('');
  const [login, setLogin] = useState<LoginValue>(emptyLogin('TEACHER'));
  const [check, setCheck] = useState<UsernameCheck | null>(null);
  const free: any[] = (staff.data?.data ?? []).filter((s: any) => !s.user);
  const person = free.find((s) => s.id === staffId);
  const problems = loginProblems(login, check);
  const m = useMutation({
    mutationFn: () => staffAPI.createLogin(staffId, { ...loginBody(login), role: 'TEACHER' }),
    onSuccess: (r: any) => onDone({ name: person?.name ?? '', username: r.user.username ?? r.user.email }),
    onError: (e) => toast.error(apiError(e), { duration: 6000 }),
  });
  if (staff.isLoading) return <Spinner />;
  if (!free.length) return <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Everyone on the staff list already has a login. Add the teacher on the Staff page first.</p>;
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (problems.length) return toast.error(problems[0]); m.mutate(); }}>
      <Field label="Staff member" hint="Only staff without a login are listed"><select className="select" required value={staffId} onChange={(e) => setStaffId(e.target.value)}>
        <option value="">Choose…</option>{free.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.employeeNo}){s.designation ? ` · ${s.designation}` : ''}</option>)}</select></Field>
      {person && <LoginFields value={login} onChange={setLogin} roles={[]} personName={person.name} onCheck={setCheck} />}
      <button className="btn btn-primary w-full" disabled={!person || m.isPending || problems.length > 0} title={problems[0]}>Create login</button>
    </form>
  );
}
