import { create } from 'zustand';
import { OrgBridgeConfig, E2E_ORG_ROOT, emitBridgeEvent, isE2EMode, setRoots } from '@postep/bridge';

interface OrgConfigState {
  roots: string[];
  roamRoots: string[];
  hasHydrated: boolean;
  hydrate(): Promise<void>;
  addRoot(path: string): void;
  removeRoot(path: string): void;
  addRoamRoot(path: string): void;
  removeRoamRoot(path: string): void;
  reset(): void;
}

const isE2E = process.env.EXPO_PUBLIC_POSTEP_E2E === '1' || isE2EMode();
const initialRoots = isE2E ? [E2E_ORG_ROOT] : [];
const initialRoamRoots = isE2E ? [E2E_ORG_ROOT] : [];
const storageKey = 'postep.orgConfig.v1';

const isSafUri = (uri: string) => uri.startsWith('content://');

const withTimeout = async <T,>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

const syncNative = (roots: string[], roamRoots: string[]) => {
  const nativeRoots = roots.filter((root) => !isSafUri(root));
  const nativeRoamRoots = roamRoots.filter((root) => !isSafUri(root));
  if (nativeRoots.length === 0 && nativeRoamRoots.length === 0) {
    emitBridgeEvent('rootsChanged');
    return;
  }
  setRoots({
    roots: nativeRoots,
    ...(nativeRoamRoots.length > 0 ? { roamRoots: nativeRoamRoots } : {})
  });
  emitBridgeEvent('rootsChanged');
};

const persistRoots = (roots: string[], roamRoots: string[]) => {
  if (isE2E) {
    return;
  }
  void import('expo-secure-store')
    .then((secureStore) =>
      secureStore.setItemAsync(storageKey, JSON.stringify({ roots, roamRoots })),
    )
    .catch((error) => {
      console.warn('Failed to persist Org config', error);
    });
};

export const useOrgConfig = create<OrgConfigState>((set) => ({
  roots: initialRoots,
  roamRoots: initialRoamRoots,
  hasHydrated: isE2E,
  hydrate: async () => {
    if (isE2E) {
      set({ hasHydrated: true });
      return;
    }
    try {
      const secureStore = await withTimeout(
        import('expo-secure-store'),
        2500,
        'Org config storage import',
      );
      const raw = await withTimeout(
        secureStore.getItemAsync(storageKey),
        2500,
        'Org config storage read',
      );
      if (!raw) {
        set({ hasHydrated: true });
        return;
      }
      const parsed = JSON.parse(raw) as Partial<Pick<OrgConfigState, 'roots' | 'roamRoots'>>;
      const roots = Array.isArray(parsed.roots)
        ? parsed.roots.filter((root): root is string => typeof root === 'string')
        : [];
      const roamRoots = Array.isArray(parsed.roamRoots)
        ? parsed.roamRoots.filter((root): root is string => typeof root === 'string')
        : [];
      syncNative(roots, roamRoots);
      set({ roots, roamRoots, hasHydrated: true });
    } catch (error) {
      console.warn('Failed to hydrate Org config', error);
      set({ hasHydrated: true });
    }
  },
  addRoot: (path: string) =>
    set((state) => {
      const trimmed = path.trim();
      if (!trimmed || state.roots.includes(trimmed)) {
        return state;
      }
      const nextRoots = [...state.roots, trimmed];
      syncNative(nextRoots, state.roamRoots);
      persistRoots(nextRoots, state.roamRoots);
      const updated = { ...state, roots: nextRoots };
      return updated;
    }),
  removeRoot: (path: string) =>
    set((state) => {
      const nextRoots = state.roots.filter((root) => root !== path);
      syncNative(nextRoots, state.roamRoots);
      persistRoots(nextRoots, state.roamRoots);
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
      persistRoots(state.roots, nextRoam);
      const updated = { ...state, roamRoots: nextRoam };
      return updated;
    }),
  removeRoamRoot: (path: string) =>
    set((state) => {
      const nextRoam = state.roamRoots.filter((root) => root !== path);
      syncNative(state.roots, nextRoam);
      persistRoots(state.roots, nextRoam);
      const updated = { ...state, roamRoots: nextRoam };
      return updated;
    }),
  reset: () => {
    syncNative([], []);
    persistRoots([], []);
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
