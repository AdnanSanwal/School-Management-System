import 'dotenv/config';
import request from 'supertest';
import app from '../../app';
import { basePrisma } from '../../config/database';
import { connectRedis } from '../../config/redis';
import { createTestSchool } from './helpers';
import { DEFAULT_POLICY } from '../../modules/attendance/staffSelf.service';
import { addDays, dayInTimezone, toDate, toIso } from '../../utils/dates';

const d=process.env.RUN_DB_TESTS?describe:describe.skip;
jest.setTimeout(120000);
d('staff self-service attendance (database)',()=>{
  let t:Awaited<ReturnType<typeof createTestSchool>>, other:Awaited<ReturnType<typeof createTestSchool>>;
  const users:Record<string,any>={},staff:Record<string,string>={};
  const today=dayInTimezone('Asia/Karachi'),yesterday=toIso(addDays(toDate(today),-1));
  const as=(who:string)=>{
    const h={Authorization:`Bearer ${users[who].token}`};
    return {get:(p:string)=>request(app).get('/api/v1/staff-attendance'+p).set(h),post:(p:string,b:object={})=>request(app).post('/api/v1/staff-attendance'+p).set(h).send(b),put:(p:string,b:object)=>request(app).put('/api/v1/staff-attendance'+p).set(h).send(b)};
  };
  const policy={...DEFAULT_POLICY,enabled:true,weekdays:[0,1,2,3,4,5,6],startTime:'00:00',endTime:'23:59',minimumMinutes:1};
  beforeAll(async()=>{
    await connectRedis();t=await createTestSchool('staff-self');other=await createTestSchool('staff-self-isolation');
    for(const role of ['OWNER','PRINCIPAL','ADMIN','ACCOUNTANT','TEACHER','PARENT','STUDENT'] as const) users[role]=await t.user(role);
    users.OUTSIDE=await other.user('OWNER');
    for(const role of ['OWNER','TEACHER','ACCOUNTANT']) staff[role]=(await basePrisma.staff.create({data:{schoolId:t.school.id,userId:users[role].id,employeeNo:role,name:`Attendance ${role}`}})).id;
  });
  afterAll(async()=>{await t.destroy();await other.destroy();});
  it('protects configuration, personal attendance and correction-review roles',async()=>{
    expect((await as('PARENT').get('/mine')).status).toBe(403);
    expect((await as('STUDENT').post('/check-in')).status).toBe(403);
    expect((await as('TEACHER').put('/policy',policy)).status).toBe(403);
    expect((await as('ADMIN').put('/policy',policy)).status).toBe(403);
    expect((await as('TEACHER').get('/corrections')).status).toBe(403);
    expect((await as('TEACHER').post('/check-in')).status).toBe(409);
    expect((await as('PRINCIPAL').put('/policy',policy)).status).toBe(200);
    expect((await as('ADMIN').get('/mine')).status).toBe(404); // needs an actual linked staff record
  });
  it('requires server-derived staff identity and an initial check-in',async()=>{
    expect((await as('TEACHER').post('/check-in',{staffId:staff.ACCOUNTANT})).status).toBe(422);
    expect((await as('TEACHER').post('/check-out')).status).toBe(409);
  });
  it('records exactly one concurrent check-in, then one check-out and audit evidence',async()=>{
    const results=await Promise.all([as('TEACHER').post('/check-in'),as('TEACHER').post('/check-in')]);
    expect(results.map(r=>r.status).sort()).toEqual([200,409]);
    const saved=await basePrisma.staffAttendance.findUniqueOrThrow({where:{staffId_date:{staffId:staff.TEACHER,date:toDate(today)}}});
    expect(saved.checkIn).not.toBeNull();expect(saved.checkOut).toBeNull();
    const outs=await Promise.all([as('TEACHER').post('/check-out'),as('TEACHER').post('/check-out')]);
    expect(outs.map(r=>r.status).sort()).toEqual([200,409]);
    const mine=await as('TEACHER').get('/mine');expect(mine.status).toBe(200);
    expect(mine.body.data.records.find((r:any)=>r.id===saved.id).status).toBe('HALF_DAY');
    expect(mine.body.data.history.filter((e:any)=>/Staff checked/.test(e.action))).toHaveLength(2);
    expect(mine.body.data.records.every((r:any)=>r.staffId===staff.TEACHER)).toBe(true);
  });
  it('feeds a self-service half day into the existing payroll calculation',async()=>{
    await basePrisma.salaryStructure.create({data:{schoolId:t.school.id,staffId:staff.TEACHER,effectiveFrom:toDate(today.slice(0,8)+'01'),basic:30000}});
    const prepared=await request(app).post('/api/v1/payroll/runs').set('Authorization',`Bearer ${users.OWNER.token}`).send({period:today.slice(0,7)});
    expect(prepared.status).toBe(201);
    const runId=prepared.body.data.id;
    const line=await basePrisma.payrollLine.findFirstOrThrow({where:{runId,staffId:staff.TEACHER}});
    expect(Number(line.deductDays)).toBe(0.5);
    expect(Number(line.absenceDeduction)).toBeGreaterThan(0);
    await basePrisma.payrollRun.delete({where:{id:runId}});
  });
  it('requires GPS proof and refuses outside locations',async()=>{
    expect((await as('OWNER').put('/policy',{...policy,gpsRequired:true,latitude:31.5,longitude:74.3})).status).toBe(200);
    expect((await as('ACCOUNTANT').post('/check-in')).status).toBe(422);
    const location={latitude:32,longitude:74.3,accuracy:10,capturedAt:new Date().toISOString()};
    expect((await as('ACCOUNTANT').post('/check-in',{location})).status).toBe(403);
    const success=await as('ACCOUNTANT').post('/check-in',{location:{...location,latitude:31.5}});expect(success.status).toBe(200);
    const logs=await basePrisma.auditLog.findMany({where:{schoolId:t.school.id,entityId:staff.ACCOUNTANT,action:'Staff checked in'}});
    expect(logs).toHaveLength(1);expect(logs[0].meta).toMatchObject({gps:'verified',distanceMeters:0});
    expect(JSON.stringify(logs[0].meta)).not.toMatch(/latitude|longitude/);
    await as('OWNER').put('/policy',policy);
  });
  it('blocks non-working days and approved leave',async()=>{
    const weekday=toDate(today).getUTCDay();
    await as('OWNER').put('/policy',{...policy,weekdays:[(weekday+1)%7]});
    expect((await as('OWNER').post('/check-in')).status).toBe(409);
    await as('OWNER').put('/policy',policy);
    const leave=await basePrisma.leaveRequest.create({data:{schoolId:t.school.id,staffId:staff.OWNER,type:'CASUAL',fromDate:toDate(today),toDate:toDate(today),reason:'Test leave',status:'APPROVED'}});
    expect((await as('OWNER').post('/check-in')).status).toBe(409);
    await basePrisma.leaveRequest.delete({where:{id:leave.id}});
  });
  it('reviews corrections without self approval, duplicate decisions or cross-branch access',async()=>{
    const body={date:yesterday,status:'PRESENT',checkInTime:'08:00',checkOutTime:'15:00',reason:'Forgot to record attendance yesterday'};
    const created=await as('TEACHER').post('/corrections',body);expect(created.status).toBe(201);
    expect((await as('TEACHER').post('/corrections',body)).status).toBe(409);
    const id=created.body.data.id;
    expect((await as('OUTSIDE').post(`/corrections/${id}/decision`,{approve:true,note:'Verified'})).status).toBe(404);
    expect((await as('PRINCIPAL').post(`/corrections/${id}/decision`,{approve:true,note:'Confirmed attendance'})).status).toBe(200);
    expect((await as('PRINCIPAL').post(`/corrections/${id}/decision`,{approve:true,note:'Again'})).status).toBe(409);
    const record=await basePrisma.staffAttendance.findUniqueOrThrow({where:{staffId_date:{staffId:staff.TEACHER,date:toDate(yesterday)}}});
    expect(record.status).toBe('PRESENT');expect(record.checkIn?.toISOString()).toBe(yesterday+'T03:00:00.000Z');
    const own=await as('OWNER').post('/corrections',body);expect(own.status).toBe(201);
    expect((await as('OWNER').post(`/corrections/${own.body.data.id}/decision`,{approve:true,note:'My own request'})).status).toBe(403);
    expect((await as('PRINCIPAL').post(`/corrections/${own.body.data.id}/decision`,{approve:false,note:'Need more information'})).status).toBe(200);
  });
  it('detects a record changed after the correction request',async()=>{
    const body={date:yesterday,status:'PRESENT',checkInTime:'08:00',checkOutTime:'15:00',reason:'Accountant attendance correction'};
    const created=await as('ACCOUNTANT').post('/corrections',body);expect(created.status).toBe(201);
    await basePrisma.staffAttendance.create({data:{schoolId:t.school.id,staffId:staff.ACCOUNTANT,date:toDate(yesterday),status:'ABSENT'}});
    expect((await as('PRINCIPAL').post(`/corrections/${created.body.data.id}/decision`,{approve:true,note:'Confirmed'})).status).toBe(409);
  });
  it('protects approved payroll, closed months and staff history isolation',async()=>{
    const run=await basePrisma.payrollRun.create({data:{schoolId:t.school.id,period:today.slice(0,7),status:'APPROVED'}});
    expect((await as('OWNER').post('/check-in')).status).toBe(200);
    expect((await as('OWNER').post('/check-out')).status).toBe(200);
    expect((await as('OWNER').post('/corrections',{date:today,status:'ABSENT',checkInTime:null,checkOutTime:null,reason:'Late attendance correction'})).status).toBe(409);
    await basePrisma.payrollRun.delete({where:{id:run.id}});
    await basePrisma.school.update({where:{id:t.school.id},data:{booksClosedThrough:today.slice(0,7)}});
    expect((await as('OWNER').post('/corrections',{date:today,status:'ABSENT',checkInTime:null,checkOutTime:null,reason:'Closed month correction'})).status).toBe(409);
    const outside=await as('OUTSIDE').get('/policy');expect(outside.body.data.policy.enabled).toBe(false);
    expect((await as('OUTSIDE').get('/mine')).status).toBe(404);
  });
});
