import 'dotenv/config';
import request from 'supertest';
import app from '../../app';
import { basePrisma } from '../../config/database';
import { connectRedis } from '../../config/redis';
import { createTestSchool } from './helpers';
import { forgetRoleOverrides } from '../../utils/rolePermissions';
import { dayInTimezone, addDays, toDate, toIso } from '../../utils/dates';

const suite=process.env.RUN_DB_TESTS==='1'?describe:describe.skip;
jest.setTimeout(120000);
suite('School change requirements — retained workflow QA',()=>{
 let t:Awaited<ReturnType<typeof createTestSchool>>;const users:Record<string,any>={};const ids:Record<string,string>={};
 const today=dayInTimezone('Asia/Karachi');
 const call=(role:string,method:'get'|'post'|'put'|'patch',url:string,body?:object)=>{const r=request(app)[method]('/api/v1'+url).auth(users[role].token,{type:'bearer'});return method==='get'?r:r.send(body??{});};
 const balance=async()=>Number((await call('OWNER','get','/finance/accounts')).body.data.find((a:any)=>a.id===ids.cash).balance);
 beforeAll(async()=>{
  await connectRedis();t=await createTestSchool('retained-workflow-qa');
  ids.foreignSchool=(await basePrisma.school.create({data:{name:'Workflow QA isolation — retained',code:'wf-isolation-'+t.school.id}})).id;
  for(const role of ['OWNER','PRINCIPAL','ADMIN','ACCOUNTANT','TEACHER','PARENT','STUDENT'] as const)users[role]=await t.user(role);
  await basePrisma.school.update({where:{id:t.school.id},data:{name:`Workflow QA — retained ${t.code}`}});
  const cls=await call('ADMIN','post','/academics/classes',{name:'Workflow Class',level:1,sections:['A']});ids.section=cls.body.data.sections[0].id;
  const staff=await basePrisma.staff.create({data:{schoolId:t.school.id,userId:users.TEACHER.id,name:'Workflow Teacher',employeeNo:'WF-001',isTeacher:true}});ids.staff=staff.id;
  await basePrisma.section.update({where:{id:ids.section},data:{classTeacherId:staff.id}});
  const subject=await basePrisma.subject.create({data:{schoolId:t.school.id,name:'Workflow English',code:'WF-EN'}});ids.subject=subject.id;
  await basePrisma.subjectAssignment.create({data:{schoolId:t.school.id,academicYearId:t.year.id,sectionId:ids.section,subjectId:subject.id,teacherId:staff.id}});
  const admit=await call('ADMIN','post','/students',{admissionNo:'WF-ADM-001',name:'Workflow Child',sectionId:ids.section,guardians:[{name:'Workflow Parent',phone:'+92 300-1234567',cnic:'35202-1234567-1',relation:'FATHER',isPrimary:true}]});ids.student=admit.body.data.student.id;
  const guardian=await basePrisma.guardian.findFirstOrThrow({where:{schoolId:t.school.id}});ids.guardian=guardian.id;await basePrisma.guardian.update({where:{id:guardian.id},data:{userId:users.PARENT.id}});
  const accounts=await call('OWNER','get','/finance/accounts');ids.cash=accounts.body.data.find((a:any)=>a.type==='CASH').id;
  await call('ACCOUNTANT','post',`/finance/accounts/${ids.cash}/transactions`,{type:'DEPOSIT',amount:10000,txDate:today,description:'Retained workflow QA float'});
 });
 // Deliberately retained, per the user's request. No fixture cleanup.
 it('edits student profiles and finds formatted guardians without creating duplicate parents',async()=>{
  const edit=await call('ADMIN','patch',`/students/${ids.student}`,{name:'Workflow Child Updated',address:'QA address'});expect(edit.status).toBe(200);
  for(const q of ['03001234567','+923001234567','3520212345671']){
   const found=await call('ADMIN','get','/students/guardians/search?q='+encodeURIComponent(q));expect(found.status).toBe(200);expect(found.body.data.map((g:any)=>g.id)).toContain(ids.guardian);
  }
  const sibling=await call('ADMIN','post','/students',{admissionNo:'WF-ADM-002',name:'Workflow Sibling',sectionId:ids.section,guardians:[{guardianId:ids.guardian,relation:'FATHER',isPrimary:true}]});expect(sibling.status).toBe(201);
  expect(await basePrisma.guardian.count({where:{schoolId:t.school.id}})).toBe(1);
  expect((await call('PARENT','patch',`/students/${ids.student}`,{name:'Forbidden Edit'})).status).toBe(403);
 });
 it('keeps requested and approved advances out of balances until one disbursement',async()=>{
  const b={staffId:ids.staff,kind:'LOAN',amount:1000,issuedOn:today,accountId:ids.cash,installment:250,note:'Retained QA request'};
  expect((await call('ACCOUNTANT','post','/payroll/loans',b)).status).toBe(403);
  const r=await call('ACCOUNTANT','post','/payroll/loan-requests',b);expect(r.status).toBe(201);ids.request=r.body.data.id;
  expect(await balance()).toBe(10000);
  expect((await call('ACCOUNTANT','post',`/payroll/loan-requests/${ids.request}/disburse`)).status).toBe(409);
  expect((await call('ACCOUNTANT','post',`/payroll/loan-requests/${ids.request}/decision`,{approve:true})).status).toBe(403);
  expect((await call('OWNER','post',`/payroll/loan-requests/${ids.request}/decision`,{approve:true})).status).toBe(200);expect(await balance()).toBe(10000);
  const paid=await Promise.all([call('ACCOUNTANT','post',`/payroll/loan-requests/${ids.request}/disburse`),call('ACCOUNTANT','post',`/payroll/loan-requests/${ids.request}/disburse`)]);
  expect(paid.map(r=>r.status).sort()).toEqual([201,409]);expect(await balance()).toBe(9000);
  expect(await basePrisma.staffLoan.count({where:{schoolId:t.school.id}})).toBe(1);
 });
 it('allows delegated approval, rejects replay and prevents other branch access',async()=>{
  await basePrisma.rolePermission.create({data:{schoolId:t.school.id,role:'PRINCIPAL',permission:'loan.approve',granted:true}});forgetRoleOverrides(t.school.id);
  const r=await call('ACCOUNTANT','post','/payroll/loan-requests',{staffId:ids.staff,kind:'ADVANCE',amount:200,issuedOn:today,accountId:ids.cash,note:'Rejected QA request'});
  expect((await call('PRINCIPAL','post',`/payroll/loan-requests/${r.body.data.id}/decision`,{approve:false})).status).toBe(200);
  expect((await call('OWNER','post',`/payroll/loan-requests/${r.body.data.id}/decision`,{approve:true})).status).toBe(409);
  expect((await call('ACCOUNTANT','post',`/payroll/loan-requests/${r.body.data.id}/disburse`)).status).toBe(409);
  const stranger=await basePrisma.loanRequest.create({data:{schoolId:ids.foreignSchool,requestedById:users.OWNER.id,payload:{},status:'PENDING'}});
  expect((await call('OWNER','post',`/payroll/loan-requests/${stranger.id}/decision`,{approve:true})).status).toBe(404);
  expect((await call('OWNER','get','/payroll/loan-requests')).body.data.some((r:any)=>r.id===stranger.id)).toBe(false);
 });
 it('lets only owner/principal configure valid diary rules and publishes directly',async()=>{
  const policy={mode:'SUBJECT',deadline:'23:59',weekdays:[0,1,2,3,4,5,6]};
  expect((await call('TEACHER','put','/diary/policy',policy)).status).toBe(403);
  expect((await call('PRINCIPAL','put','/diary/policy',policy)).status).toBe(200);
  expect((await call('OWNER','get','/diary/options')).body.data.teachers.map((s:any)=>s.id)).toContain(ids.staff);
  expect((await call('PARENT','get','/diary/options')).status).toBe(403);
  expect((await call('OWNER','put','/diary/policy',{...policy,deadline:'25:00'})).status).toBe(422);
  const r=await call('TEACHER','post','/diary',{sectionId:ids.section,subjectId:ids.subject,title:'Workflow homework',content:'Read chapter one',date:today});expect(r.status).toBe(201);ids.entry=r.body.data.id;
  const family=await call('PARENT','get',`/diary?studentId=${ids.student}`);expect(family.body.data.some((e:any)=>e.id===ids.entry)).toBe(true);
 });
 it('counts each student once when parents view a diary and denies forged views',async()=>{
  const b={studentId:ids.student,entryIds:[ids.entry]};
  expect((await call('STUDENT','post','/diary/views',b)).status).toBe(403);
  expect((await call('PARENT','post','/diary/views',b)).status).toBe(200);expect((await call('PARENT','post','/diary/views',b)).status).toBe(200);
  expect(await basePrisma.diaryView.count({where:{diaryEntryId:ids.entry}})).toBe(1);
  expect((await call('PARENT','post','/diary/views',{...b,studentId:users.TEACHER.id})).status).toBe(404);
  const d=await call('OWNER','get',`/diary/dashboard?from=${today}&to=${today}`);expect(d.status).toBe(200);expect(d.body.data.stats.parentViews).toBe(50);expect(d.body.data.stats.pending).toBe(0);expect(d.body.data.rows[0].status).toBe('ON_TIME');
 });
 it('derives missing and delayed updates from the rules, excludes holidays, exports safely',async()=>{
  const yesterday=toIso(addDays(toDate(today),-1));
  let d=await call('OWNER','get',`/diary/dashboard?from=${yesterday}&to=${yesterday}`);expect(d.body.data.stats.pending).toBe(1);expect(d.body.data.rows[0].status).toBe('NOT_UPDATED');
  await call('TEACHER','post','/diary',{sectionId:ids.section,subjectId:ids.subject,title:'Delayed QA update',content:'Posted later',date:yesterday});
  d=await call('OWNER','get',`/diary/dashboard?from=${yesterday}&to=${yesterday}&status=DELAYED`);expect(d.body.data.rows).toHaveLength(1);
  await basePrisma.calendarEvent.create({data:{schoolId:t.school.id,title:'QA holiday',type:'HOLIDAY',startDate:toDate(today),endDate:toDate(today)}});
  d=await call('OWNER','get',`/diary/dashboard?from=${today}&to=${today}`);expect(d.body.data.expected).toBe(0);
  for(const format of ['pdf','xlsx'])expect((await call('OWNER','get',`/diary/dashboard?from=${today}&to=${today}&format=${format}`)).status).toBe(200);
  expect((await call('OWNER','get',`/diary/dashboard?from=${today}&to=${today}&format=xlsx&report=teachers`)).status).toBe(200);
  expect((await call('PARENT','get','/diary/dashboard')).status).toBe(403);
  expect((await call('OWNER','get','/diary/dashboard?from=2026-02-30&to=2026-03-01')).status).toBe(422);
 });
 it('keeps manually recovered loans out of payroll deductions',async()=>{
  const r=await call('ACCOUNTANT','post','/payroll/loan-requests',{staffId:ids.staff,kind:'LOAN',amount:500,issuedOn:today,accountId:ids.cash,recoveryMethod:'MANUAL',note:'Manual recovery QA'});expect(r.status).toBe(201);
  expect((await call('OWNER','post',`/payroll/loan-requests/${r.body.data.id}/decision`,{approve:true})).status).toBe(200);
  const paid=await call('ACCOUNTANT','post',`/payroll/loan-requests/${r.body.data.id}/disburse`);expect(paid.status).toBe(201);expect(paid.body.data.recoveryMethod).toBe('MANUAL');
  const month=today.slice(0,7);
  expect((await call('ADMIN','post',`/hr/staff/${ids.staff}/salary`,{effectiveFrom:month+'-01',basic:30000,components:[]})).status).toBe(201);
  const run=await call('ACCOUNTANT','post','/payroll/runs',{period:month});expect(run.status).toBe(201);
  const detail=await call('OWNER','get',`/payroll/runs/${run.body.data.id}`);expect(Number(detail.body.data.lines[0].loanDeduction)).toBe(250);
  expect((await call('ACCOUNTANT','post',`/payroll/loans/${paid.body.data.id}/repayments`,{amount:500,paidOn:today,accountId:ids.cash})).status).toBe(201);
 });
 it('filters exams by branch academic year and includes honest marks denominators',async()=>{
  const list=await call('OWNER','get',`/exams?academicYearId=${t.year.id}`);expect(list.status).toBe(200);
  expect((await call('OWNER','get',`/exams?academicYearId=${ids.foreignSchool}`)).status).toBe(404);
  const created=await call('PRINCIPAL','post','/exams',{name:'Workflow QA exam'});expect(created.status).toBe(201);
  const next=await call('OWNER','get','/exams');expect(next.body.data.find((e:any)=>e.id===created.body.data.id).marksExpected).toBe(0);
  expect((await call('PARENT','get','/exams/options')).body.data.years.map((y:any)=>y.id)).toEqual([t.year.id]);
 });
});
