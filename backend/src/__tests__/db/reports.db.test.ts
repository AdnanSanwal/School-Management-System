import 'dotenv/config';
import request from 'supertest';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import app from '../../app';
import { toPdf, toXlsx } from '../../utils/tableReport';
import { connectRedis } from '../../config/redis';
import { basePrisma } from '../../config/database';
import { seedReports } from '../../database/seedReports';
import { signToken } from '../../utils/jwt';
import { runWithTenant } from '../../config/tenancy';
import { ensureLedgerSetup } from '../../utils/ledger';

const suite=process.env.RUN_DB_TESTS==='1'?describe:describe.skip;
jest.setTimeout(180_000);
suite('Reports — persistent QA fixtures, filters, permissions and exports',()=>{
  let f:Awaited<ReturnType<typeof seedReports>>;
  let owner:string; let tokens:Record<string,string>={};let chart:any[]=[];
  const exportsPath=path.resolve(__dirname,'../../../../artifacts/reports-qa');
  const query=(type:string,q:Record<string,string>={})=>`/api/v1/reports/${type}?${new URLSearchParams({format:'view',...q})}`;
  const get=(type:string,q:Record<string,string>={},token=owner)=>request(app).get(query(type,q)).auth(token,{type:'bearer'});
  const file=(type:string,format:string,q:Record<string,string>)=>request(app).get(query(type,{...q,format})).auth(owner,{type:'bearer'}).buffer(true).parse((res,cb)=>{const chunks:Buffer[]=[];res.on('data',(c:Buffer)=>chunks.push(c));res.on('end',()=>cb(null,Buffer.concat(chunks)));});
  beforeAll(async()=>{await connectRedis();f=await seedReports();for(const u of f.users)tokens[u.role]=signToken({id:u.id,schoolId:f.main.id,role:u.role,email:u.email});owner=tokens.OWNER;chart=await runWithTenant(f.main.id,()=>ensureLedgerSetup());fs.mkdirSync(exportsPath,{recursive:true});});
  // Intentionally no fixture deletion: the user requested retaining all dummy data.
  const qFor=(type:string)=>({...(type==='student-attendance-register'?{sectionId:f.sections[0].id,month:'2026-11'}:{}),...(type==='staff-attendance'?{month:'2026-11'}:{}),...(['salaries','accounts','chart-of-accounts','trial-balance','balance-sheet'].includes(type)?{asOf:'2026-11-30'}:{}),...(['fee-collection','staff-attendance-detail','expenses','other-income','account-transactions','income-statement','journal','account-ledger','leave'].includes(type)?{from:'2026-11-01',to:'2026-11-30'}:{}),...(type==='account-ledger'?{ledgerAccountId:chart.find(a=>a.moneyAccountId===f.accounts.find(a=>a.name==='QA Cash')!.id)!.id}:{})});
  it('exports every available report to matching screen, PDF and Excel formats',async()=>{
    const catalog=await request(app).get('/api/v1/reports').auth(owner,{type:'bearer'});
    expect(catalog.status).toBe(200);expect(catalog.body.data.length).toBeGreaterThanOrEqual(27);
    const checked:string[]=[];
    for(const type of catalog.body.data as string[]){
      const params=qFor(type);const view=await get(type,params);
      expect({type,status:view.status,message:view.body.message}).toMatchObject({type,status:200});
      const r=view.body.data;expect(r.school).toBe('Reports QA Main');expect(r.columns.length).toBeGreaterThan(0);for(const row of [...r.rows,r.totals??{}]) for(const value of Object.values(row)) if(typeof value==='number')expect(Number.isFinite(value)).toBe(true);
      const xlsx=await file(type,'xlsx',params);expect({type,status:xlsx.status}).toEqual({type,status:200});
      const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(xlsx.body);const sheet=workbook.worksheets[0];
      const header=sheet.getRows(1,Math.min(10,sheet.rowCount))!.find(row=>row.getCell(1).value===r.columns[0].label)!;expect(header).toBeDefined();
      for(let i=0;i<r.rows.length;i++) for(let j=0;j<r.columns.length;j++){const value=r.rows[i][r.columns[j].key];const actual=sheet.getRow(header.number+1+i).getCell(j+1).value;if(value!==null&&value!==undefined)expect(actual).toEqual(value);}
      const pdf=await file(type,'pdf',params);expect({type,status:pdf.status}).toEqual({type,status:200});expect(pdf.body.subarray(0,5).toString()).toBe('%PDF-');expect(pdf.body.length).toBeGreaterThan(900);
      fs.writeFileSync(path.join(exportsPath,`${type}.xlsx`),xlsx.body);fs.writeFileSync(path.join(exportsPath,`${type}.pdf`),pdf.body);checked.push(type);
    }
    fs.writeFileSync(path.join(exportsPath,'verified-catalog.json'),JSON.stringify(checked,null,2));
  });
  it('exports a multi-page report with zero, null and long text values',async()=>{
    const report={title:'QA multi-page / stress [export]',school:'Reports QA Main',currency:'PKR',columns:[{key:'name',label:'Description'},{key:'amount',label:'Amount',type:'money' as const}],rows:Array.from({length:120},(_,i)=>({name:`QA retained export row ${i+1} — long description for wrapping and clipping checks`,amount:i===0?0:i===1?null:i+0.25})),totals:{name:'Total',amount:7168.5}};
    const pdf=await toPdf(report);const xlsx=await toXlsx(report);expect(pdf.subarray(0,5).toString()).toBe('%PDF-');
    fs.writeFileSync(path.join(exportsPath,'pagination-stress.pdf'),pdf);fs.writeFileSync(path.join(exportsPath,'pagination-stress.xlsx'),xlsx);
  });
  it('counts all staff attendance statuses correctly and applies staff/department/status filters',async()=>{
    const r=await get('staff-attendance',{month:'2026-11',staffId:f.staff[0].id});expect(r.status).toBe(200);expect(r.body.data.rows).toHaveLength(1);expect(r.body.data.rows[0]).toMatchObject({present:1,late:1,absent:1,leave:1,half:1,pct:50});
    const details=await get('staff-attendance-detail',{from:'2026-11-01',to:'2026-11-30',attendanceStatus:'ABSENT',department:'QA Academics'});expect(details.body.data.rows).toHaveLength(1);expect(details.body.data.rows[0].date).toBe('2026-11-02');
    const left=await get('staff-directory',{staffStatus:'LEFT'});expect(left.body.data.rows.map((r:any)=>r.name)).toEqual(['QA Former Staff']);
  });
  it('selects the effective salary rather than a future raise and filters payroll snapshots',async()=>{
    const old=await get('salaries',{asOf:'2026-10-31',staffId:f.staff[0].id});expect(old.body.data.rows[0].basic).toBe(28000);
    const current=await get('salaries',{asOf:'2026-11-30',staffId:f.staff[0].id});expect(current.body.data.rows[0]).toMatchObject({basic:30000,allowances:5000,deductions:1000,gross:35000,net:34000});
    const paid=await get('payroll',{fromPeriod:'2026-11',toPeriod:'2026-11',payrollStatus:'PAID'});expect(paid.body.data.rows).toHaveLength(1);expect(paid.body.data.totals.net).toBe(30000);
    const detail=await get('payroll-detail',{staffId:f.staff[0].id,payrollStatus:'PAID'});expect(detail.body.data.rows[0]).toMatchObject({gross:35000,absence:2000,loan:2000,deductions:5000,net:30000});
  });
  it('separates approved expenses from pending/rejected and verifies exact money-account balances',async()=>{
    const utilities=f.categories.find(c=>c.name==='QA Utilities')!;
    const approved=await get('expenses',{categoryId:utilities.id,approvalStatus:'APPROVED'});expect(approved.body.data.totals.amount).toBe(1500);expect(approved.body.data.rows).toHaveLength(1);
    const pending=await get('expenses',{approvalStatus:'PENDING'});expect(pending.body.data.totals.amount).toBe(900);
    const cash=f.accounts.find(a=>a.name==='QA Cash')!;const bank=f.accounts.find(a=>a.name==='QA Bank')!;
    expect((await get('accounts',{asOf:'2026-11-30',accountId:cash.id})).body.data.rows[0].balance).toBe(96000);
    expect((await get('accounts',{asOf:'2026-11-30',accountId:bank.id})).body.data.rows[0].balance).toBe(172000);
    expect((await get('other-income',{from:'2026-11-01',to:'2026-11-30'})).body.data.totals.amount).toBe(2500);
  });
  it('reports advance/loan recovery totals without double-counting payroll deductions',async()=>{
    const loans=await get('advances-loans',{loanKind:'LOAN'});expect(loans.body.data.rows).toHaveLength(1);expect(loans.body.data.rows[0]).toMatchObject({amount:10000,repaid:3000,balance:7000});
    const advance=await get('advances-loans',{loanKind:'ADVANCE',loanStatus:'SETTLED'});expect(advance.body.data.totals.balance).toBe(0);
    expect((await get('loan-repayments',{recovery:'PAYROLL'})).body.data.totals.amount).toBe(2000);
    expect((await get('loan-repayments',{recovery:'CASH'})).body.data.totals.amount).toBe(3000);
    const movements=await get('account-transactions',{from:'2026-11-01',to:'2026-11-30',movementKind:'EXPENSE'});expect(movements.body.data.totals.out).toBe(31500);
  });
  it('matches account ledger closing balances to cash, and trial balance debits to credits',async()=>{
    const trial=await get('trial-balance',{asOf:'2026-11-30'});expect(trial.body.data.totals.debit).toBe(trial.body.data.totals.credit);
    const ledger=await get('account-ledger',qFor('account-ledger'));expect(ledger.body.data.totals.balance).toBe(96000);
    const statement=await get('income-statement',{from:'2026-11-01',to:'2026-11-30'});expect(statement.body.data.rows.filter((r:any)=>r.type==='INCOME').reduce((s:number,r:any)=>s+r.amount,0)).toBe(7500);
    const bs=await get('balance-sheet',{asOf:'2026-11-30'});const rows=bs.body.data.rows;const assets=rows.filter((r:any)=>r.type==='ASSET').reduce((s:number,r:any)=>s+r.amount,0);const le=rows.filter((r:any)=>r.type!=='ASSET').reduce((s:number,r:any)=>s+r.amount,0);expect(assets).toBe(le);
  });
  it('filters library stock, circulation/fines, transport routes and riders',async()=>{
    const books=await get('library-stock',{libraryCategory:'QA Science'});expect(books.body.data.rows).toHaveLength(1);expect(books.body.data.rows[0]).toMatchObject({copies:2,issued:1,available:1});
    const overdue=await get('library-issues',{issueStatus:'OVERDUE'});expect(overdue.body.data.rows).toHaveLength(1);expect(overdue.body.data.rows[0].name).toBe('QA Sara Student');expect(Number.isFinite(overdue.body.data.rows[0].estimated)).toBe(true);expect(overdue.body.data.rows[0].estimated).toBeGreaterThan(0);
    const fines=await get('library-issues',{issueStatus:'UNPAID_FINE'});expect(fines.body.data.totals.unpaid).toBe(30);
    const routes=await get('transport-routes',{active:'true'});expect(routes.body.data.rows).toHaveLength(1);expect(routes.body.data.rows[0]).toMatchObject({riders:1,fee:1500,expected:1500});
    expect((await get('transport-assignments',{routeId:f.routes.find(r=>r.name==='QA Main Route')!.id})).body.data.rows[0]).toMatchObject({name:'QA Sara Student',pickup:'07:10',drop:'14:10',fee:1500});
  });
  it('filters approved leave and balances, rejects invalid date/month/filter inputs, handles empty ranges',async()=>{
    const leaves=await get('leave',{from:'2026-11-01',to:'2026-11-30',approvalStatus:'APPROVED',staffId:f.staff[0].id});expect(leaves.body.data.totals.days).toBe(1);
    const balances=await get('leave-balances',{staffId:f.staff[0].id});expect(balances.body.data.rows.find((r:any)=>r.type==='CASUAL').used).toBe(1);
    for(const [type,q] of [['expenses',{from:'2026-11-30',to:'2026-11-01'}],['expenses',{from:'2026-02-30'}],['payroll',{fromPeriod:'2026-12',toPeriod:'2026-11'}],['expenses',{approvalStatus:'MALICIOUS'}],['staff-attendance',{month:'2026-13'}],['expenses',{unsupported:'x'}]] as [string,Record<string,string>][]){expect((await get(type,q)).status).toBe(422);}
    const empty=await get('expenses',{from:'2040-01-01',to:'2040-01-02'});expect(empty.body.data.rows).toEqual([]);expect(empty.body.data.totals.amount).toBe(0);
  });
  it('enforces module permissions for views, options, PDF and Excel',async()=>{
    for(const role of ['TEACHER','PARENT','STUDENT']) for(const type of ['salaries','payroll','accounts','expenses','library-stock','transport-routes']){
      expect((await get(type,{},tokens[role])).status).toBe(403);
      expect((await request(app).get(`/api/v1/reports/${type}/options`).auth(tokens[role],{type:'bearer'})).status).toBe(403);
      for(const format of ['pdf','xlsx']) expect((await get(type,{format},tokens[role])).status).toBe(403);
    }
    expect((await get('accounts',{},tokens.ADMIN)).status).toBe(403);
    expect((await get('salaries',{asOf:'2026-11-30'},tokens.ADMIN)).status).toBe(200);
  });
  it('never mixes branch records, IDs or filter options',async()=>{
    const outsider=await basePrisma.moneyAccount.findFirstOrThrow({where:{schoolId:f.other.id}});
    expect((await get('accounts',{accountId:outsider.id})).body.data.rows).toEqual([]);
    for(const type of ['accounts','staff-directory','library-stock','transport-routes'])expect(JSON.stringify((await get(type,type==='accounts'?{asOf:'2026-11-30'}:{})).body.data)).not.toContain('QA Isolation');
    const options=await request(app).get('/api/v1/reports/salaries/options').auth(owner,{type:'bearer'});expect(JSON.stringify(options.body.data)).not.toContain('Isolation');
    const isolatedToken=signToken({id:f.users.find(u=>u.role==='OWNER')!.id,schoolId:f.other.id,role:'OWNER',email:null});
    expect((await get('accounts',{asOf:'2026-11-30'},isolatedToken)).body.data.rows.some((r:any)=>r.name==='QA Isolation Cash')).toBe(true);
    expect((await get('expenses',{},isolatedToken)).body.data.rows).toEqual([]);
    expect((await get('constructor')).status).toBe(404);
  });
});
