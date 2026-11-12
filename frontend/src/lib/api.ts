import axios, { type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore, type LicenceStatus } from '@/store/authStore';
import { activity } from '@/lib/activity';

declare module 'axios' {
  interface AxiosRequestConfig {
    /** Don't show the loader for this request. */
    silent?: boolean;
  }
}

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

// A request that hangs (lost Wi-Fi, server overloaded) fails after 30 s instead of spinning forever.
export const api = axios.create({ baseURL: BASE_URL, withCredentials: true, timeout: 30_000 });

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Loading indicator: count saves (non-GET requests) until they settle. Data loading is
// tracked by React Query in the loader. Registered before the token-refresh handler so a
// retried request is counted again on its own.
type Tracked = InternalAxiosRequestConfig & { _tracked?: boolean };
api.interceptors.request.use((config: Tracked) => {
  if (!config.silent && (config.method ?? 'get').toLowerCase() !== 'get' && typeof window !== 'undefined') {
    config._tracked = true;
    activity.writeStarted();
  }
  return config;
});
const settle = (config?: Tracked) => {
  if (config?._tracked) { activity.writeDone(); delete config._tracked; }
};
api.interceptors.response.use(
  (res) => { settle(res.config); return res; },
  (error) => { settle(error.config); return Promise.reject(error); },
);

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 403 && error.response.data?.code === 'PASSWORD_CHANGE_REQUIRED' && typeof window !== 'undefined' && location.pathname !== '/change-password') {
      window.location.href = '/change-password';
      return Promise.reject(error);
    }
    // The school's subscription has run out: everything but the subscription page is closed.
    if (error.response?.status === 402 && error.response.data?.code === 'LICENCE_LOCKED' && typeof window !== 'undefined') {
      const user = useAuthStore.getState().user;
      if (user) useAuthStore.setState({ user: { ...user, licence: error.response.data.licence } });
      if (location.pathname !== '/licence') window.location.href = '/licence';
      return Promise.reject(error);
    }
    const original = error.config;
    if (error.response?.status === 401 && !original._retry && !original.url?.includes('/auth/login')) {
      original._retry = true;
      const refreshToken = useAuthStore.getState().refreshToken;
      if (!refreshToken) {
        useAuthStore.getState().clearAuth();
        window.location.href = '/login';
        return Promise.reject(error);
      }
      try {
        const res = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken });
        const { accessToken } = res.data.data;
        useAuthStore.setState({ accessToken });
        original.headers.Authorization = `Bearer ${accessToken}`;
        return api(original);
      } catch {
        useAuthStore.getState().clearAuth();
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

/** Unwraps `{ success, data }` responses. */
const data = <T = any>(p: Promise<{ data: { data: T } }>) => p.then((r) => r.data.data);
/** Keeps pagination/totals for list endpoints. */
const page = <T = any>(p: Promise<{ data: { data: T[]; pagination?: any; totals?: any } }>) => p.then((r) => r.data);

export function apiError(err: any, fallback = 'Something went wrong') {
  if (err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT') return 'The server took too long to answer. Please try again.';
  if (err && !err.response && err.isAxiosError) return 'Cannot reach the server. Check your internet connection.';
  if (err?.response?.status === 429) return err.response.data?.message || 'Too many requests. Please wait a moment.';
  const d = err?.response?.data;
  if (d?.errors?.length) return `${d.message}: ${d.errors.map((e: any) => `${e.field.replace(/^body\./, '')} ${e.message}`).join(', ')}`;
  return d?.message || fallback;
}

export const authAPI = {
  login: (body: { email: string; password: string; mfaCode?: string }) => data(api.post('/auth/login', body)),
  logout: () => api.post('/auth/logout'),
  me: () => data(api.get('/auth/me')),
  /** Returns fresh tokens (the old ones may require a password change). */
  changePassword: (body: { currentPassword: string; newPassword: string }) => data<{ user: any; accessToken: string; refreshToken: string }>(api.post('/auth/change-password', body)),
  usernameCheck: (username: string) => data<UsernameCheck>(api.get('/auth/username-check', { params: { username } })),
  updateProfile: (body: { name: string; phone?: string | null; email?: string | null; username?: string | null; currentPassword?: string }) => data(api.patch('/auth/profile', body)),
  forgotPassword: (email: string) => api.post('/auth/forgot-password', { email }),
  resetPassword: (token: string, newPassword: string) => api.post('/auth/reset-password', { token, newPassword }),
  mfaSetup: () => data<{ secret: string; qrCodeUrl: string }>(api.post('/auth/mfa/enable')),
  mfaVerify: (code: string) => api.post('/auth/mfa/verify', { code }),
  mfaDisable: (password: string) => api.post('/auth/mfa/disable', { password }),
};

export const schoolAPI = {
  get: () => data(api.get('/school')),
  update: (body: any) => data(api.patch('/school', body)),
  years: () => data<any[]>(api.get('/school/academic-years')),
  createYear: (body: any) => data(api.post('/school/academic-years', body)),
  makeCurrent: (id: string) => data(api.post(`/school/academic-years/${id}/make-current`)),
};

export type UsernameCheck = { username: string; valid: boolean; available: boolean; message: string; suggestions: string[] };

export const usersAPI = {
  /** Is a username free for a new login, and what's close if not? */
  usernameCheck: (username: string, name?: string) => data<UsernameCheck>(api.get('/users/username-check', { params: { username, name } })),
  list: (params?: any) => page(api.get('/users', { params })),
  create: (body: any) => data(api.post('/users', body)),
  update: (id: string, body: any) => data(api.patch(`/users/${id}`, body)),
  resetPassword: (id: string) => data<{ temporaryPassword: string }>(api.post(`/users/${id}/reset-password`)),
};

export const academicsAPI = {
  classes: () => data<any[]>(api.get('/academics/classes')),
  createClass: (body: any) => data(api.post('/academics/classes', body)),
  updateClass: (id: string, body: any) => data(api.patch(`/academics/classes/${id}`, body)),
  archivedClasses: () => data<any[]>(api.get('/academics/classes', { params: { archived: 'true' } })),
  archiveClass: (id: string) => data(api.post(`/academics/classes/${id}/archive`)),
  restoreClass: (id: string) => data(api.post(`/academics/classes/${id}/restore`)),
  addSection: (classId: string, body: any) => data(api.post(`/academics/classes/${classId}/sections`, body)),
  updateSection: (id: string, body: any) => data(api.patch(`/academics/sections/${id}`, body)),
  deleteSection: (id: string) => api.delete(`/academics/sections/${id}`),
  subjects: () => data<any[]>(api.get('/academics/subjects')),
  createSubject: (body: any) => data(api.post('/academics/subjects', body)),
  sectionSubjects: (sectionId: string) => data<any[]>(api.get(`/academics/sections/${sectionId}/subjects`)),
  setSectionSubjects: (sectionId: string, assignments: { subjectId: string; teacherId: string }[]) =>
    api.put(`/academics/sections/${sectionId}/subjects`, { assignments }),
};

export const staffAPI = {
  list: (params?: any) => page(api.get('/staff', { params })),
  get: (id: string) => data(api.get(`/staff/${id}`)),
  create: (body: any) => data(api.post('/staff', body)),
  update: (id: string, body: any) => data(api.patch(`/staff/${id}`, body)),
  createLogin: (id: string, body: any) => data(api.post(`/staff/${id}/login`, body)),
  uploadDocument: (id: string, title: string, file: File) => {
    const fd = new FormData();
    fd.append('title', title);
    fd.append('file', file);
    return data(api.post(`/staff/${id}/documents`, fd));
  },
  deleteDocument: (id: string, docId: string) => api.delete(`/staff/${id}/documents/${docId}`),
};

export type LeaveBalance = { type: string; allowed: number; isPaid: boolean; used: number; pending: number; remaining: number; unpaid: number };
export type SalaryView = {
  id: string; effectiveFrom: string; basic: string; note: string | null;
  components: { id: string; kind: 'ALLOWANCE' | 'DEDUCTION'; name: string; amount: string }[];
  allowances: string; deductions: string; gross: string; net: string;
};

/** HR: lists, leave policy and balances, salary structures. */
export const hrAPI = {
  options: () => data<{ departments: { id: string; name: string; staff: number }[]; designations: { id: string; name: string; staff: number }[] }>(api.get('/hr/options')),
  addOption: (list: 'departments' | 'designations', name: string) => data(api.post(`/hr/${list}`, { name })),
  renameOption: (list: 'departments' | 'designations', id: string, name: string) => data(api.patch(`/hr/${list}/${id}`, { name })),
  deleteOption: (list: 'departments' | 'designations', id: string) => api.delete(`/hr/${list}/${id}`),
  leavePolicy: () => data<{ type: string; daysPerYear: number; isPaid: boolean }[]>(api.get('/hr/leave-policy')),
  saveLeavePolicy: (items: { type: string; daysPerYear: number; isPaid: boolean }[]) => data(api.put('/hr/leave-policy', { items })),
  leaveBalances: () => data<{ year: string; staff: { id: string; name: string; employeeNo: string; designation: string | null; balances: LeaveBalance[] }[] }>(api.get('/hr/leave-balances')),
  salaries: () => data<any>(api.get('/hr/salaries')),
  salary: (staffId: string) => data<{ current: SalaryView | null; history: SalaryView[] }>(api.get(`/hr/staff/${staffId}/salary`)),
  setSalary: (staffId: string, body: any) => data<{ current: SalaryView | null; history: SalaryView[] }>(api.post(`/hr/staff/${staffId}/salary`, body)),
  deleteSalary: (structureId: string) => api.delete(`/hr/salary/${structureId}`),
  me: () => data<any>(api.get('/hr/me')),
};

export type MoneyAccount = {
  id: string; name: string; type: 'CASH' | 'BANK' | 'WALLET'; accountNo: string | null; methods: string[];
  openingBalance: string; openingDate: string; notes: string | null; isActive: boolean; balance: string;
};
export type FinanceCategory = { id: string; kind: 'EXPENSE' | 'INCOME'; name: string; isActive: boolean };
export type MoneyMovement = {
  id: string; kind: string; date: string; accountId: string; account: string; description: string; reference: string | null;
  in: string; out: string; balance: string; link?: string; removable?: boolean;
};
export type FinanceStatement = { from: string; to: string; opening: string; closing: string; totalIn: string; totalOut: string; rows: MoneyMovement[] };

/** Finance: money accounts, movements, expenses and other income. */
export const financeAPI = {
  summary: (month?: string) => data<any>(api.get('/finance/summary', { params: { month } })),
  accounts: () => data<MoneyAccount[]>(api.get('/finance/accounts')),
  addAccount: (body: any) => data(api.post('/finance/accounts', body)),
  updateAccount: (id: string, body: any) => data(api.patch(`/finance/accounts/${id}`, body)),
  addTransaction: (accountId: string, body: any) => data(api.post(`/finance/accounts/${accountId}/transactions`, body)),
  transfer: (body: any) => data(api.post('/finance/transfers', body)),
  deleteTransaction: (id: string) => api.delete(`/finance/transactions/${id}`),
  statement: (params: { accountId?: string; from?: string; to?: string }) => data<FinanceStatement>(api.get('/finance/transactions', { params })),
  categories: (kind?: 'EXPENSE' | 'INCOME') => data<FinanceCategory[]>(api.get('/finance/categories', { params: { kind } })),
  addCategory: (kind: 'EXPENSE' | 'INCOME', name: string) => data(api.post('/finance/categories', { kind, name })),
  updateCategory: (id: string, body: { name?: string; isActive?: boolean }) => data(api.patch(`/finance/categories/${id}`, body)),
  settings: () => data<{ expenseApprovalLimit: string | null; canApprove: boolean }>(api.get('/finance/settings')),
  saveSettings: (expenseApprovalLimit: number | null) => api.put('/finance/settings', { expenseApprovalLimit }),
  expenses: (params?: any) => page(api.get('/finance/expenses', { params })),
  addExpense: (body: Record<string, string | number | undefined>, file?: File | null) => {
    const fd = new FormData();
    Object.entries(body).forEach(([k, v]) => { if (v !== undefined && v !== '') fd.append(k, String(v)); });
    if (file) fd.append('file', file);
    return api.post('/finance/expenses', fd);
  },
  decideExpense: (id: string, approve: boolean, note?: string) => api.post(`/finance/expenses/${id}/decision`, { approve, note }),
  deleteExpense: (id: string) => api.delete(`/finance/expenses/${id}`),
  income: (params?: any) => page(api.get('/finance/income', { params })),
  addIncome: (body: any) => api.post('/finance/income', body),
  deleteIncome: (id: string) => api.delete(`/finance/income/${id}`),
};

export type PayrollStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'PAID';
export type PayPart = { name: string; amount: number };
export type PayrollLine = {
  id: string; staffId: string; name: string; employeeNo: string; designation: string | null; department: string | null;
  bankName: string | null; bankAccountTitle: string | null; bankAccountNo: string | null;
  basic: string; allowances: PayPart[]; fixedDeductions: PayPart[]; gross: string; daysInMonth: number;
  absentDays: string; unpaidLeaveDays: string; notEmployedDays: string; deductDays: string; deductDaysManual: boolean;
  absenceDeduction: string; loanDeduction: string; loanManual: boolean; bonus: string; otherDeduction: string;
  remarks: string | null; totalDeductions: string; net: string;
};
export type PayrollRun = {
  id: string; period: string; label: string; status: PayrollStatus; decisionNote: string | null; paymentDate: string | null;
  account: string | null; createdBy: string | null; decidedBy: string | null; paidBy: string | null;
  totals: { staff: number; gross: string; bonus: string; deductions: string; absence: string; loans: string; net: string };
  lines: PayrollLine[]; missing: { id: string; name: string; employeeNo: string }[];
};

/** Payroll: monthly runs, payslips, advances and loans. */
export const payrollAPI = {
  runs: () => data<any[]>(api.get('/payroll/runs')),
  prepare: (period: string) => api.post('/payroll/runs', { period }),
  run: (id: string) => data<PayrollRun>(api.get(`/payroll/runs/${id}`)),
  recalculate: (id: string, reset = false) => api.post(`/payroll/runs/${id}/recalculate`, { reset }),
  updateLine: (id: string, body: any) => api.patch(`/payroll/lines/${id}`, body),
  submit: (id: string) => api.post(`/payroll/runs/${id}/submit`),
  decide: (id: string, approve: boolean, note?: string) => api.post(`/payroll/runs/${id}/decision`, { approve, note }),
  reopen: (id: string) => api.post(`/payroll/runs/${id}/reopen`),
  pay: (id: string, body: { accountId: string; paymentDate: string }) => api.post(`/payroll/runs/${id}/pay`, body),
  remove: (id: string) => api.delete(`/payroll/runs/${id}`),
  bankSheet: async (id: string, format: 'xlsx' | 'pdf') => {
    const res = await api.get(`/payroll/runs/${id}/bank-sheet`, { params: { format }, responseType: 'blob' });
    const name = /filename="([^"]+)"/.exec(res.headers['content-disposition'] ?? '')?.[1] ?? `salary-transfer.${format}`;
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
  payslip: (lineId: string) => data<any>(api.get(`/payroll/lines/${lineId}/payslip`)),
  my: () => data<any>(api.get('/payroll/my')),
  loans: (params?: { status?: string; staffId?: string }) => data<{ loans: any[]; totals: { outstanding: string; active: number } }>(api.get('/payroll/loans', { params })),
  addLoan: (body: any) => api.post('/payroll/loans', body),
  repayLoan: (id: string, body: any) => api.post(`/payroll/loans/${id}/repayments`, body),
  deleteLoan: (id: string) => api.delete(`/payroll/loans/${id}`),
};

export type LedgerAccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
export type LedgerAccountRow = { id: string; code: string; name: string; type: LedgerAccountType; isActive: boolean; link: 'MONEY' | 'CATEGORY' | 'SYSTEM' | null; systemKey: string | null; balance: string; journalLines: number };
export type StatementRow = { id: string; code: string; name: string; type: LedgerAccountType; amount: string };
export type JournalEntryView = { id: string; kind: string; date: string; reference: string | null; description: string; manual?: boolean; lines: { accountId: string; code: string; name: string; debit: string; credit: string }[] };

/** Accounting: chart of accounts, journal, statements, month closing. */
export const ledgerAPI = {
  accounts: () => data<LedgerAccountRow[]>(api.get('/ledger/accounts')),
  addAccount: (body: { name: string; type: string; code?: string }) => api.post('/ledger/accounts', body),
  updateAccount: (id: string, body: { name?: string; code?: string; isActive?: boolean }) => api.patch(`/ledger/accounts/${id}`, body),
  deleteAccount: (id: string) => api.delete(`/ledger/accounts/${id}`),
  journal: (params: { from?: string; to?: string }) => data<{ from: string; to: string; total: string; entries: JournalEntryView[] }>(api.get('/ledger/journal', { params })),
  accountLedger: (id: string, params: { from?: string; to?: string }) => data<any>(api.get(`/ledger/accounts/${id}/ledger`, { params })),
  trialBalance: (asOf?: string) => data<{ asOf: string; rows: (StatementRow & { debit: string; credit: string })[]; debit: string; credit: string; balanced: boolean }>(api.get('/ledger/trial-balance', { params: { asOf } })),
  incomeStatement: (params: { from?: string; to?: string }) => data<{ from: string; to: string; income: { rows: StatementRow[]; total: string }; expenses: { rows: StatementRow[]; total: string }; surplus: string }>(api.get('/ledger/income-statement', { params })),
  balanceSheet: (asOf?: string) => data<{ asOf: string; assets: { rows: StatementRow[]; total: string }; liabilities: { rows: StatementRow[]; total: string }; equity: { rows: StatementRow[]; surplus: string; total: string }; liabilitiesAndEquity: string; balanced: boolean }>(api.get('/ledger/balance-sheet', { params: { asOf } })),
  addJournal: (body: any) => api.post('/ledger/journals', body),
  deleteJournal: (id: string) => api.delete(`/ledger/journals/${id}`),
  closing: () => data<{ closedThrough: string | null; closedLabel: string | null; canCloseThrough: string | null; canClose: boolean; canReopen: boolean }>(api.get('/ledger/closing')),
  close: (period: string) => api.post('/ledger/close', { period }),
  reopen: (period: string) => api.post('/ledger/reopen', { period }),
};

export type RoleMatrix = {
  roles: { role: string; label: string; about: string; users: number; changed: number; editable: boolean;
    permissions: { key: string; module: string; label: string; standard: boolean; granted: boolean; available: boolean }[];
    /** Logins this role may create. */
    creates: { role: string; label: string; standard: boolean; allowed: boolean; available: boolean }[] }[];
};
/** Roles & permissions (owner): what each staff role may do in this school. */
export const rolesAPI = {
  matrix: () => data<RoleMatrix>(api.get('/roles')),
  save: (role: string, permissions: string[], creates: string[]) => api.put(`/roles/${role}`, { permissions, creates }),
  reset: (role: string) => api.post(`/roles/${role}/reset`),
};

/** A student's (or a parent's children's) own record. The server limits every call to their own data. */
export const familyAPI = {
  children: () => data<any[]>(api.get('/family/children')),
  home: (studentId: string) => data<any>(api.get('/family/home', { params: { studentId } })),
  today: () => data<any>(api.get('/timetable/today')),
  calendar: (studentId: string, month: string) => data<any>(api.get(`/attendance/students/${studentId}/calendar`, { params: { month } })),
  diary: (studentId: string) => api.get('/diary', { params: { studentId, limit: 50 } }).then((r) => r.data.data as any[]),
  exams: (studentId: string) => data<any[]>(api.get('/family/exams', { params: { studentId } })),
  reportCard: (examId: string, studentId: string) => data<{ url: string }>(api.get(`/exams/${examId}/report-card/${studentId}/pdf-link`)),
  timetable: (sectionId: string) => data<any[]>(api.get(`/timetable/section/${sectionId}`)),
  fees: (studentId: string) => data<any>(api.get(`/fees/students/${studentId}`)),
  library: (studentId: string) => data<any>(api.get(`/library/students/${studentId}`)),
  transport: (studentId: string) => data<any>(api.get(`/transport/students/${studentId}`)),
};

export const studentsAPI = {
  list: (params?: any) => page(api.get('/students', { params })),
  get: (id: string) => data(api.get(`/students/${id}`)),
  admit: (body: any) => data(api.post('/students', body)),
  update: (id: string, body: any) => data(api.patch(`/students/${id}`, body)),
  /** CR-04: the student's own monthly fee (null = follow the class fee structure). */
  setMonthlyFee: (id: string, monthlyFee: number | null) => data(api.put(`/students/${id}/monthly-fee`, { monthlyFee })),
  setStatus: (id: string, body: any) => data(api.post(`/students/${id}/status`, body)),
  searchGuardians: (q: string) => data<any[]>(api.get('/students/guardians/search', { params: { q } })),
  linkGuardian: (id: string, body: any) => data(api.post(`/students/${id}/guardians`, body)),
  unlinkGuardian: (id: string, guardianId: string) => api.delete(`/students/${id}/guardians/${guardianId}`),
  /** A parent login for a guardian, or the student's own login: username and/or email, optional password. */
  guardianLogin: (guardianId: string, body: { username?: string; email?: string; password?: string }) => data(api.post(`/students/guardians/${guardianId}/login`, body)),
  studentLogin: (id: string, body: { username?: string; email?: string; password?: string }) => data(api.post(`/students/${id}/login`, body)),
  addDocumentLink: (id: string, body: { title: string; url: string }) => data(api.post(`/students/${id}/documents`, body)),
  uploadDocument: (id: string, title: string, file: File) => {
    const fd = new FormData();
    fd.append('title', title);
    fd.append('file', file);
    return data(api.post(`/students/${id}/documents`, fd));
  },
  deleteDocument: (id: string, docId: string) => api.delete(`/students/${id}/documents/${docId}`),
  uploadPhoto: (id: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return data<{ photo: string }>(api.put(`/students/${id}/photo`, fd));
  },
  deletePhoto: (id: string) => api.delete(`/students/${id}/photo`),
};

export const attendanceAPI = {
  roster: (sectionId: string, date?: string) => data(api.get('/attendance/students', { params: { sectionId, date } })),
  mark: (body: any) => data(api.put('/attendance/students', body)),
  calendar: (studentId: string, month?: string) => data(api.get(`/attendance/students/${studentId}/calendar`, { params: { month } })),
  summary: (date?: string) => data(api.get('/attendance/summary', { params: { date } })),
  staff: (date?: string) => data(api.get('/attendance/staff', { params: { date } })),
  lowAttendanceAlerts: () => data(api.post('/attendance/low-attendance-alerts')),
  markStaff: (body: any) => data(api.put('/attendance/staff', body)),
};

export const feesAPI = {
  heads: () => data<any[]>(api.get('/fees/heads')),
  createHead: (body: any) => data(api.post('/fees/heads', body)),
  updateHead: (id: string, body: any) => data(api.patch(`/fees/heads/${id}`, body)),
  structure: () => data(api.get('/fees/structure')),
  saveStructure: (classId: string, items: { feeHeadId: string; amount: number }[]) => api.put(`/fees/structure/${classId}`, { items }),
  generate: (body: any) => data(api.post('/fees/invoices/generate', body)),
  invoices: (params?: any) => page(api.get('/fees/invoices', { params })),
  cancelInvoice: (id: string) => api.post(`/fees/invoices/${id}/cancel`),
  ledger: (studentId: string) => data(api.get(`/fees/students/${studentId}`)),
  collect: (body: any) => data(api.post('/fees/payments', body)),
  payments: (params?: any) => page(api.get('/fees/payments', { params })),
  receipt: (paymentId: string) => data(api.get(`/fees/payments/${paymentId}/receipt`)),
  defaulters: (params?: any) => data(api.get('/fees/defaulters', { params })),
  concessions: (params?: any) => data<any[]>(api.get('/fees/concessions', { params })),
  requestConcession: (body: any) => data(api.post('/fees/concessions', body)),
  decideConcession: (id: string, approve: boolean) => api.post(`/fees/concessions/${id}/decision`, { approve }),
  sendReminders: (body: { daysAhead?: number; classId?: string }) => data(api.post('/fees/reminders', body)),
  applyFines: () => data(api.post('/fees/fines/apply')),
  waiveFine: (invoiceId: string) => api.post(`/fees/invoices/${invoiceId}/waive-fine`),
};

export const diaryAPI = {
  list: (params?: any) => page(api.get('/diary', { params })),
  post: (form: FormData) => data(api.post('/diary', form)),
  remove: (id: string) => api.delete(`/diary/${id}`),
  completion: (id: string) => data(api.get(`/diary/${id}/completion`)),
};

export const noticesAPI = {
  list: (params?: any) => api.get('/notices', { params }).then((r) => r.data),
  create: (form: FormData) => data(api.post('/notices', form)),
  publish: (id: string) => data(api.post(`/notices/${id}/publish`)),
  read: (id: string) => api.post(`/notices/${id}/read`),
  remove: (id: string) => api.delete(`/notices/${id}`),
};

export const calendarAPI = {
  list: (params?: any) => data<any[]>(api.get('/calendar', { params })),
  create: (body: any) => data(api.post('/calendar', body)),
  remove: (id: string) => api.delete(`/calendar/${id}`),
};

export const examsAPI = {
  list: () => data<any[]>(api.get('/exams')),
  get: (id: string) => data(api.get(`/exams/${id}`)),
  create: (body: any) => data(api.post('/exams', body)),
  update: (id: string, body: any) => data(api.patch(`/exams/${id}`, body)),
  remove: (id: string) => api.delete(`/exams/${id}`),
  saveDateSheet: (id: string, classId: string, subjects: any[]) => api.put(`/exams/${id}/classes/${classId}/subjects`, { subjects }),
  approve: (id: string) => data(api.post(`/exams/${id}/approve`)),
  publish: (id: string) => data(api.post(`/exams/${id}/publish`)),
  unpublish: (id: string) => data(api.post(`/exams/${id}/unpublish`)),
  assignments: () => data<any[]>(api.get('/exams/marks/assignments')),
  marks: (id: string, sectionId: string, subjectId: string) => data(api.get(`/exams/${id}/marks`, { params: { sectionId, subjectId } })),
  saveMarks: (id: string, body: any) => data(api.put(`/exams/${id}/marks`, body)),
  results: (id: string, sectionId: string) => data(api.get(`/exams/${id}/results`, { params: { sectionId } })),
  analysis: (id: string, classId: string) => data(api.get(`/exams/${id}/analysis`, { params: { classId } })),
  saveRemarks: (id: string, sectionId: string, remarks: { studentId: string; remarks: string }[]) => api.put(`/exams/${id}/remarks`, { sectionId, remarks }),
  pdfLink: (id: string, studentId: string) => data<{ url: string }>(api.get(`/exams/${id}/report-card/${studentId}/pdf-link`)),
  gradeScale: () => data<any[]>(api.get('/exams/grade-scale')),
  saveGradeScale: (grades: any[]) => api.put('/exams/grade-scale', { grades }),
};

export const timetableAPI = {
  section: (sectionId: string) => data<any[]>(api.get(`/timetable/section/${sectionId}`)),
  teacher: (staffId = 'me') => data<any[]>(api.get(`/timetable/teacher/${staffId}`)),
  save: (sectionId: string, slots: any[]) => data(api.put(`/timetable/section/${sectionId}`, { slots })),
  busy: (excludeSectionId: string) => data<{ teacherId: string; dayOfWeek: string; startTime: string; endTime: string; section: string }[]>(api.get('/timetable/busy', { params: { excludeSectionId } })),
};

export const leaveAPI = {
  mine: () => data(api.get('/leave/mine')),
  list: (params?: any) => data<any[]>(api.get('/leave', { params })),
  apply: (body: any) => data(api.post('/leave', body)),
  decide: (id: string, approve: boolean, note?: string) => api.post(`/leave/${id}/decision`, { approve, note }),
  cancel: (id: string) => api.post(`/leave/${id}/cancel`),
};

export const approvalsAPI = { inbox: () => data(api.get('/approvals')) };

export const paymentsAPI = {
  options: () => data(api.get('/payments/options')),
  addAccount: (body: any) => data(api.post('/payments/accounts', body)),
  removeAccount: (id: string) => api.delete(`/payments/accounts/${id}`),
  claims: (params?: any) => data<any[]>(api.get('/payments/claims', { params })),
  decideClaim: (id: string, approve: boolean, note?: string) => data(api.post(`/payments/claims/${id}/decision`, { approve, note })),
};

export const reportsAPI = {
  available: () => data<string[]>(api.get('/reports')),
  /** Downloads a report file and hands it to the browser. */
  download: async (type: string, params: Record<string, string | undefined>) => {
    const res = await api.get(`/reports/${type}`, { params, responseType: 'blob' });
    const name = /filename="([^"]+)"/.exec(res.headers['content-disposition'] ?? '')?.[1] ?? `${type}.${params.format ?? 'pdf'}`;
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
  /** CR-02: the report's table as data, shown on screen (never a download). */
  view: (type: string, params: Record<string, string | undefined>) => data<ReportView>(api.get(`/reports/${type}`, { params: { ...params, format: 'view' } })),
};

export type ReportColumn = { key: string; label: string; type?: 'text' | 'money' | 'number' | 'percent'; width?: number };
export type ReportView = {
  title: string; subtitle?: string; school: string; currency: string;
  columns: ReportColumn[]; rows: Record<string, string | number | null>[];
  totals?: Record<string, string | number | null>; notes?: string[];
};

/** The school's own subscription: status for everyone, payments and usage for those who run the school. */
export const licenceAPI = {
  get: () => data<{ status: LicenceStatus; activeStudents?: number; payments?: { id: string; amount: string; currency: string; paidOn: string; coversUntil: string; method: string | null; reference: string | null; note: string | null }[] }>(api.get('/licence')),
};

export const platformAPI = {
  schools: () => data<any[]>(api.get('/platform/schools')),
  licence: (id: string) => data<any>(api.get(`/platform/schools/${id}/licence`)),
  saveLicence: (id: string, body: any) => api.patch(`/platform/schools/${id}/licence`, body),
  addPayment: (id: string, body: any) => api.post(`/platform/schools/${id}/licence/payments`, body),
  deletePayment: (id: string, paymentId: string) => api.delete(`/platform/schools/${id}/licence/payments/${paymentId}`),
  create: (body: any) => data(api.post('/platform/schools', body)),
  setActive: (id: string, isActive: boolean) => data(api.patch(`/platform/schools/${id}/status`, { isActive })),
};

export const promotionsAPI = {
  preview: (toAcademicYearId: string, examId?: string) => data(api.get('/promotions/preview', { params: { toAcademicYearId, examId } })),
  run: (body: any) => data(api.post('/promotions/run', body)),
};

export const transportAPI = {
  routes: () => data<any[]>(api.get('/transport/routes')),
  createRoute: (body: any) => data(api.post('/transport/routes', body)),
  updateRoute: (id: string, body: any) => data(api.patch(`/transport/routes/${id}`, body)),
  deleteRoute: (id: string) => api.delete(`/transport/routes/${id}`),
  saveStops: (id: string, stops: any[]) => api.put(`/transport/routes/${id}/stops`, { stops }),
  riders: (id: string) => data<any[]>(api.get(`/transport/routes/${id}/students`)),
  student: (studentId: string) => data(api.get(`/transport/students/${studentId}`)),
  assign: (studentId: string, routeId: string, stopId?: string | null) => data(api.put(`/transport/students/${studentId}`, { routeId, stopId })),
  unassign: (studentId: string) => api.delete(`/transport/students/${studentId}`),
};

export const libraryAPI = {
  books: (params?: any) => page(api.get('/library/books', { params })),
  addBook: (body: any) => data(api.post('/library/books', body)),
  updateBook: (id: string, body: any) => data(api.patch(`/library/books/${id}`, body)),
  issues: (params?: any) => page(api.get('/library/issues', { params })),
  issue: (body: any) => data(api.post('/library/issues', body)),
  returnBook: (id: string) => data(api.post(`/library/issues/${id}/return`)),
  fine: (id: string, action: 'paid' | 'waive') => api.post(`/library/issues/${id}/fine`, { action }),
  student: (studentId: string) => data(api.get(`/library/students/${studentId}`)),
};

export const messagingAPI = {
  get: () => data(api.get('/messaging')),
  save: (body: any) => api.put('/messaging', body),
  test: (phone: string) => data(api.post('/messaging/test', { phone })),
};

export const dashboardAPI = {
  overview: () => data(api.get('/dashboard/overview')),
  /** CR-01: what's behind a dashboard card. */
  details: (kind: 'fees-today' | 'outstanding' | 'staff-present' | 'students-present' | 'alerts') => data<any>(api.get(`/dashboard/details/${kind}`)),
};

export const notificationsAPI = {
  list: () => api.get('/notifications'),
  broadcast: (body: any) => api.post('/notifications/broadcast', body),
  markRead: (id: string) => api.put(`/notifications/${id}/read`),
  markAllRead: () => api.put('/notifications/read-all'),
};
