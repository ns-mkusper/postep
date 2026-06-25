import type { QueryClient } from "@tanstack/react-query";
import type {
  AgendaSnapshot,
  DocumentPayload,
  DocumentRef,
  OrgBridgeConfig,
  RoamGraph,
} from "@postep/bridge";

import { loadAgendaSnapshotForConfig } from "./agendaSources";
import {
  cachedDocumentPayloads,
  hydrateDocumentSourceCache,
  listDocumentsForConfig,
  snapshotDocumentSourceCache,
} from "./documentSources";
import { loadRoamGraphForConfig } from "./roamSources";
import {
  agendaQueryKey,
  documentQueryKey,
  documentsQueryKey,
  hasConfiguredOrgRoots,
  roamQueryKey,
} from "./queryKeys";

const CACHE_VERSION = 1;
const CACHE_FILE = "postep-org-warm-cache-v1.json";
const MAX_PERSISTED_DOCUMENTS = 400;

export type WarmOrgCacheMetrics = {
  hydrated: boolean;
  cacheAgeMs?: number;
  documents: number;
  payloads: number;
  agendaItems: number;
  habits: number;
  roamNodes: number;
  elapsedMs: number;
};

type WarmOrgSnapshot = {
  version: number;
  configKey: string;
  savedAt: number;
  documents?: DocumentRef[];
  payloads?: DocumentPayload[];
  agenda?: AgendaSnapshot;
  roam?: RoamGraph;
  documentSourceCache?: ReturnType<typeof snapshotDocumentSourceCache>;
};

let warmPromise: { configKey: string; promise: Promise<WarmOrgCacheMetrics> } | null = null;
let hydratePromise: { configKey: string; promise: Promise<WarmOrgCacheMetrics> } | null = null;

export function warmOrgConfigKey(config: OrgBridgeConfig): string {
  return JSON.stringify({
    roots: [...config.roots].sort(),
    roamRoots: [...(config.roamRoots ?? [])].sort(),
  });
}

export async function hydrateWarmOrgCache(
  queryClient: QueryClient,
  config: OrgBridgeConfig,
): Promise<WarmOrgCacheMetrics> {
  if (!hasConfiguredOrgRoots(config)) {
    return emptyMetrics(false, 0);
  }
  const configKey = warmOrgConfigKey(config);
  if (!hydratePromise || hydratePromise.configKey !== configKey) {
    hydratePromise = {
      configKey,
      promise: hydrateWarmOrgCacheOnce(queryClient, config).finally(() => {
        hydratePromise = null;
      }),
    };
  }
  return hydratePromise.promise;
}

export async function warmOrgWorkspace(
  queryClient: QueryClient,
  config: OrgBridgeConfig,
): Promise<WarmOrgCacheMetrics> {
  if (!hasConfiguredOrgRoots(config)) {
    return emptyMetrics(false, 0);
  }
  const configKey = warmOrgConfigKey(config);
  if (!warmPromise || warmPromise.configKey !== configKey) {
    warmPromise = {
      configKey,
      promise: warmOrgWorkspaceOnce(queryClient, config).finally(() => {
        warmPromise = null;
      }),
    };
  }
  return warmPromise.promise;
}

async function hydrateWarmOrgCacheOnce(
  queryClient: QueryClient,
  config: OrgBridgeConfig,
): Promise<WarmOrgCacheMetrics> {
  const startedAt = now();
  const snapshot = await readSnapshot();
  if (!snapshot || snapshot.version !== CACHE_VERSION || snapshot.configKey !== warmOrgConfigKey(config)) {
    return emptyMetrics(false, now() - startedAt);
  }

  hydrateDocumentSourceCache(snapshot.documentSourceCache);
  if (snapshot.documents) {
    queryClient.setQueryData(documentsQueryKey(config), snapshot.documents);
  }
  if (snapshot.agenda) {
    queryClient.setQueryData(agendaQueryKey(config), snapshot.agenda);
  }
  if (snapshot.roam) {
    queryClient.setQueryData(roamQueryKey(config), snapshot.roam);
  }
  for (const payload of snapshot.payloads ?? []) {
    queryClient.setQueryData(documentQueryKey(config, payload.path), payload);
  }

  const metrics = snapshotMetrics(snapshot, now() - startedAt, true);
  console.log("Postep warm cache hydrated", metrics);
  return metrics;
}

async function warmOrgWorkspaceOnce(
  queryClient: QueryClient,
  config: OrgBridgeConfig,
): Promise<WarmOrgCacheMetrics> {
  const startedAt = now();
  await hydrateWarmOrgCache(queryClient, config);

  const documentsPromise = queryClient.fetchQuery({
    queryKey: documentsQueryKey(config),
    queryFn: () => listDocumentsForConfig(config),
    staleTime: 15 * 60 * 1000,
  });
  const agendaPromise = queryClient.fetchQuery({
    queryKey: agendaQueryKey(config),
    queryFn: () => loadAgendaSnapshotForConfig(config),
    staleTime: 15 * 60 * 1000,
  });
  const roamPromise = queryClient.fetchQuery({
    queryKey: roamQueryKey(config),
    queryFn: () => loadRoamGraphForConfig(config),
    staleTime: 15 * 60 * 1000,
  });

  const [documents, agenda, roam] = await Promise.all([
    documentsPromise,
    agendaPromise,
    roamPromise,
  ]);

  const payloads = cachedDocumentPayloads().slice(0, MAX_PERSISTED_DOCUMENTS);
  for (const payload of payloads) {
    queryClient.setQueryData(documentQueryKey(config, payload.path), payload);
  }

  const snapshot: WarmOrgSnapshot = {
    version: CACHE_VERSION,
    configKey: warmOrgConfigKey(config),
    savedAt: Date.now(),
    documents,
    payloads,
    agenda,
    roam,
    documentSourceCache: snapshotDocumentSourceCache(MAX_PERSISTED_DOCUMENTS),
  };
  await writeSnapshot(snapshot);

  const metrics = snapshotMetrics(snapshot, now() - startedAt, false);
  console.log("Postep org workspace warmed", metrics);
  return metrics;
}

function snapshotMetrics(
  snapshot: WarmOrgSnapshot,
  elapsedMs: number,
  hydrated: boolean,
): WarmOrgCacheMetrics {
  return {
    hydrated,
    cacheAgeMs: Date.now() - snapshot.savedAt,
    documents: snapshot.documents?.length ?? 0,
    payloads: snapshot.payloads?.length ?? 0,
    agendaItems: snapshot.agenda?.items.length ?? 0,
    habits: snapshot.agenda?.habits.length ?? 0,
    roamNodes: snapshot.roam?.nodes.length ?? 0,
    elapsedMs,
  };
}

function emptyMetrics(hydrated: boolean, elapsedMs: number): WarmOrgCacheMetrics {
  return {
    hydrated,
    documents: 0,
    payloads: 0,
    agendaItems: 0,
    habits: 0,
    roamNodes: 0,
    elapsedMs,
  };
}

async function readSnapshot(): Promise<WarmOrgSnapshot | null> {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const raw = window.localStorage.getItem(CACHE_FILE);
      return raw ? JSON.parse(raw) as WarmOrgSnapshot : null;
    }
    const FileSystem = await loadFileSystem();
    const uri = `${FileSystem.documentDirectory ?? ""}${CACHE_FILE}`;
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) {
      return null;
    }
    const raw = await FileSystem.readAsStringAsync(uri);
    return JSON.parse(raw) as WarmOrgSnapshot;
  } catch (error) {
    console.warn("Postep warm cache read skipped", error);
    return null;
  }
}

async function writeSnapshot(snapshot: WarmOrgSnapshot): Promise<void> {
  try {
    const raw = JSON.stringify(snapshot);
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(CACHE_FILE, raw);
      return;
    }
    const FileSystem = await loadFileSystem();
    const uri = `${FileSystem.documentDirectory ?? ""}${CACHE_FILE}`;
    await FileSystem.writeAsStringAsync(uri, raw);
  } catch (error) {
    console.warn("Postep warm cache write skipped", error);
  }
}

type FileSystemModule = {
  documentDirectory?: string | null;
  getInfoAsync(uri: string): Promise<{ exists: boolean }>;
  readAsStringAsync(uri: string): Promise<string>;
  writeAsStringAsync(uri: string, contents: string): Promise<void>;
};

async function loadFileSystem(): Promise<FileSystemModule> {
  return await import("expo-file-system") as unknown as FileSystemModule;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
