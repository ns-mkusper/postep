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
  clearDocumentSourceCache,
  hydrateDocumentSourceCache,
  listDocumentsForConfig,
  loadDocumentForConfig,
  snapshotDocumentSourceCache,
} from "./documentSources";
import { loadRoamGraphForConfig } from "./roamSources";
import { buildMeasuredNotePreviews, type MeasuredNotePreviews } from "./notePreviews";
import {
  agendaQueryKey,
  documentPreviewsQueryKey,
  documentQueryKey,
  documentsQueryKey,
  hasConfiguredOrgRoots,
  roamQueryKey,
} from "./queryKeys";

const CACHE_VERSION = 2;
const CACHE_NAMESPACE = "postep-org-cache-v2";
const LEGACY_CACHE_FILE = "postep-org-warm-cache-v1.json";
const MANIFEST_FILE = "manifest.json";
const AGENDA_FILE = "agenda.json";
const ROAM_FILE = "roam.json";
const PREVIEWS_FILE = "previews.json";
const DOCUMENTS_DIR = "documents/";
const MAX_PERSISTED_DOCUMENTS = 400;
const WARM_DOCUMENT_LOAD_CONCURRENCY = 8;

export type DocumentCacheMetadata = {
  path: string;
  pathKey: string;
  name?: string;
  rawHash: string;
  rawBytes: number;
  headlineCount: number;
  updatedAt: number;
  sourceVersion: string;
};

export type WarmOrgCacheStatus = {
  exists: boolean;
  version?: number;
  configKey?: string;
  rootFingerprint?: string;
  savedAt?: number;
  lastIndexedAt?: number;
  cacheAgeMs?: number;
  documents: number;
  payloads: number;
  agendaItems: number;
  habits: number;
  roamNodes: number;
};

export type WarmOrgCacheMetrics = WarmOrgCacheStatus & {
  hydrated: boolean;
  changedDocuments: number;
  unchangedDocuments: number;
  removedDocuments: number;
  persistedDocuments: number;
  elapsedMs: number;
};

type WarmOrgManifest = {
  version: number;
  configKey: string;
  rootFingerprint: string;
  savedAt: number;
  lastIndexedAt: number;
  documents: DocumentRef[];
  documentMetadata: DocumentCacheMetadata[];
  agenda?: {
    hash: string;
    items: number;
    habits: number;
  };
  roam?: {
    hash: string;
    nodes: number;
  };
  documentSourceCache?: ReturnType<typeof snapshotDocumentSourceCache>;
};

type IndexedWarmOrgSnapshot = {
  manifest: WarmOrgManifest;
  payloads: DocumentPayload[];
  agenda?: AgendaSnapshot;
  roam?: RoamGraph;
  previews?: MeasuredNotePreviews;
};

let warmPromise: { configKey: string; promise: Promise<WarmOrgCacheMetrics> } | null = null;
let hydratePromise: { configKey: string; promise: Promise<WarmOrgCacheMetrics> } | null = null;

export function warmOrgConfigKey(config: OrgBridgeConfig): string {
  return JSON.stringify({
    roots: [...config.roots].sort(),
    roamRoots: [...(config.roamRoots ?? [])].sort(),
  });
}

export function warmOrgRootFingerprint(config: OrgBridgeConfig): string {
  return stableHash(warmOrgConfigKey(config));
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
      promise: warmOrgWorkspaceOnce(queryClient, config, false).finally(() => {
        warmPromise = null;
      }),
    };
  }
  return warmPromise.promise;
}

export async function refreshWarmOrgWorkspace(
  queryClient: QueryClient,
  config: OrgBridgeConfig,
): Promise<WarmOrgCacheMetrics> {
  if (!hasConfiguredOrgRoots(config)) {
    return emptyMetrics(false, 0);
  }
  warmPromise = null;
  hydratePromise = null;
  return warmOrgWorkspaceOnce(queryClient, config, true);
}

export async function getWarmOrgCacheStatus(
  config: OrgBridgeConfig,
): Promise<WarmOrgCacheStatus> {
  const manifest = await readManifest();
  if (!manifest || manifest.version !== CACHE_VERSION || manifest.configKey !== warmOrgConfigKey(config)) {
    return emptyStatus();
  }
  return manifestStatus(manifest, await readAgenda(), await readRoam());
}

export async function clearWarmOrgCache(queryClient?: QueryClient): Promise<void> {
  warmPromise = null;
  hydratePromise = null;
  clearDocumentSourceCache();
  queryClient?.clear();
  try {
    await deleteStore();
  } catch (error) {
    console.warn("Postep warm cache clear skipped", error);
  }
}

async function hydrateWarmOrgCacheOnce(
  queryClient: QueryClient,
  config: OrgBridgeConfig,
): Promise<WarmOrgCacheMetrics> {
  const startedAt = now();
  const snapshot = await readIndexedSnapshot(config);
  if (!snapshot) {
    return emptyMetrics(false, now() - startedAt);
  }

  hydrateDocumentSourceCache(snapshot.manifest.documentSourceCache);
  queryClient.setQueryData(documentsQueryKey(config), snapshot.manifest.documents);
  if (snapshot.previews) {
    queryClient.setQueryData(
      documentPreviewsQueryKey(
        config,
        snapshot.manifest.documents.map((document) => document.path),
      ),
      snapshot.previews,
    );
  }
  if (snapshot.agenda) {
    queryClient.setQueryData(agendaQueryKey(config), snapshot.agenda);
  }
  if (snapshot.roam) {
    queryClient.setQueryData(roamQueryKey(config), snapshot.roam);
  }
  for (const payload of snapshot.payloads) {
    queryClient.setQueryData(documentQueryKey(config, payload.path), payload);
  }

  const metrics = snapshotMetrics(snapshot, now() - startedAt, true, {
    changedDocuments: 0,
    unchangedDocuments: snapshot.payloads.length,
    removedDocuments: 0,
  });
  console.log("Postep warm cache hydrated", metrics);
  return metrics;
}

async function warmOrgWorkspaceOnce(
  queryClient: QueryClient,
  config: OrgBridgeConfig,
  forceRefresh: boolean,
): Promise<WarmOrgCacheMetrics> {
  const startedAt = now();
  const existing = await readIndexedSnapshot(config);

  if (!forceRefresh) {
    await hydrateWarmOrgCache(queryClient, config);
  }

  // Background refresh deliberately revalidates the source while the UI keeps using
  // hydrated Query data. Source APIs do not expose mtime yet, so raw hashes are the
  // source version and unchanged files avoid React Query/persistent document rewrites.
  clearDocumentSourceCache();
  const documents = await listDocumentsForConfig(config);
  await mapConcurrent(
    documents.slice(0, MAX_PERSISTED_DOCUMENTS),
    WARM_DOCUMENT_LOAD_CONCURRENCY,
    async (document) => {
      try {
        await loadDocumentForConfig(config, document.path);
      } catch (error) {
        console.warn("Postep warm document skipped", {
          name: document.name,
          path: document.path,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );
  const agenda = await loadAgendaSnapshotForConfig(config);
  const roam = await loadRoamGraphForConfig(config);

  const payloads = cachedDocumentPayloads().slice(0, MAX_PERSISTED_DOCUMENTS);
  const previews = buildMeasuredNotePreviews(documents, payloads);
  const previousByPath = new Map(
    existing?.manifest.documentMetadata.map((metadata) => [metadata.pathKey, metadata]) ?? [],
  );
  const currentPathKeys = new Set(payloads.map((payload) => pathKey(payload.path)));
  const removedDocuments = [...previousByPath.keys()].filter((key) => !currentPathKeys.has(key)).length;
  let changedDocuments = 0;
  let unchangedDocuments = 0;
  const documentNames = new Map(documents.map((document) => [pathKey(document.path), document.name]));
  const documentMetadata = payloads.map((payload) => {
    const key = pathKey(payload.path);
    const rawHash = stableHash(payload.raw);
    const previous = previousByPath.get(key);
    if (previous?.rawHash === rawHash) {
      unchangedDocuments += 1;
    } else {
      changedDocuments += 1;
    }
    return {
      path: payload.path,
      pathKey: key,
      name: documentNames.get(key),
      rawHash,
      rawBytes: utf8Bytes(payload.raw),
      headlineCount: payload.lexical.length,
      updatedAt: previous?.rawHash === rawHash ? previous.updatedAt : Date.now(),
      sourceVersion: rawHash,
    };
  });

  queryClient.setQueryData(documentsQueryKey(config), documents);
  queryClient.setQueryData(
    documentPreviewsQueryKey(config, documents.map((document) => document.path)),
    previews,
  );
  queryClient.setQueryData(agendaQueryKey(config), agenda);
  queryClient.setQueryData(roamQueryKey(config), roam);
  for (const payload of payloads) {
    queryClient.setQueryData(documentQueryKey(config, payload.path), payload);
  }

  const manifest: WarmOrgManifest = {
    version: CACHE_VERSION,
    configKey: warmOrgConfigKey(config),
    rootFingerprint: warmOrgRootFingerprint(config),
    savedAt: Date.now(),
    lastIndexedAt: Date.now(),
    documents,
    documentMetadata,
    agenda: {
      hash: stableHash(stableStringify(agenda)),
      items: agenda.items.length,
      habits: agenda.habits.length,
    },
    roam: {
      hash: stableHash(stableStringify(roam)),
      nodes: roam.nodes.length,
    },
    documentSourceCache: snapshotDocumentSourceCache(MAX_PERSISTED_DOCUMENTS),
  };

  await writeIndexedSnapshot({ manifest, payloads, agenda, roam, previews }, existing?.manifest ?? null);

  const metrics = snapshotMetrics(
    { manifest, payloads, agenda, roam, previews },
    now() - startedAt,
    false,
    { changedDocuments, unchangedDocuments, removedDocuments },
  );
  console.log("Postep org workspace warmed", metrics);
  return metrics;
}

async function readIndexedSnapshot(config: OrgBridgeConfig): Promise<IndexedWarmOrgSnapshot | null> {
  const manifest = await readManifest();
  if (!manifest || manifest.version !== CACHE_VERSION || manifest.configKey !== warmOrgConfigKey(config)) {
    return null;
  }
  const payloads = (
    await Promise.all(manifest.documentMetadata.map((metadata) => readDocumentPayload(metadata.pathKey)))
  ).filter((payload): payload is DocumentPayload => Boolean(payload));
  const agenda = await readAgenda();
  const roam = await readRoam();
  const previews = await readPreviews();
  return { manifest, payloads, agenda, roam, previews };
}

async function writeIndexedSnapshot(
  snapshot: IndexedWarmOrgSnapshot,
  previousManifest: WarmOrgManifest | null,
): Promise<void> {
  try {
    await ensureStore();
    const previousByPath = new Map(
      previousManifest?.documentMetadata.map((metadata) => [metadata.pathKey, metadata]) ?? [],
    );
    const currentPathKeys = new Set(snapshot.manifest.documentMetadata.map((metadata) => metadata.pathKey));
    const metadataByPath = new Map(snapshot.manifest.documentMetadata.map((metadata) => [metadata.pathKey, metadata]));
    await Promise.all(snapshot.payloads.map(async (payload) => {
      const key = pathKey(payload.path);
      const previous = previousByPath.get(key);
      const current = metadataByPath.get(key);
      if (previous?.rawHash === current?.rawHash && await documentPayloadExists(key)) {
        return;
      }
      await writeDocumentPayload(key, payload);
    }));
    await Promise.all(
      [...previousByPath.keys()]
        .filter((key) => !currentPathKeys.has(key))
        .map((key) => deleteDocumentPayload(key)),
    );
    if (snapshot.agenda) {
      await writeJson(AGENDA_FILE, snapshot.agenda);
    }
    if (snapshot.roam) {
      await writeJson(ROAM_FILE, snapshot.roam);
    }
    if (snapshot.previews) {
      await writeJson(PREVIEWS_FILE, snapshot.previews);
    }
    await writeJson(MANIFEST_FILE, snapshot.manifest);
  } catch (error) {
    console.warn("Postep warm cache write skipped", error);
  }
}

async function readManifest(): Promise<WarmOrgManifest | null> {
  return await readJson<WarmOrgManifest>(MANIFEST_FILE);
}

async function readAgenda(): Promise<AgendaSnapshot | undefined> {
  return await readJson<AgendaSnapshot>(AGENDA_FILE) ?? undefined;
}

async function readRoam(): Promise<RoamGraph | undefined> {
  return await readJson<RoamGraph>(ROAM_FILE) ?? undefined;
}

async function readPreviews(): Promise<MeasuredNotePreviews | undefined> {
  return await readJson<MeasuredNotePreviews>(PREVIEWS_FILE) ?? undefined;
}

async function readDocumentPayload(key: string): Promise<DocumentPayload | null> {
  return await readJson<DocumentPayload>(`${DOCUMENTS_DIR}${key}.json`);
}

async function writeDocumentPayload(key: string, payload: DocumentPayload): Promise<void> {
  await writeJson(`${DOCUMENTS_DIR}${key}.json`, payload);
}

async function deleteDocumentPayload(key: string): Promise<void> {
  await deleteJson(`${DOCUMENTS_DIR}${key}.json`);
}

async function documentPayloadExists(key: string): Promise<boolean> {
  return await pathExists(`${DOCUMENTS_DIR}${key}.json`);
}

async function mapConcurrent<T>(
  items: T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        await task(items[index], index);
      }
    }),
  );
}

function snapshotMetrics(
  snapshot: IndexedWarmOrgSnapshot,
  elapsedMs: number,
  hydrated: boolean,
  changes: Pick<WarmOrgCacheMetrics, "changedDocuments" | "unchangedDocuments" | "removedDocuments">,
): WarmOrgCacheMetrics {
  const status = manifestStatus(snapshot.manifest, snapshot.agenda, snapshot.roam);
  return {
    ...status,
    hydrated,
    persistedDocuments: snapshot.payloads.length,
    elapsedMs,
    ...changes,
  };
}

function manifestStatus(
  manifest: WarmOrgManifest,
  agenda?: AgendaSnapshot,
  roam?: RoamGraph,
): WarmOrgCacheStatus {
  return {
    exists: true,
    version: manifest.version,
    configKey: manifest.configKey,
    rootFingerprint: manifest.rootFingerprint,
    savedAt: manifest.savedAt,
    lastIndexedAt: manifest.lastIndexedAt,
    cacheAgeMs: Date.now() - manifest.lastIndexedAt,
    documents: manifest.documents.length,
    payloads: manifest.documentMetadata.length,
    agendaItems: agenda?.items.length ?? manifest.agenda?.items ?? 0,
    habits: agenda?.habits.length ?? manifest.agenda?.habits ?? 0,
    roamNodes: roam?.nodes.length ?? manifest.roam?.nodes ?? 0,
  };
}

function emptyStatus(): WarmOrgCacheStatus {
  return {
    exists: false,
    documents: 0,
    payloads: 0,
    agendaItems: 0,
    habits: 0,
    roamNodes: 0,
  };
}

function emptyMetrics(hydrated: boolean, elapsedMs: number): WarmOrgCacheMetrics {
  return {
    ...emptyStatus(),
    hydrated,
    changedDocuments: 0,
    unchangedDocuments: 0,
    removedDocuments: 0,
    persistedDocuments: 0,
    elapsedMs,
  };
}

function pathKey(path: string): string {
  return stableHash(path);
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let idx = 0; idx < value.length; idx += 1) {
    hash ^= value.charCodeAt(idx);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function utf8Bytes(value: string): number {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(value).length;
  }
  return unescape(encodeURIComponent(value)).length;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

async function readJson<T>(relativePath: string): Promise<T | null> {
  try {
    if (hasLocalStorage()) {
      const raw = window.localStorage.getItem(storageKey(relativePath));
      return raw ? JSON.parse(raw) as T : null;
    }
    const uri = await fileUri(relativePath);
    const FileSystem = await loadFileSystem();
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) {
      return null;
    }
    return JSON.parse(await FileSystem.readAsStringAsync(uri)) as T;
  } catch (error) {
    console.warn("Postep warm cache read skipped", error);
    return null;
  }
}

async function writeJson(relativePath: string, value: unknown): Promise<void> {
  const raw = JSON.stringify(value);
  if (hasLocalStorage()) {
    window.localStorage.setItem(storageKey(relativePath), raw);
    return;
  }
  const FileSystem = await loadFileSystem();
  await ensureStore();
  await FileSystem.writeAsStringAsync(await fileUri(relativePath), raw);
}

async function deleteJson(relativePath: string): Promise<void> {
  if (hasLocalStorage()) {
    window.localStorage.removeItem(storageKey(relativePath));
    return;
  }
  const FileSystem = await loadFileSystem();
  const uri = await fileUri(relativePath);
  const info = await FileSystem.getInfoAsync(uri);
  if (info.exists) {
    await FileSystem.deleteAsync?.(uri, { idempotent: true });
  }
}

async function pathExists(relativePath: string): Promise<boolean> {
  if (hasLocalStorage()) {
    return window.localStorage.getItem(storageKey(relativePath)) !== null;
  }
  const FileSystem = await loadFileSystem();
  return (await FileSystem.getInfoAsync(await fileUri(relativePath))).exists;
}

async function ensureStore(): Promise<void> {
  if (hasLocalStorage()) {
    return;
  }
  const FileSystem = await loadFileSystem();
  await FileSystem.makeDirectoryAsync?.(await directoryUri(""), { intermediates: true });
  await FileSystem.makeDirectoryAsync?.(await directoryUri(DOCUMENTS_DIR), { intermediates: true });
}

async function deleteStore(): Promise<void> {
  if (hasLocalStorage()) {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(`${CACHE_NAMESPACE}:`) || key === LEGACY_CACHE_FILE) {
        keys.push(key);
      }
    }
    keys.forEach((key) => window.localStorage.removeItem(key));
    return;
  }
  const FileSystem = await loadFileSystem();
  const uri = await directoryUri("");
  const info = await FileSystem.getInfoAsync(uri);
  if (info.exists) {
    await FileSystem.deleteAsync?.(uri, { idempotent: true });
  }
  const legacyUri = `${FileSystem.documentDirectory ?? ""}${LEGACY_CACHE_FILE}`;
  const legacyInfo = await FileSystem.getInfoAsync(legacyUri);
  if (legacyInfo.exists) {
    await FileSystem.deleteAsync?.(legacyUri, { idempotent: true });
  }
}

function storageKey(relativePath: string): string {
  return `${CACHE_NAMESPACE}:${relativePath}`;
}

function hasLocalStorage(): boolean {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

async function directoryUri(relativePath: string): Promise<string> {
  const FileSystem = await loadFileSystem();
  return `${FileSystem.documentDirectory ?? ""}${CACHE_NAMESPACE}/${relativePath}`;
}

async function fileUri(relativePath: string): Promise<string> {
  return await directoryUri(relativePath);
}

type FileSystemModule = {
  documentDirectory?: string | null;
  getInfoAsync(uri: string): Promise<{ exists: boolean }>;
  readAsStringAsync(uri: string): Promise<string>;
  writeAsStringAsync(uri: string, contents: string): Promise<void>;
  makeDirectoryAsync?: (uri: string, options?: { intermediates?: boolean }) => Promise<void>;
  deleteAsync?: (uri: string, options?: { idempotent?: boolean }) => Promise<void>;
};

async function loadFileSystem(): Promise<FileSystemModule> {
  return await import("expo-file-system") as unknown as FileSystemModule;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
