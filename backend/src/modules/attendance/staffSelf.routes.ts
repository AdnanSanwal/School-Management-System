import { Router } from 'express';
import { z } from 'zod';
import { AttendanceStatus } from '@prisma/client';
import prisma, { transaction } from '../../config/database';
import { currentSchoolId } from '../../config/tenancy';
import { authenticate } from '../../middleware/auth';
import { can } from '../../middleware/rbac';
import { AppError } from '../../middleware/errorHandler';
import { handler, parseBody, parseQuery, me, dateOnly, period } from '../../utils/http';
import { sendSuccess } from '../../utils/apiResponse';
import { staffForUser } from '../../utils/scope';
import { isOnRoll } from '../../utils/staffStatus';
import { dayInTimezone, toDate, toIso, schoolTimezone, periodRange } from '../../utils/dates';
import { policyBody, clock, getPolicy, punchBody, verifyLocation, localInstant, lockStaff, assertAttendanceOpen, snapshot, attendanceEvent, assertWorkingDay } from './staffSelf.service';

const router = Router();
router.use(authenticate);
async function ownStaff(userId:string) {
  const staff = await staffForUser(userId);
  if (!staff || !isOnRoll(staff.status)) throw new AppError('An active staff record linked to your login is required in this branch',404);
  return staff;
}
router.get('/policy', can('attendance.staff.self','attendance.staff.configure'), handler(async(req,res)=>sendSuccess(res,{policy:await getPolicy(),timezone:await schoolTimezone()})));
router.put('/policy', can('attendance.staff.configure'), handler(async(req,res)=>{
  const body = parseBody(policyBody,req);
  const before = await getPolicy();
  const policy = await transaction(async tx=>{
    const row = await tx.staffAttendancePolicy.upsert({where:{schoolId:currentSchoolId()},create:{schoolId:currentSchoolId(),...body},update:body});
    // Coordinates are branch configuration, not a staff member's location.
    await tx.auditLog.create({data:{schoolId:currentSchoolId(),userId:me(req).id,entity:'staff_attendance_policy',entityId:currentSchoolId(),action:'Staff attendance rules changed',meta:JSON.parse(JSON.stringify({before,after:body}))}});
    return row;
  });
  return sendSuccess(res,policy,'Branch attendance rules saved');
}));
router.get('/mine', can('attendance.staff.self'), handler(async(req,res)=>{
  const staff = await ownStaff(me(req).id);
  const timezone = await schoolTimezone(), today = dayInTimezone(timezone);
  const q = parseQuery(z.object({period:period.optional()}),req);
  const range = periodRange(q.period??today.slice(0,7));
  const [policy, records, corrections, history] = await Promise.all([
    getPolicy(), prisma.staffAttendance.findMany({where:{staffId:staff.id,date:{gte:range.start,lte:range.end}},orderBy:{date:'desc'}}),
    prisma.staffAttendanceCorrection.findMany({where:{staffId:staff.id,date:{gte:range.start,lte:range.end}},orderBy:{createdAt:'desc'},take:100}),
    prisma.auditLog.findMany({where:{entity:'staff_attendance',entityId:staff.id},orderBy:{createdAt:'desc'},take:40,select:{id:true,action:true,createdAt:true,meta:true}}),
  ]);
  return sendSuccess(res,{staff:{id:staff.id,name:staff.name,employeeNo:staff.employeeNo},today,timezone,policy,records,corrections,history});
}));
for (const action of ['check-in','check-out'] as const) router.post('/'+action, can('attendance.staff.self'), handler(async(req,res)=>{
  const body = parseBody(punchBody,req);
  const staff = await ownStaff(me(req).id);
  const timezone=await schoolTimezone(), now=new Date(), today=dayInTimezone(timezone,now), date=toDate(today);
  const policy=await getPolicy();
  if (!policy.enabled) throw new AppError('Self-service attendance is not enabled for this branch',409);
  await assertWorkingDay(today,policy);
  const location = verifyLocation(policy,body.location,now);
  const start=localInstant(today,policy.startTime,timezone),end=localInstant(today,policy.endTime,timezone);
  const row = await transaction(async tx=>{
    // A finalized payroll is a snapshot, not a reason to stop recording today's real punches.
    // Historical corrections and manual overwrites still require an open payroll/accounting period.
    await lockStaff(tx,staff.id);
    if (await tx.leaveRequest.findFirst({where:{staffId:staff.id,status:'APPROVED',fromDate:{lte:date},toDate:{gte:date}}})) throw new AppError('You have approved leave today. Ask for a correction if you attended.',409);
    const old=await tx.staffAttendance.findUnique({where:{staffId_date:{staffId:staff.id,date}}});
    const before=snapshot(old);
    let saved;
    if (action==='check-in') {
      if (old) throw new AppError('Attendance is already recorded for today. Request a correction if needed.',409);
      if (now.getTime()<start.getTime()-policy.earlyMinutes*60000 || now>=end) throw new AppError('Check-in is outside the branch schedule',409);
      saved=await tx.staffAttendance.create({data:{schoolId:currentSchoolId(),staffId:staff.id,date,status:now.getTime()>start.getTime()+policy.graceMinutes*60000?'LATE':'PRESENT',checkIn:now,markedById:me(req).id}});
    } else {
      if (!old?.checkIn) throw new AppError('Check in before checking out',409);
      if (old.checkOut) throw new AppError('You have already checked out today',409);
      if (old.status==='ABSENT' || old.status==='LEAVE') throw new AppError('The office has marked this day absent or on leave. Request a correction.',409);
      if (now<=old.checkIn) throw new AppError('Check-out must be after check-in',409);
      const short=now.getTime()-old.checkIn.getTime()<policy.minimumMinutes*60000;
      const result=await tx.staffAttendance.updateMany({where:{id:old.id,updatedAt:old.updatedAt,checkOut:null},data:{checkOut:now,status:short?'HALF_DAY':old.status,markedById:me(req).id}});
      if(result.count!==1) throw new AppError('Attendance changed. Refresh and try again.',409);
      saved=await tx.staffAttendance.findUniqueOrThrow({where:{id:old.id}});
    }
    await attendanceEvent(tx,me(req).id,staff.id,today,action==='check-in'?'Staff checked in':'Staff checked out',{before,after:snapshot(saved),...location});
    return saved;
  });
  return sendSuccess(res,row,action==='check-in'?'Checked in':'Checked out');
}));
const correctionBody=z.object({date:dateOnly.refine(value=>{ const date=new Date(value+'T00:00:00Z'); return !Number.isNaN(+date)&&date.toISOString().slice(0,10)===value; },'Invalid attendance date'),status:z.nativeEnum(AttendanceStatus),checkInTime:clock.nullable(),checkOutTime:clock.nullable(),reason:z.string().trim().min(10).max(500)}).strict().superRefine((v,ctx)=>{
  if (['ABSENT','LEAVE'].includes(v.status) && (v.checkInTime||v.checkOutTime)) ctx.addIssue({code:'custom',message:'Absent/leave records cannot contain check-in times',path:['checkInTime']});
  if (!['ABSENT','LEAVE'].includes(v.status) && !v.checkInTime) ctx.addIssue({code:'custom',message:'Check-in time is required',path:['checkInTime']});
  if (v.checkOutTime && (!v.checkInTime || v.checkOutTime<=v.checkInTime)) ctx.addIssue({code:'custom',message:'Check-out must be after check-in',path:['checkOutTime']});
});
router.post('/corrections',can('attendance.staff.self'),handler(async(req,res)=>{
  const body=parseBody(correctionBody,req),staff=await ownStaff(me(req).id),timezone=await schoolTimezone(),today=dayInTimezone(timezone),policy=await getPolicy();
  const age=(toDate(today).getTime()-toDate(body.date).getTime())/86400000;
  if(age<0 || age>policy.correctionDays) throw new AppError(`Choose today or a date within the last ${policy.correctionDays} days`,422);
  const checkIn=body.checkInTime?localInstant(body.date,body.checkInTime,timezone):null,checkOut=body.checkOutTime?localInstant(body.date,body.checkOutTime,timezone):null;
  if((checkIn && checkIn>new Date()) || (checkOut && checkOut>new Date())) throw new AppError('Correction times cannot be in the future',422);
  const row=await transaction(async tx=>{
    await lockStaff(tx,staff.id); await assertAttendanceOpen(tx,toDate(body.date));
    const pendingKey=`${currentSchoolId()}/${staff.id}/${body.date}`;
    if(await tx.staffAttendanceCorrection.findUnique({where:{pendingKey}})) throw new AppError('A correction request is already pending for this day',409);
    const old=await tx.staffAttendance.findUnique({where:{staffId_date:{staffId:staff.id,date:toDate(body.date)}}});
    const created=await tx.staffAttendanceCorrection.create({data:{schoolId:currentSchoolId(),staffId:staff.id,date:toDate(body.date),requestedById:me(req).id,requestedStatus:body.status,requestedCheckIn:checkIn,requestedCheckOut:checkOut,reason:body.reason,baseline:snapshot(old),pendingKey}});
    await attendanceEvent(tx,me(req).id,staff.id,body.date,'Attendance correction requested',{requestId:created.id,reason:body.reason});return created;
  });return sendSuccess(res,row,'Correction sent for review',201);
}));
router.get('/corrections',can('attendance.staff.review'),handler(async(req,res)=>{
  const q=parseQuery(z.object({status:z.enum(['PENDING','APPROVED','REJECTED']).default('PENDING')}),req);
  const rows=await prisma.staffAttendanceCorrection.findMany({where:{status:q.status},include:{staff:{select:{name:true,employeeNo:true}}},orderBy:{createdAt:'desc'},take:200});
  return sendSuccess(res,{rows,timezone:await schoolTimezone()});
}));
router.post('/corrections/:id/decision',can('attendance.staff.review'),handler(async(req,res)=>{
  const body=parseBody(z.object({approve:z.boolean(),note:z.string().trim().min(3).max(500)}).strict(),req);
  const row=await transaction(async tx=>{
    const request=await tx.staffAttendanceCorrection.findFirst({where:{id:String(req.params.id)}});
    if(!request) throw new AppError('Correction request not found',404);
    if(request.requestedById===me(req).id || (await staffForUser(me(req).id))?.id===request.staffId) throw new AppError('You cannot review your own attendance correction',403);
    await lockStaff(tx,request.staffId);
    if(request.status!=='PENDING') throw new AppError('This request has already been decided',409);
    if(body.approve) {
      await assertAttendanceOpen(tx,request.date);
      const old=await tx.staffAttendance.findUnique({where:{staffId_date:{staffId:request.staffId,date:request.date}}});
      if(JSON.stringify(snapshot(old))!==JSON.stringify(request.baseline)) {
        // JSON object key order is not guaranteed by MySQL; compare fields instead.
        const actual=snapshot(old) as Record<string,unknown>,base=request.baseline as Record<string,unknown>;
        if(Object.keys({...actual,...base}).some(k=>actual[k]!==base[k])) throw new AppError('Attendance changed since the request. Reject it and ask for a new request.',409);
      }
      const values={status:request.requestedStatus,checkIn:request.requestedCheckIn,checkOut:request.requestedCheckOut,remarks:request.reason,markedById:me(req).id};
      if(old) {
        const changed=await tx.staffAttendance.updateMany({where:{id:old.id,updatedAt:old.updatedAt},data:values});
        if(changed.count!==1) throw new AppError('Attendance changed. Refresh and try again.',409);
      } else await tx.staffAttendance.create({data:{schoolId:currentSchoolId(),staffId:request.staffId,date:request.date,...values}});
    }
    const changed=await tx.staffAttendanceCorrection.updateMany({where:{id:request.id,status:'PENDING'},data:{status:body.approve?'APPROVED':'REJECTED',pendingKey:null,decidedById:me(req).id,decidedAt:new Date(),decisionNote:body.note}});
    if(changed.count!==1) throw new AppError('This request has already been decided',409);
    await attendanceEvent(tx,me(req).id,request.staffId,toIso(request.date),body.approve?'Attendance correction approved':'Attendance correction rejected',{requestId:request.id,note:body.note,before:request.baseline,after:body.approve?{status:request.requestedStatus,checkIn:request.requestedCheckIn,checkOut:request.requestedCheckOut}:undefined});
    return tx.staffAttendanceCorrection.findUniqueOrThrow({where:{id:request.id}});
  });return sendSuccess(res,row,'Correction decision saved');
}));
export default router;
