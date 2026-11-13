'use client';

import { useQuery } from '@tanstack/react-query';
import { Field, SectionSelect, StudentPicker } from '@/components/ui/kit';
import { academicsAPI, reportsAPI, apiError } from '@/lib/api';
import { todayIso } from '@/lib/utils';

export type ExtraKey = 'staffId' | 'department' | 'designation' | 'staffStatus' | 'isTeacher' | 'asOf' | 'fromPeriod' | 'toPeriod' | 'payrollStatus' | 'accountId' | 'accountType' | 'active' | 'categoryId' | 'approvalStatus' | 'loanKind' | 'loanStatus' | 'recovery' | 'movementKind' | 'routeId' | 'studentStatus' | 'bookId' | 'libraryCategory' | 'issueStatus' | 'availability' | 'ledgerAccountId' | 'ledgerType' | 'search' | 'attendanceStatus' | 'academicYearId' | 'leaveType';
export type Param = 'dateRange' | 'month' | 'section' | 'optionalSection' | 'class' | 'student' | 'overdue' | ExtraKey;

/** Every report, its description and the filters it accepts (mirrors backend/src/modules/reports). */
export const REPORT_META: Record<string, { title: string; desc: string; params: Param[] }> = {
  'fee-collection': { title: 'Fee collection', desc: 'Every receipt in a date range, with totals by payment method. Use the same date for a daily report.', params: ['dateRange', 'class', 'student'] },
  'fee-monthly-summary': { title: 'Monthly fee summary', desc: 'Billed, received and still pending, month by month for this academic year.', params: ['class', 'student'] },
  defaulters: { title: 'Defaulter list', desc: 'Students with overdue fee, parent phone numbers and months owed.', params: ['class', 'student', 'overdue'] },
  'student-attendance-register': { title: 'Student attendance register', desc: 'One row per student, one column per school day, with totals.', params: ['section', 'month'] },
  'class-strength': { title: 'Class-wise strength', desc: 'Students per section with boys/girls and class teacher.', params: ['class'] },
  leave: { title: 'Leave report', desc: 'All staff leave requests and approved days.', params: ['dateRange','staffId','department','designation','staffStatus','leaveType','approvalStatus'] },
  'leave-balances': { title: 'Leave balances', desc: 'Annual leave allowance, used, pending and unpaid days by staff member.', params: ['academicYearId','staffId','department','designation','staffStatus'] },
  'staff-directory': { title: 'Staff directory', desc: 'Staff records by department, designation and employment status.', params: ['staffId', 'department', 'designation', 'staffStatus', 'isTeacher', 'search'] },
  'staff-attendance': { title: 'Staff attendance', desc: 'Monthly attendance for all teaching and non-teaching staff, including historical staff.', params: ['month', 'staffId', 'department', 'designation', 'staffStatus'] },
  'staff-attendance-detail': { title: 'Staff attendance detail', desc: 'Daily staff marks, with attendance status and date filters.', params: ['dateRange', 'staffId', 'department', 'designation', 'staffStatus', 'attendanceStatus'] },
  'salaries': { title: 'Salary structures', desc: 'Effective salary, allowances and deductions as of a date.', params: ['asOf', 'staffId', 'department', 'designation', 'staffStatus'] },
  'payroll': { title: 'Payroll summary', desc: 'Monthly payroll runs and their preparation, approval and payment status.', params: ['fromPeriod', 'toPeriod', 'payrollStatus', 'accountId'] },
  'payroll-detail': { title: 'Payroll detail', desc: 'Staff payroll snapshots, bonuses, deductions and net pay.', params: ['fromPeriod', 'toPeriod', 'payrollStatus', 'staffId', 'department', 'designation', 'staffStatus'] },
  'advances-loans': { title: 'Advances & loans', desc: 'Issued advances/loans, repayments and current outstanding amounts.', params: ['dateRange', 'staffId', 'department', 'loanKind', 'loanStatus', 'accountId'] },
  'loan-repayments': { title: 'Advance & loan recoveries', desc: 'Recoveries through payroll or cash/bank payments.', params: ['dateRange', 'staffId', 'department', 'loanKind', 'accountId', 'recovery'] },
  'accounts': { title: 'Money accounts', desc: 'Cash, bank and wallet balances as of a date.', params: ['asOf', 'accountId', 'accountType', 'active'] },
  'expenses': { title: 'Expenses', desc: 'Category/account spending, approval status and payees.', params: ['dateRange', 'accountId', 'categoryId', 'approvalStatus', 'search'] },
  'other-income': { title: 'Other income', desc: 'Receipts other than student fees, by category and account.', params: ['dateRange', 'accountId', 'categoryId', 'search'] },
  'account-transactions': { title: 'Account transactions / day book', desc: 'Cash and bank movements, including fees, transfers, journals and recoveries.', params: ['dateRange', 'accountId', 'movementKind'] },
  'library-stock': { title: 'Library stock', desc: 'Book copies, open issues and current availability.', params: ['bookId', 'libraryCategory', 'availability', 'search'] },
  'library-issues': { title: 'Library circulation & fines', desc: 'Issued/returned/overdue books, recorded fines and estimated open-issue fines.', params: ['dateRange', 'bookId', 'libraryCategory', 'issueStatus', 'class', 'optionalSection', 'student'] },
  'transport-routes': { title: 'Transport routes', desc: 'Route capacity, drivers, active riders and expected monthly fees.', params: ['routeId', 'active'] },
  'transport-assignments': { title: 'Transport assignments', desc: 'Students on each route/stop, pickup times and monthly fees.', params: ['routeId', 'class', 'optionalSection', 'student', 'studentStatus', 'dateRange'] },
  'chart-of-accounts': { title: 'Chart of accounts', desc: 'Accounting codes, types, activity and natural balances.', params: ['asOf', 'ledgerType', 'active'] },
  'trial-balance': { title: 'Trial balance', desc: 'Debit and credit balances across the branch’s ledger accounts.', params: ['asOf'] },
  'income-statement': { title: 'Income & expenditure', desc: 'Income, spending and surplus/deficit for a date range.', params: ['dateRange'] },
  'balance-sheet': { title: 'Balance sheet', desc: 'Assets, liabilities, equity and accumulated surplus as of a date.', params: ['asOf'] },
  'journal': { title: 'Journal / postings', desc: 'Automatic and manual accounting postings with debit/credit totals.', params: ['dateRange', 'ledgerAccountId'] },
  'account-ledger': { title: 'Account ledger', desc: 'Opening balance, dated postings and running balance for one accounting account.', params: ['dateRange', 'ledgerAccountId'] },
};

export type FilterValues = { from: string; to: string; month: string; sectionId: string; classId: string; student: { id: string; name: string; admissionNo?: string } | null; minDaysOverdue: string } & Record<ExtraKey,string>;

export function defaultFilters(type: string): FilterValues {
  const today = todayIso();
  // The leave report covers the whole academic year unless dates are picked.
  return { from: ['leave','advances-loans','loan-repayments','library-issues','transport-assignments'].includes(type) ? '' : `${today.slice(0,7)}-01`, to: ['leave','advances-loans','loan-repayments','library-issues','transport-assignments'].includes(type) ? '' : today, month: today.slice(0, 7), sectionId: '', classId: '', student: null, minDaysOverdue: '0', staffId: '', department: '', designation: '', staffStatus: '', isTeacher: '', fromPeriod: '', toPeriod: '', payrollStatus: '', accountId: '', accountType: '', active: '', categoryId: '', approvalStatus: '', loanKind: '', loanStatus: '', recovery: '', movementKind: '', routeId: '', studentStatus: '', bookId: '', libraryCategory: '', issueStatus: '', availability: '', ledgerAccountId: '', ledgerType: '', search: '', attendanceStatus: '', academicYearId: '', leaveType: '', asOf: today };
}

/** Query parameters for the API from the filter values (only what this report accepts and what's filled). */
export function toParams(type: string, p: FilterValues): Record<string, string | undefined> {
  const has = (x: Param) => REPORT_META[type]?.params.includes(x);
  return {
    ...Object.fromEntries(EXTRA_KEYS.filter(k => has(k) && p[k]).map(k => [k,p[k]])),
    ...(has('optionalSection') && p.sectionId ? { sectionId: p.sectionId } : {}),
    ...(has('dateRange') ? { from: p.from || undefined, to: p.to || undefined } : {}),
    ...(has('month') ? { month: p.month } : {}),
    ...(has('section') ? { sectionId: p.sectionId } : {}),
    ...(has('class') && p.classId ? { classId: p.classId } : {}),
    ...(has('student') && p.student ? { studentId: p.student.id } : {}),
    ...(has('overdue') ? { minDaysOverdue: p.minDaysOverdue } : {}),
  };
}

/** Why the report can't run yet, or null. */
export function missingFilter(type: string, p: FilterValues): string | null {
  if (REPORT_META[type]?.params.includes('section') && !p.sectionId) return 'Choose a class section';
  if (REPORT_META[type]?.params.includes('month') && !p.month) return 'Choose a month';
  if (type === 'account-ledger' && !p.ledgerAccountId) return 'Choose an accounting account';
  if (p.from && p.to && p.from > p.to) return 'From must not be after To';
  if (p.fromPeriod && p.toPeriod && p.fromPeriod > p.toPeriod) return 'First month must not be after last month';
  return null;
}


const EXTRA_KEYS: ExtraKey[] = ['staffId', 'department', 'designation', 'staffStatus', 'isTeacher', 'asOf', 'fromPeriod', 'toPeriod', 'payrollStatus', 'accountId', 'accountType', 'active', 'categoryId', 'approvalStatus', 'loanKind', 'loanStatus', 'recovery', 'movementKind', 'routeId', 'studentStatus', 'bookId', 'libraryCategory', 'issueStatus', 'availability', 'ledgerAccountId', 'ledgerType', 'search', 'attendanceStatus', 'academicYearId', 'leaveType'];
export function ReportFilters({ type, value, onChange }: { type: string; value: FilterValues; onChange: (v: FilterValues) => void }) {
  const params = REPORT_META[type]?.params ?? [];
  const classes = useQuery({ queryKey: ['classes'], queryFn: academicsAPI.classes, enabled: params.includes('class') });
  const optionQuery = useQuery({ queryKey: ['report-options',type], queryFn: () => reportsAPI.options(type), enabled: params.some(k=>['staffId','department','designation','accountId','categoryId','routeId','bookId','libraryCategory','ledgerAccountId','academicYearId'].includes(k)) });
  const options = optionQuery.data ?? {};
  const p = value;
  const set = (patch: Partial<FilterValues>) => onChange({ ...p, ...patch });
  if (!params.length) return <p className="text-sm text-gray-500">This report has no filters.</p>;
  return (
    <div className="flex flex-wrap items-end gap-3">
      {optionQuery.error && <p className="w-full text-sm text-red-600" role="alert">Could not load filter options: {apiError(optionQuery.error)}</p>}
      {params.includes('dateRange') && <>
        <Field label="From"><input type="date" className="input" value={p.from} onChange={(e) => set({ from: e.target.value, to: p.to && e.target.value > p.to ? e.target.value : p.to })} /></Field>
        <Field label="To"><input type="date" className="input" min={p.from || undefined} value={p.to} onChange={(e) => set({ to: e.target.value })} /></Field>
      </>}
      {EXTRA_KEYS.filter(k=>params.includes(k)).map(k=><ExtraFilter key={k} name={k} value={p[k]} options={options} onChange={v=>set({[k]:v})} />)}
      {params.includes('optionalSection') && <Field label="Section"><SectionSelect includeAll="All sections" value={p.sectionId} onChange={v=>set({sectionId:v})} /></Field>}
      {params.includes('month') && <Field label="Month"><input type="month" className="input" value={p.month} onChange={(e) => set({ month: e.target.value })} /></Field>}
      {params.includes('section') && <Field label="Class"><SectionSelect value={p.sectionId} onChange={(v) => set({ sectionId: v })} className="w-44" /></Field>}
      {params.includes('class') && (
        <Field label="Class">
          <select className="select w-40" value={p.classId} onChange={(e) => set({ classId: e.target.value })}>
            <option value="">All classes</option>
            {(classes.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      )}
      {params.includes('student') && (
        <Field label="Student" className="w-72 max-w-full">
          <StudentPicker value={p.student} onChange={(st) => set({ student: st ? { id: st.id, name: st.name, admissionNo: st.admissionNo } : null })} placeholder="All students (search to pick one)" />
        </Field>
      )}
      {params.includes('overdue') && (
        <Field label="Overdue by">
          <select className="select w-40" value={p.minDaysOverdue} onChange={(e) => set({ minDaysOverdue: e.target.value })}>
            <option value="0">Any</option><option value="30">30+ days</option><option value="60">60+ days</option><option value="90">90+ days</option>
          </select>
        </Field>
      )}
    </div>
  );
}

const LABELS: Record<ExtraKey,string> = { staffId:'Staff member', department:'Department', designation:'Designation', staffStatus:'Staff status', isTeacher:'Staff kind', asOf:'As of', fromPeriod:'First payroll month', toPeriod:'Last payroll month', payrollStatus:'Payroll status', accountId:'Money account', accountType:'Account type', active:'Active status', categoryId:'Category', approvalStatus:'Approval status', loanKind:'Advance / loan kind', loanStatus:'Loan status', recovery:'Recovery source', movementKind:'Movement kind', routeId:'Transport route', studentStatus:'Student status', bookId:'Book', libraryCategory:'Book category', issueStatus:'Issue status', availability:'Availability', ledgerAccountId:'Accounting account', ledgerType:'Accounting type', search:'Search description / reference', attendanceStatus:'Attendance status', academicYearId:'Academic year', leaveType:'Leave type' };
const VALUES: Partial<Record<ExtraKey,string[]>> = { staffStatus:['ACTIVE','TEMPORARY_LEAVE','INACTIVE','LEFT','TERMINATED'], payrollStatus:['DRAFT','SUBMITTED','APPROVED','PAID'], accountType:['CASH','BANK','WALLET'], approvalStatus:['PENDING','APPROVED','REJECTED'], loanKind:['ADVANCE','LOAN'], loanStatus:['ACTIVE','SETTLED'], recovery:['PAYROLL','CASH'], movementKind:['OPENING','FEE','INCOME','EXPENSE','ADVANCE','LOAN_REPAYMENT','JOURNAL','DEPOSIT','WITHDRAWAL','ADJUSTMENT_IN','ADJUSTMENT_OUT','TRANSFER_IN','TRANSFER_OUT'], studentStatus:['ACTIVE','LEFT','TRANSFERRED','GRADUATED'], issueStatus:['OPEN','OVERDUE','RETURNED','UNPAID_FINE'], availability:['AVAILABLE','UNAVAILABLE'], ledgerType:['ASSET','LIABILITY','EQUITY','INCOME','EXPENSE'], attendanceStatus:['PRESENT','ABSENT','LATE','LEAVE','HALF_DAY'], leaveType:['CASUAL','SICK','ANNUAL','UNPAID','OTHER'] };
const SOURCES: Partial<Record<ExtraKey,string>> = { staffId:'staff', department:'departments', designation:'designations', accountId:'accounts', categoryId:'categories', routeId:'routes', bookId:'books', libraryCategory:'libraryCategories', ledgerAccountId:'ledgerAccounts', academicYearId:'academicYears' };
function ExtraFilter({name,value,options,onChange}:{name:ExtraKey;value:string;options:Record<string,any>;onChange:(v:string)=>void}) {
  const label=LABELS[name];
  if (['asOf','fromPeriod','toPeriod','search'].includes(name)) return <Field label={label}><input className="input w-44" type={name==='asOf'?'date':name==='search'?'search':'month'} value={value} maxLength={name==='search'?100:undefined} onChange={e=>onChange(e.target.value)} /></Field>;
  const items = SOURCES[name] ? (options[SOURCES[name]!] ?? []).map((o:any)=>typeof o==='string'?{value:o,label:o}:{value:o.id,label:o.employeeNo?`${o.name} (${o.employeeNo})`:o.name??o.title}) : name==='active'?[{value:'true',label:'Active'},{value:'false',label:'Inactive'}]:name==='isTeacher'?[{value:'true',label:'Teachers'},{value:'false',label:'Non-teaching staff'}]:(VALUES[name]??[]).map(v=>({value:v,label:v.replaceAll('_',' ').toLowerCase()}));
  return <Field label={label}><select className="select w-44" value={value} onChange={e=>onChange(e.target.value)}><option value="">All / any</option>{items.map((o:{value:string;label:string})=><option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>;
}
