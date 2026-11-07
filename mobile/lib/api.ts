import axios, { type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../store/authStore';
import { activity } from './activity';

declare module 'axios' {
  interface AxiosRequestConfig {
    /** Don't show the loader for this request. */
    silent?: boolean;
  }
}

// Android emulator: use http://10.0.2.2:5000/api/v1. Real phone: your computer's LAN IP.
export const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

export const api = axios.create({ baseURL: BASE_URL, timeout: 20_000 });

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
  if (!config.silent && (config.method ?? 'get').toLowerCase() !== 'get') {
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
    const original = error.config;
    if (error.response?.status === 401 && !original._retry && !original.url?.includes('/auth/login')) {
      original._retry = true;
      const refreshToken = useAuthStore.getState().refreshToken;
      if (!refreshToken) {
        useAuthStore.getState().clearAuth();
        return Promise.reject(error);
      }
      try {
        const res = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken });
        useAuthStore.setState({ accessToken: res.data.data.accessToken });
        original.headers.Authorization = `Bearer ${res.data.data.accessToken}`;
        return api(original);
      } catch {
        useAuthStore.getState().clearAuth();
      }
    }
    return Promise.reject(error);
  },
);

export function apiError(err: any, fallback = 'Something went wrong') {
  const d = err?.response?.data;
  if (!err?.response) return 'Cannot reach the school server. Check your internet connection.';
  if (d?.errors?.length) return d.errors.map((e: any) => `${e.field.replace(/^body\./, '')}: ${e.message}`).join('\n');
  return d?.message || fallback;
}

const data = <T = any>(p: Promise<{ data: { data: T } }>) => p.then((r) => r.data.data);

export const API = {
  login: (email: string, password: string) => data(api.post('/auth/login', { email, password })),
  logout: () => api.post('/auth/logout').catch(() => {}),
  changePassword: (currentPassword: string, newPassword: string) => api.post('/auth/change-password', { currentPassword, newPassword }),

  registerDevice: (token: string, platform: string) => api.post('/push/devices', { token, platform }),
  unregisterDevice: (token: string) => api.delete('/push/devices', { data: { token } }),

  // Family (parent / student)
  children: () => data<any[]>(api.get('/family/children')),
  home: (studentId: string) => data(api.get('/family/home', { params: { studentId } })),
  calendar: (studentId: string, month: string) => data(api.get(`/attendance/students/${studentId}/calendar`, { params: { month } })),
  feeLedger: (studentId: string) => data(api.get(`/fees/students/${studentId}`)),
  receipt: (paymentId: string) => data(api.get(`/fees/payments/${paymentId}/receipt`)),

  // Diary
  diary: (params: Record<string, any>) => api.get('/diary', { params }).then((r) => r.data),
  postDiary: (form: FormData) => data(api.post('/diary', form, { headers: { 'Content-Type': 'multipart/form-data' } })),
  deleteDiary: (id: string) => api.delete(`/diary/${id}`),
  markHomework: (id: string, studentId: string, done: boolean) =>
    done ? api.post(`/diary/${id}/done`, { studentId }) : api.delete(`/diary/${id}/done`, { params: { studentId } }),
  homeworkCompletion: (id: string) => data(api.get(`/diary/${id}/completion`)),
  transport: (studentId: string) => data(api.get(`/transport/students/${studentId}`)),
  library: (studentId: string) => data(api.get(`/library/students/${studentId}`)),

  // Notices & notifications
  notices: (page = 1) => api.get('/notices', { params: { page, limit: 30 } }).then((r) => r.data),
  readNotice: (id: string) => api.post(`/notices/${id}/read`),
  notifications: () => data<any[]>(api.get('/notifications')),
  readAllNotifications: () => api.put('/notifications/read-all'),
  events: () => data<any[]>(api.get('/calendar')),

  // Teacher
  classes: () => data<any[]>(api.get('/academics/classes')),
  subjects: () => data<any[]>(api.get('/academics/subjects')),
  roster: (sectionId: string) => data(api.get('/attendance/students', { params: { sectionId } })),
  markAttendance: (sectionId: string, records: { studentId: string; status: string }[]) =>
    data(api.put('/attendance/students', { sectionId, records })),

  // Exams & timetable
  familyExams: (studentId: string) => data<any[]>(api.get('/family/exams', { params: { studentId } })),
  reportCardLink: (examId: string, studentId: string) => data<{ url: string }>(api.get(`/exams/${examId}/report-card/${studentId}/pdf-link`)),
  markTasks: () => data<any[]>(api.get('/exams/marks/assignments')),
  marks: (examId: string, sectionId: string, subjectId: string) => data(api.get(`/exams/${examId}/marks`, { params: { sectionId, subjectId } })),
  saveMarks: (examId: string, body: any) => data(api.put(`/exams/${examId}/marks`, body)),
  sectionTimetable: (sectionId: string) => data<any[]>(api.get(`/timetable/section/${sectionId}`)),
  myTimetable: () => data<any[]>(api.get('/timetable/teacher/me')),
  today: () => data(api.get('/timetable/today')),

  // Payments
  paymentOptions: () => data(api.get('/payments/options')),
  submitClaim: (form: FormData) => data(api.post('/payments/claims', form, { headers: { 'Content-Type': 'multipart/form-data' } })),
  claims: (studentId: string) => data<any[]>(api.get('/payments/claims', { params: { studentId } })),
  createIntent: (studentId: string, invoiceIds: string[]) => data(api.post('/payments/intents', { studentId, invoiceIds })),
  intent: (id: string) => data(api.get(`/payments/intents/${id}`)),

  // Leave & approvals
  myLeave: () => data(api.get('/leave/mine')),
  applyLeave: (body: any) => data(api.post('/leave', body)),
  cancelLeave: (id: string) => api.post(`/leave/${id}/cancel`),
  approvals: () => data(api.get('/approvals')),
  decideLeave: (id: string, approve: boolean, note?: string) => api.post(`/leave/${id}/decision`, { approve, note }),
  decideConcession: (id: string, approve: boolean) => api.post(`/fees/concessions/${id}/decision`, { approve }),
  decideClaim: (id: string, approve: boolean, note?: string) => api.post(`/payments/claims/${id}/decision`, { approve, note }),

  // Office
  dashboard: () => data(api.get('/dashboard/overview')),
};
