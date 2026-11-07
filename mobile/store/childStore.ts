import { Platform } from 'react-native';
import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import * as SecureStore from 'expo-secure-store';

const storage: StateStorage = Platform.OS === 'web'
  ? { getItem: (k) => globalThis.localStorage?.getItem(k) ?? null, setItem: (k, v) => globalThis.localStorage?.setItem(k, v), removeItem: (k) => globalThis.localStorage?.removeItem(k) }
  : { getItem: (k) => SecureStore.getItemAsync(k), setItem: (k, v) => SecureStore.setItemAsync(k, v), removeItem: (k) => SecureStore.deleteItemAsync(k) };

/**
 * Parent app: which child is selected (spec: "Child selector if multiple children").
 * Remembered across app restarts; useChildren() falls back to the first child if the
 * saved one is no longer linked to this login.
 */
export const useChildStore = create<{ childId: string | null; setChild: (id: string) => void }>()(
  persist(
    (set) => ({ childId: null, setChild: (childId) => set({ childId }) }),
    { name: 'erp-selected-child', storage: createJSONStorage(() => storage) },
  ),
);
