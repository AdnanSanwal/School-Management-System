'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { LogIn, LogOut, MapPin, Clock3, History, Send } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Field, Modal, Spinner, Stat, Empty, StatusBadge } from '@/components/ui/kit';
import { staffSelfAPI, apiError } from '@/lib/api';
import { CAN } from '@/lib/roles';
import { formatDate } from '@/lib/utils';

export default function MyAttendance() {
  const [month,setMonth]=useState('');
  const [correct,setCorrect]=useState(false);
  const qc=useQueryClient();
  const q=useQuery({queryKey:['staff-self',month],queryFn:()=>staffSelfAPI.mine(month||undefined),refetchInterval:60000});
  const d=q.data;
  const refresh=()=>{qc.invalidateQueries({queryKey:['staff-self']});qc.invalidateQueries({queryKey:['staff-att']});qc.invalidateQueries({queryKey:['dashboard']});};
  const time=(value:string|null)=>value?new Intl.DateTimeFormat('en',{timeZone:d.timezone,hour:'2-digit',minute:'2-digit'}).format(new Date(value)):'—';
  const punch=useMutation({mutationFn:async(action:'check-in'|'check-out')=>{
    let location;
    if(d.policy.gpsRequired) {
      if(!window.isSecureContext) throw new Error('GPS requires HTTPS. Open the ERP using its secure HTTPS address.');
      if(!navigator.geolocation) throw new Error('This browser does not support location access.');
      const position=await new Promise<GeolocationPosition>((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,()=>reject(new Error('Location could not be verified. Allow location access and try again.')),{enableHighAccuracy:true,maximumAge:0,timeout:15000}));
      location={latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy,capturedAt:new Date(position.timestamp).toISOString()};
    }
    return staffSelfAPI.punch(action,location?{location}:{});
  },onSuccess:r=>{toast.success(r.data.message);refresh();},onError:e=>toast.error(e instanceof Error && !('isAxiosError' in e)?e.message:apiError(e))});
  const today=d?.records.find((r:any)=>r.date.slice(0,10)===d.today);
  // The selected history month must never hide today's punch state.
  const todayQuery=useQuery({queryKey:['staff-self','today'],queryFn:()=>staffSelfAPI.mine(),enabled:!!month&&!!d&&month!==d.today.slice(0,7)});
  const current=month&&d&&month!==d.today.slice(0,7)?todayQuery.data?.records.find((r:any)=>r.date.slice(0,10)===d.today):today;
  return <DashboardLayout title="My attendance" allowedRoles={CAN.myAttendance} subtitle="Check in, check out and review your own attendance">
    {q.isLoading?<Spinner/>:q.error?<div role="alert" className="card text-red-700">{apiError(q.error)}</div>:d&&<>
      <section className="card space-y-4"><div className="flex flex-wrap justify-between gap-2"><div><h2 className="text-lg font-semibold">{d.staff.name}</h2><p className="text-sm text-slate-500">{formatDate(d.today)} · {d.timezone}</p></div>{current&&<StatusBadge status={current.status}/>}</div>
        <div className="grid gap-3 sm:grid-cols-2"><Stat icon={LogIn} label="Check-in" value={time(current?.checkIn)} tone="good"/><Stat icon={LogOut} label="Check-out" value={time(current?.checkOut)}/></div>
        <div className="flex flex-wrap gap-2"><button className="btn-primary" disabled={punch.isPending||!d.policy.enabled||!!current||todayQuery.isFetching} onClick={()=>punch.mutate('check-in')}><LogIn className="h-4 w-4"/>{punch.isPending&&punch.variables==='check-in'?'Checking in…':'Check in'}</button><button className="btn-secondary" disabled={punch.isPending||!d.policy.enabled||!current?.checkIn||!!current?.checkOut||todayQuery.isFetching} onClick={()=>punch.mutate('check-out')}><LogOut className="h-4 w-4"/>{punch.isPending&&punch.variables==='check-out'?'Checking out…':'Check out'}</button><button className="btn-secondary" onClick={()=>setCorrect(true)}><Send className="h-4 w-4"/>Request correction</button></div>
        {!d.policy.enabled&&<p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Self-service is disabled for this branch. An authorized manager can enable it in Attendance rules.</p>}
        <p className="flex items-start gap-2 text-xs text-slate-500"><Clock3 className="h-4 w-4 shrink-0"/>Schedule {d.policy.startTime}–{d.policy.endTime} · {d.policy.graceMinutes} minute grace · Full day requires {d.policy.minimumMinutes} minutes. Shorter attendance is recorded as half day.</p>
        <p className="flex items-start gap-2 text-xs text-slate-500"><MapPin className="h-4 w-4 shrink-0"/>{d.policy.gpsRequired?`Location required within ${d.policy.radiusMeters}m of the branch. Use HTTPS and allow location access.`:'GPS is not required by this branch.'} Times are recorded by the server.</p>
      </section>
      <section className="card space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Attendance history</h2><input aria-label="Attendance month" type="month" className="input !w-auto max-w-full" value={month||d.today.slice(0,7)} max={d.today.slice(0,7)} onChange={e=>setMonth(e.target.value)}/></div>{!d.records.length?<Empty title="No attendance records this month"/>:<div className="table-container"><table className="table"><thead><tr><th>Date</th><th>Status</th><th>In</th><th>Out</th><th>Remarks</th></tr></thead><tbody>{d.records.map((r:any)=><tr key={r.id}><td className="whitespace-nowrap">{formatDate(r.date)}</td><td><StatusBadge status={r.status}/></td><td>{time(r.checkIn)}</td><td>{time(r.checkOut)}</td><td>{r.remarks||'—'}</td></tr>)}</tbody></table></div>}</section>
      <section className="card"><h2 className="mb-3 font-semibold">My correction requests</h2>{!d.corrections.length?<Empty title="No correction requests for this month"/>:<ul className="divide-y divide-slate-100">{d.corrections.map((r:any)=><li key={r.id} className="space-y-1 py-3 text-sm"><div className="flex flex-wrap gap-2"><b>{formatDate(r.date)}</b><StatusBadge status={r.status}/></div><p>{r.reason}</p><p className="text-xs text-slate-500">Requested: {r.requestedStatus} · {time(r.requestedCheckIn)}–{time(r.requestedCheckOut)}</p>{r.decisionNote&&<p className="text-xs">Reviewer: {r.decisionNote}</p>}</li>)}</ul>}</section>
      <section className="card"><h2 className="mb-3 flex items-center gap-2 font-semibold"><History className="h-4 w-4"/>Recent attendance activity</h2>{!d.history.length?<p className="text-sm text-slate-500">No attendance activity recorded.</p>:<ul className="space-y-3">{d.history.map((r:any)=><li key={r.id} className="text-sm"><p>{r.action}</p><p className="text-xs text-slate-500">{r.meta.date} · {new Intl.DateTimeFormat('en',{timeZone:d.timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(r.createdAt))}</p></li>)}</ul>}</section>
      {correct&&<Correction today={d.today} close={()=>setCorrect(false)} saved={refresh}/>}
    </>}
  </DashboardLayout>;
}
function Correction({today,close,saved}:{today:string;close:()=>void;saved:()=>void}) {
  const [f,setF]=useState({date:today,status:'PRESENT',checkInTime:'08:00',checkOutTime:'',reason:''});
  const m=useMutation({mutationFn:()=>staffSelfAPI.request({...f,checkInTime:f.checkInTime||null,checkOutTime:f.checkOutTime||null}),onSuccess:()=>{toast.success('Correction sent for review');saved();close();},onError:e=>toast.error(apiError(e))});
  return <Modal open onClose={close} title="Request attendance correction"><form className="space-y-3" onSubmit={e=>{e.preventDefault();m.mutate();}}><p className="text-xs text-slate-500">Enter times in your branch timezone. A different authorized person must review this request.</p><Field label="Attendance date"><input className="input" type="date" max={today} required value={f.date} onChange={e=>setF({...f,date:e.target.value})}/></Field><Field label="Requested status"><select className="select" value={f.status} onChange={e=>setF({...f,status:e.target.value,...(['ABSENT','LEAVE'].includes(e.target.value)?{checkInTime:'',checkOutTime:''}:{})})}>{['PRESENT','LATE','HALF_DAY','ABSENT','LEAVE'].map(s=><option key={s}>{s}</option>)}</select></Field>{!['ABSENT','LEAVE'].includes(f.status)&&<div className="grid gap-3 sm:grid-cols-2"><Field label="Check-in time"><input required type="time" className="input" value={f.checkInTime} onChange={e=>setF({...f,checkInTime:e.target.value})}/></Field><Field label="Check-out time (optional)"><input type="time" className="input" value={f.checkOutTime} onChange={e=>setF({...f,checkOutTime:e.target.value})}/></Field></div>}<Field label="Reason"><textarea required minLength={10} maxLength={500} className="input" value={f.reason} onChange={e=>setF({...f,reason:e.target.value})}/></Field><button disabled={m.isPending} className="btn-primary">Send request</button></form></Modal>;
}
