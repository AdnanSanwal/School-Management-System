import axios from 'axios';
import { useAuthStore } from '../store/authStore';

// Android emulator: use http://10.0.2.2:5000/api/v1. Real phone: your computer's LAN IP.
export const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

export const api = axios.create({ baseURL: BASE_URL, timeout: 20_000 });

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

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

  // Office
  dashboard: () => data(api.get('/dashboard/overview')),
};
