import { useSyncExternalStore } from 'react';

// App-wide activity for the loader and busy buttons (components/ui/GlobalLoader.tsx).
//  - writes: API requests that change data (POST/PUT/PATCH/DELETE) still running
//  - navigating: a page link was clicked and the new page hasn't rendered yet
// Data loading is tracked by React Query itself (queries with nothing on screen yet).
// Requests made with `{ silent: true }` are not counted.

type State = { writes: number; navigating: boolean };

let state: State = { writes: 0, navigating: false };
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export const activity = {
  writeStarted() { set({ writes: state.writes + 1 }); },
  writeDone() { set({ writes: Math.max(0, state.writes - 1) }); },
  navigating(on: boolean) { if (state.navigating !== on) set({ navigating: on }); },
  get: () => state,
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
};

const server: State = { writes: 0, navigating: false };

export function useActivity() {
  return useSyncExternalStore(activity.subscribe, activity.get, () => server);
}
