import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Role = 'SUPER_ADMIN' | 'OWNER' | 'PRINCIPAL' | 'ADMIN' | 'ACCOUNTANT' | 'TEACHER' | 'PARENT' | 'STUDENT';

interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatar?: string;
  school?: { id: string; name: string; code: string; logoUrl?: string | null; currency: string } | null;
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
  TEACHER: '/attendance', PARENT: '/family', STUDENT: '/family', SUPER_ADMIN: '/settings',
};
