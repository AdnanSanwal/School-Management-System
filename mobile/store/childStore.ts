import { create } from 'zustand';

/** Parent app: which child is selected (spec: "Child selector if multiple children"). */
export const useChildStore = create<{ childId: string | null; setChild: (id: string) => void }>()((set) => ({
  childId: null,
  setChild: (childId) => set({ childId }),
}));
