import 'dotenv/config';
import { basePrisma as db } from '../config/database';

/** Exposes the retained regression fixtures through stable local demo logins. */
async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Workflow QA setup is disabled in production');
  const existing=await db.user.findUnique({where:{username:'workflow.qa.owner'}});
  const school=existing?.schoolId?await db.school.findUniqueOrThrow({where:{id:existing.schoolId}}):await db.school.findFirst({where:{code:{startsWith:'retained-workflow-qa-'}},orderBy:{createdAt:'desc'}});
  if(!school)throw new Error('Run the schoolWorkflows.db.test.ts DB suite first to create retained fixtures');
  const users=await db.user.findMany({where:{schoolId:school.id}});
  for(const user of users){
    const username=`workflow.qa.${user.role.toLowerCase()}`;
    const found=await db.user.findUnique({where:{username}});
    if(!found)await db.user.update({where:{id:user.id},data:{username,name:`Workflow QA ${user.role.toLowerCase()}`}});
  }
  const year=await db.academicYear.findFirstOrThrow({where:{schoolId:school.id,isCurrent:true}});
  const staff=await db.staff.findFirst({where:{schoolId:school.id,isTeacher:true}});
  const cash=await db.moneyAccount.findFirst({where:{schoolId:school.id,type:'CASH'}});
  const accountant=users.find(u=>u.role==='ACCOUNTANT');
  const note='Demo pending approval — retained workflow QA';
  if(staff&&cash&&accountant&&!await db.loanRequest.findFirst({where:{schoolId:school.id,payload:{path:'$.note',equals:note}}})){
    const date=new Intl.DateTimeFormat('en-CA',{timeZone:school.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    await db.loanRequest.create({data:{schoolId:school.id,requestedById:accountant.id,payload:{staffId:staff.id,kind:'ADVANCE',amount:750,issuedOn:date,accountId:cash.id,installment:750,startPeriod:date.slice(0,7),recoveryMethod:'SALARY',note}}});
  }
  const next=year.endDate.getUTCFullYear();
  if(!await db.academicYear.findFirst({where:{schoolId:school.id,name:`${next}-${String(next+1).slice(-2)}`}}))await db.academicYear.create({data:{schoolId:school.id,name:`${next}-${String(next+1).slice(-2)}`,startDate:new Date(Date.UTC(next,3,1)),endDate:new Date(Date.UTC(next+1,2,31))}});
  console.log('Retained workflow QA branch:',school.name);
  console.log('Demo usernames:',users.map(u=>`workflow.qa.${u.role.toLowerCase()}`).join(', '));
  console.log('Demo password: Test@12345 (local fixtures only). Existing data was retained.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.$disconnect());
