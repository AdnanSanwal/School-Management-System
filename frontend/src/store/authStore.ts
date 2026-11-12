import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Role = 'SUPER_ADMIN' | 'OWNER' | 'PRINCIPAL' | 'ADMIN' | 'ACCOUNTANT' | 'TEACHER' | 'PARENT' | 'STUDENT';

/** The school's subscription, as worked out by the server. */
export type LicenceStatus = {
  state: 'ACTIVE' | 'DUE_SOON' | 'GRACE' | 'LOCKED'; plan: string | null; paidUntil: string | null; daysLeft: number | null;
  lockDate: string | null; graceDays: number; notifyDays: number; maxStudents: number | null; message: string | null; summary: string;
};

interface User {
  id: string;
  name: string;
  email: string | null;
  username?: string | null;
  mustChangePassword?: boolean;
  role: Role;
  avatar?: string;
  school?: { id: string; name: string; code: string; logoUrl?: string | null; currency: string } | null;
  /** What this user may do in their school (the school can tune its staff roles). */
  permissions?: string[];
  /** Roles this user may create logins for (set by the owner under Roles & permissions). */
  creatableRoles?: string[];
  licence?: LicenceStatus | null;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  clearAuth: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      setAuth: (user, accessToken, refreshToken) => set({ user, accessToken, refreshToken }),
      clearAuth: () => set({ user: null, accessToken: null, refreshToken: null }),
      isAuthenticated: () => !!get().accessToken && !!get().user,
    }),
    { name: 'sms-auth' }
  )
);

/** Where each role lands after login. */
export const HOME_BY_ROLE: Record<string, string> = {
  OWNER: '/dashboard', PRINCIPAL: '/dashboard', ADMIN: '/dashboard', ACCOUNTANT: '/fees',
  TEACHER: '/attendance', PARENT: '/family', STUDENT: '/family', SUPER_ADMIN: '/platform',
};
