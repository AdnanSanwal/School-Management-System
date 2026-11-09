import axios, { type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/store/authStore';
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
  guardianLogin: (guardianId: string, email: string) => data(api.post(`/students/guardians/${guardianId}/login`, { email })),
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

export const platformAPI = {
  schools: () => data<any[]>(api.get('/platform/schools')),
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
