import { create } from 'zustand';
import { OrgBridgeConfig, emitBridgeEvent, setRoots } from '@postep/bridge';

interface OrgConfigState {
  roots: string[];
  roamRoots: string[];
  addRoot(path: string): void;
  removeRoot(path: string): void;
  addRoamRoot(path: string): void;
  removeRoamRoot(path: string): void;
  reset(): void;
}

const syncNative = (roots: string[], roamRoots: string[]) => {
  setRoots({ roots, ...(roamRoots.length > 0 ? { roamRoots } : {}) });
  emitBridgeEvent('rootsChanged');
};

export const useOrgConfig = create<OrgConfigState>((set) => ({
  roots: [],
  roamRoots: [],
  addRoot: (path: string) =>
    set((state) => {
      const trimmed = path.trim();
      if (!trimmed || state.roots.includes(trimmed)) {
        return state;
      }
      const nextRoots = [...state.roots, trimmed];
      syncNative(nextRoots, state.roamRoots);
      const updated = { ...state, roots: nextRoots };
      return updated;
    }),
  removeRoot: (path: string) =>
    set((state) => {
      const nextRoots = state.roots.filter((root) => root !== path);
      syncNative(nextRoots, state.roamRoots);
      const updated = { ...state, roots: nextRoots };
      return updated;
    }),
  addRoamRoot: (path: string) =>
    set((state) => {
      const trimmed = path.trim();
      if (!trimmed || state.roamRoots.includes(trimmed)) {
        return state;
      }
      const nextRoam = [...state.roamRoots, trimmed];
      syncNative(state.roots, nextRoam);
      const updated = { ...state, roamRoots: nextRoam };
      return updated;
    }),
  removeRoamRoot: (path: string) =>
    set((state) => {
      const nextRoam = state.roamRoots.filter((root) => root !== path);
      syncNative(state.roots, nextRoam);
      const updated = { ...state, roamRoots: nextRoam };
      return updated;
    }),
  reset: () => {
    syncNative([], []);
    return { roots: [], roamRoots: [] };
  }
}));

export function useBridgeConfig(): OrgBridgeConfig {
  const roots = useOrgConfig((state) => state.roots);
  const roamRoots = useOrgConfig((state) => state.roamRoots);
  return {
    roots,
    ...(roamRoots.length > 0 ? { roamRoots } : {})
  };
}
