import 'dotenv/config';
import { basePrisma as db } from '../config/database';
import { hashPassword } from '../utils/password';
import { runWithTenant } from '../config/tenancy';
import { ensureLedgerSetup } from '../utils/ledger';

/** Persistent, labelled QA fixtures. Never deletes or resets records. Local demo only. */
export const REPORTS_QA_PASSWORD = 'ReportsQA!2026';
const day = (s:string) => new Date(`${s}T00:00:00Z`);
export async function seedReports() {
  if (process.env.NODE_ENV === 'production') throw new Error('Reports QA seed is not allowed in production');
  if (!await db.brand.findUnique({where:{code:'reports-qa'}})) {
    const password=await hashPassword(REPORTS_QA_PASSWORD);
    await db.$transaction(async tx=>{
      const brand=await tx.brand.create({data:{name:'Reports QA — retained test data',code:'reports-qa',maxBranches:2,maxStudents:50}});
      const main=await tx.school.create({data:{brandId:brand.id,name:'Reports QA Main',code:'reports-qa-main',libraryFinePerDay:10}});
      const other=await tx.school.create({data:{brandId:brand.id,name:'Reports QA Isolation Branch',code:'reports-qa-isolation'}});
      const schoolId=main.id;
      const year=await tx.academicYear.create({data:{schoolId,name:'2026-27',startDate:day('2026-04-01'),endDate:day('2027-03-31'),isCurrent:true}});
      await tx.academicYear.create({data:{schoolId:other.id,name:'2026-27',startDate:day('2026-04-01'),endDate:day('2027-03-31'),isCurrent:true}});
      const users:Record<string,string>={};
      for(const role of ['OWNER','PRINCIPAL','ADMIN','ACCOUNTANT','TEACHER','PARENT','STUDENT'] as const){const u=await tx.user.create({data:{schoolId,role,name:`Reports QA ${role}`,username:`reports.qa.${role.toLowerCase()}`,email:`reports.qa.${role.toLowerCase()}@demo.local`,password}});users[role]=u.id;}
      await tx.brandOwner.create({data:{brandId:brand.id,userId:users.OWNER}});
      const teacher=await tx.staff.create({data:{schoolId,userId:users.TEACHER,name:'QA Ayesha Teacher',employeeNo:'QA-EMP-01',department:'QA Academics',designation:'Teacher',joiningDate:day('2026-01-01')}});
      const clerk=await tx.staff.create({data:{schoolId,name:'QA Bilal Clerk',employeeNo:'QA-EMP-02',department:'QA Office',designation:'Clerk',isTeacher:false,joiningDate:day('2026-01-01')}});
      await tx.staff.create({data:{schoolId,name:'QA Former Staff',employeeNo:'QA-EMP-03',department:'QA Office',designation:'Assistant',isTeacher:false,status:'LEFT',leftOn:day('2026-10-31')}});
      for (const [i,status] of (['PRESENT','ABSENT','LATE','HALF_DAY','LEAVE'] as const).entries()) await tx.staffAttendance.create({data:{schoolId,staffId:teacher.id,date:day(`2026-11-0${i+1}`),status,markedById:users.ADMIN}});
      for (const [staffId,effectiveFrom,basic] of [[teacher.id,'2026-10-01',28000],[teacher.id,'2026-11-01',30000],[teacher.id,'2027-01-01',60000],[clerk.id,'2026-11-01',20000]] as const) {
        const s=await tx.salaryStructure.create({data:{schoolId,staffId,effectiveFrom:day(effectiveFrom),basic,note:'Persistent reports QA sample'}});
        if(staffId===teacher.id&&effectiveFrom==='2026-11-01') await tx.salaryComponent.createMany({data:[{schoolId,structureId:s.id,kind:'ALLOWANCE',name:'Housing',amount:5000},{schoolId,structureId:s.id,kind:'DEDUCTION',name:'Tax',amount:1000}]});
      }
      await tx.leaveRequest.createMany({data:[{schoolId,staffId:teacher.id,type:'CASUAL',fromDate:day('2026-11-05'),toDate:day('2026-11-05'),reason:'QA approved leave',status:'APPROVED'},{schoolId,staffId:clerk.id,type:'SICK',fromDate:day('2026-11-15'),toDate:day('2026-11-16'),reason:'QA pending leave',status:'PENDING'}]});
      const cls=await tx.class.create({data:{schoolId,name:'QA Class 1',level:1}});const section=await tx.section.create({data:{schoolId,classId:cls.id,name:'A',classTeacherId:teacher.id}});
      const student=await tx.student.create({data:{schoolId,sectionId:section.id,name:'QA Sara Student',admissionNo:'QA-ADM-01',gender:'FEMALE',admissionDate:day('2026-04-01')}});
      const student2=await tx.student.create({data:{schoolId,sectionId:section.id,name:'QA Usman Student',admissionNo:'QA-ADM-02',gender:'MALE',admissionDate:day('2026-04-01')}});
      const cash=await tx.moneyAccount.create({data:{schoolId,name:'QA Cash',type:'CASH',methods:['CASH'],openingBalance:100000,openingDate:day('2026-01-01')}});
      const bank=await tx.moneyAccount.create({data:{schoolId,name:'QA Bank',type:'BANK',methods:['BANK_TRANSFER'],openingBalance:200000,openingDate:day('2026-01-01')}});
      const utilities=await tx.financeCategory.create({data:{schoolId,kind:'EXPENSE',name:'QA Utilities'}});const salary=await tx.financeCategory.create({data:{schoolId,kind:'EXPENSE',name:'Salaries'}});const income=await tx.financeCategory.create({data:{schoolId,kind:'INCOME',name:'QA Donations'}});
      await tx.expense.createMany({data:[{schoolId,expenseNo:'QA-EXP-01',categoryId:utilities.id,accountId:cash.id,amount:1500,expenseDate:day('2026-11-02'),paidTo:'QA Utility Supplier',description:'QA approved utility bill',status:'APPROVED'},{schoolId,expenseNo:'QA-EXP-02',categoryId:utilities.id,accountId:cash.id,amount:900,expenseDate:day('2026-11-03'),paidTo:'QA Utility Supplier',description:'QA pending bill',status:'PENDING'},{schoolId,expenseNo:'QA-EXP-03',categoryId:utilities.id,accountId:cash.id,amount:700,expenseDate:day('2026-11-04'),description:'QA rejected bill',status:'REJECTED'}]});
      await tx.otherIncome.create({data:{schoolId,incomeNo:'QA-INC-01',categoryId:income.id,accountId:cash.id,amount:2500,incomeDate:day('2026-11-04'),receivedFrom:'QA Donor',description:'QA sample donation'}});
      const payroll=await tx.payrollRun.create({data:{schoolId,period:'2026-11',status:'PAID',paymentDate:day('2026-11-10'),paidAt:day('2026-11-10'),accountId:bank.id,note:'QA paid payroll'}});
      const line=await tx.payrollLine.create({data:{schoolId,runId:payroll.id,staffId:teacher.id,name:teacher.name,employeeNo:teacher.employeeNo,department:teacher.department,designation:teacher.designation,basic:30000,allowances:[{name:'Housing',amount:5000}],fixedDeductions:[{name:'Tax',amount:1000}],gross:35000,daysInMonth:30,deductDays:2,absenceDeduction:2000,loanDeduction:2000,totalDeductions:5000,net:30000}});
      await tx.expense.create({data:{schoolId,expenseNo:'QA-EXP-SAL',categoryId:salary.id,accountId:bank.id,amount:30000,expenseDate:day('2026-11-10'),description:'QA November salaries',status:'APPROVED',payrollRunId:payroll.id}});
      const draft=await tx.payrollRun.create({data:{schoolId,period:'2026-12',status:'DRAFT',note:'QA draft; not paid'}});
      await tx.payrollLine.create({data:{schoolId,runId:draft.id,staffId:clerk.id,name:clerk.name,employeeNo:clerk.employeeNo,department:clerk.department,basic:20000,allowances:[],fixedDeductions:[],gross:20000,daysInMonth:31,totalDeductions:0,net:20000}});
      const advance=await tx.staffLoan.create({data:{schoolId,loanNo:'QA-ADV-01',staffId:teacher.id,kind:'ADVANCE',amount:2000,issuedOn:day('2026-11-01'),accountId:cash.id,installment:2000,startPeriod:'2026-11',status:'SETTLED',note:'QA fully recovered advance'}});
      const loan=await tx.staffLoan.create({data:{schoolId,loanNo:'QA-LOAN-01',staffId:clerk.id,kind:'LOAN',amount:10000,issuedOn:day('2026-11-01'),accountId:cash.id,installment:2000,startPeriod:'2026-11',note:'QA partly recovered loan'}});
      await tx.loanRepayment.createMany({data:[{schoolId,loanId:advance.id,amount:2000,paidOn:day('2026-11-10'),payrollLineId:line.id,note:'QA payroll recovery'},{schoolId,loanId:loan.id,amount:3000,paidOn:day('2026-11-05'),accountId:cash.id,note:'QA cash recovery'}]});
      await tx.moneyTransaction.createMany({data:[{schoolId,accountId:cash.id,type:'DEPOSIT',amount:1000,txDate:day('2026-11-06'),description:'QA capital contribution'},{schoolId,accountId:cash.id,type:'TRANSFER_OUT',amount:2000,txDate:day('2026-11-07'),transferId:'reports-qa-transfer',description:'QA transfer to bank'},{schoolId,accountId:bank.id,type:'TRANSFER_IN',amount:2000,txDate:day('2026-11-07'),transferId:'reports-qa-transfer',description:'QA transfer from cash'}]});
      const payment=await tx.payment.create({data:{schoolId,studentId:student.id,receiptNo:'QA-RCPT-01',amount:5000,method:'CASH',accountId:cash.id,paidAt:new Date('2026-11-08T05:00:00Z'),collectedById:users.ACCOUNTANT}});
      const inv=await tx.feeInvoice.create({data:{schoolId,studentId:student.id,academicYearId:year.id,invoiceNo:'QA-INV-01',period:'2026-11',issueDate:day('2026-11-01'),dueDate:day('2026-11-10'),grossAmount:10000,netAmount:10000,paidAmount:5000,status:'PARTIAL'}});
      await tx.paymentAllocation.create({data:{schoolId,paymentId:payment.id,invoiceId:inv.id,amount:5000}});
      const book=await tx.book.create({data:{schoolId,title:'QA Science Workbook',author:'QA Author',isbn:'QA-ISBN-01',category:'QA Science',shelf:'QA-A1',copies:2}});
      const atlas=await tx.book.create({data:{schoolId,title:'QA Reference Atlas',author:'QA Author',category:'QA Reference',copies:1}});
      await tx.bookIssue.createMany({data:[{schoolId,bookId:book.id,studentId:student.id,issuedAt:day('2026-11-01'),dueDate:day('2026-11-05'),issuedById:users.ADMIN},{schoolId,bookId:atlas.id,studentId:student2.id,issuedAt:day('2026-11-01'),dueDate:day('2026-11-06'),returnedAt:day('2026-11-09'),fine:30,finePaid:false,issuedById:users.ADMIN}]});
      const route=await tx.transportRoute.create({data:{schoolId,name:'QA Main Route',vehicleNo:'QA-101',driverName:'QA Driver',driverPhone:'03000000001',capacity:10,monthlyFee:1500}});
      await tx.transportRoute.create({data:{schoolId,name:'QA Inactive Route',isActive:false,capacity:5,monthlyFee:1000}});
      const stop=await tx.transportStop.create({data:{schoolId,routeId:route.id,name:'QA Gate',pickupTime:'07:10',dropTime:'14:10'}});
      await tx.studentTransport.create({data:{schoolId,studentId:student.id,routeId:route.id,stopId:stop.id,since:day('2026-11-01')}});
      await tx.moneyAccount.create({data:{schoolId:other.id,name:'QA Isolation Cash',type:'CASH',methods:[],openingBalance:999999,openingDate:day('2026-01-01')}});
      await tx.staff.create({data:{schoolId:other.id,employeeNo:'QA-OTHER-01',name:'QA Isolation Staff',department:'Isolation Department'}});
      await tx.book.create({data:{schoolId:other.id,title:'QA Isolation Book',copies:1}});
      await tx.transportRoute.create({data:{schoolId:other.id,name:'QA Isolation Route',monthlyFee:999}});
    },{timeout:60_000});
  }
  const main=await db.school.findUniqueOrThrow({where:{code:'reports-qa-main'}});
  await runWithTenant(main.id,()=>ensureLedgerSetup());
  return { main, other:await db.school.findUniqueOrThrow({where:{code:'reports-qa-isolation'}}), users:await db.user.findMany({where:{schoolId:main.id}}), staff:await db.staff.findMany({where:{schoolId:main.id},orderBy:{employeeNo:'asc'}}), accounts:await db.moneyAccount.findMany({where:{schoolId:main.id}}), categories:await db.financeCategory.findMany({where:{schoolId:main.id}}), books:await db.book.findMany({where:{schoolId:main.id}}), routes:await db.transportRoute.findMany({where:{schoolId:main.id}}), sections:await db.section.findMany({where:{schoolId:main.id}}) };
}
if(require.main===module) seedReports().then(()=>console.log('Persistent Reports QA fixtures ready. Username: reports.qa.owner; password: ReportsQA!2026. Data is retained.')).catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.$disconnect());
