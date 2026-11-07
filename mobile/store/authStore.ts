import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import * as SecureStore from 'expo-secure-store';

export type Role = 'SUPER_ADMIN' | 'OWNER' | 'PRINCIPAL' | 'ADMIN' | 'ACCOUNTANT' | 'TEACHER' | 'PARENT' | 'STUDENT';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatar?: string | null;
  school?: { id: string; name: string; code: string; currency: string; logoUrl?: string | null } | null;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  pushToken: string | null;
  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  setPushToken: (t: string | null) => void;
  clearAuth: () => void;
}

// Tokens live in the device keychain; the browser preview falls back to localStorage.
const storage: StateStorage = Platform.OS === 'web'
  ? { getItem: (k) => globalThis.localStorage?.getItem(k) ?? null, setItem: (k, v) => globalThis.localStorage?.setItem(k, v), removeItem: (k) => globalThis.localStorage?.removeItem(k) }
  : { getItem: (k) => SecureStore.getItemAsync(k), setItem: (k, v) => SecureStore.setItemAsync(k, v), removeItem: (k) => SecureStore.deleteItemAsync(k) };

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      pushToken: null,
      setAuth: (user, accessToken, refreshToken) => set({ user, accessToken, refreshToken }),
      setPushToken: (pushToken) => set({ pushToken }),
      clearAuth: () => set({ user: null, accessToken: null, refreshToken: null }),
    }),
    {
      name: 'erp-auth',
      storage: createJSONStorage(() => storage),
      partialize: ({ user, accessToken, refreshToken, pushToken }) => ({ user, accessToken, refreshToken, pushToken }),
    },
  ),
);

/** True once saved tokens have been loaded from storage (sync on web, async on phones). */
export function useHydrated() {
  const [done, setDone] = useState(() => useAuthStore.persist.hasHydrated());
  useEffect(() => {
    if (useAuthStore.persist.hasHydrated()) setDone(true);
    return useAuthStore.persist.onFinishHydration(() => setDone(true));
  }, []);
  return done;
}

export type AppArea = 'family' | 'teacher' | 'office';

/** Which app a role gets: parents & students → family, teachers → teacher, office → owner/office. */
export function areaFor(role?: Role): AppArea | null {
  if (!role) return null;
  if (role === 'PARENT' || role === 'STUDENT') return 'family';
  if (role === 'TEACHER') return 'teacher';
  if (role === 'SUPER_ADMIN') return null;
  return 'office';
}
