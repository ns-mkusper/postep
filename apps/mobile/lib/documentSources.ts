import {
  listDocumentsAsync,
  loadDocumentAsync,
  parseOrgDocument,
  updateDocumentAsync,
  type DocumentPayload,
  type DocumentRef,
  type OrgBridgeConfig,
  type UpdateDocumentRequest,
} from "@postep/bridge";

const LISTING_TARGET_MS = 10000;

type DocumentSourceCacheSnapshot = {
  documentsByConfig: Array<{ configKey: string; documents: DocumentRef[] }>;
  payloadsByPath: Array<{ pathKey: string; payload: DocumentPayload }>;
};

type DocumentSourceStats = {
  listSourceReads: number;
  listCacheHits: number;
  documentSourceReads: number;
  documentCacheHits: number;
  documentWrites: number;
};

const documentListCache = new Map<string, DocumentRef[]>();
const documentPayloadCache = new Map<string, DocumentPayload>();
const documentSourceStats: DocumentSourceStats = {
  listSourceReads: 0,
  listCacheHits: 0,
  documentSourceReads: 0,
  documentCacheHits: 0,
  documentWrites: 0,
};

function configCacheKey(config: OrgBridgeConfig): string {
  return JSON.stringify({
    roots: dedupeSourceList(config.roots).map(normalizeSourceIdentity).sort(),
    roamRoots: dedupeSourceList(config.roamRoots ?? []).map(normalizeSourceIdentity).sort(),
  });
}

function pathCacheKey(path: string): string {
  return normalizeSourceIdentity(path);
}

export function resetDocumentSourceStats(): void {
  documentSourceStats.listSourceReads = 0;
  documentSourceStats.listCacheHits = 0;
  documentSourceStats.documentSourceReads = 0;
  documentSourceStats.documentCacheHits = 0;
  documentSourceStats.documentWrites = 0;
}

export function getDocumentSourceStats(): DocumentSourceStats {
  return { ...documentSourceStats };
}

export function clearDocumentSourceCache(): void {
  documentListCache.clear();
  documentPayloadCache.clear();
}

export function snapshotDocumentSourceCache(maxPayloads = Number.POSITIVE_INFINITY): DocumentSourceCacheSnapshot {
  return {
    documentsByConfig: [...documentListCache.entries()].map(([configKey, documents]) => ({
      configKey,
      documents,
    })),
    payloadsByPath: [...documentPayloadCache.entries()].slice(0, maxPayloads).map(([pathKey, payload]) => ({
      pathKey,
      payload,
    })),
  };
}

export function hydrateDocumentSourceCache(snapshot?: Partial<DocumentSourceCacheSnapshot> | null): void {
  if (!snapshot) {
    return;
  }
  for (const entry of snapshot.documentsByConfig ?? []) {
    documentListCache.set(entry.configKey, entry.documents);
  }
  for (const entry of snapshot.payloadsByPath ?? []) {
    documentPayloadCache.set(entry.pathKey, entry.payload);
  }
}

export function cachedDocumentPayloads(): DocumentPayload[] {
  return [...documentPayloadCache.values()];
}

export function normalizeSourceIdentity(value: string): string {
  let normalized = value.trim();
  for (let idx = 0; idx < 2; idx += 1) {
    try {
      const decoded = decodeURIComponent(normalized);
      if (decoded === normalized) {
        break;
      }
      normalized = decoded;
    } catch {
      break;
    }
  }
  return normalized.replace(/\/+$/, "");
}

export function dedupeSourceList(sources: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const source of sources) {
    const trimmed = source.trim();
    if (!trimmed) {
      continue;
    }
    const identity = normalizeSourceIdentity(trimmed);
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    deduped.push(trimmed);
  }
  return deduped;
}

function normalizeSafDocumentIdentity(path: string): string | null {
  if (!isSafUri(path)) {
    return null;
  }
  const normalized = normalizeSourceIdentity(path);
  const authority = normalized.match(/^content:\/\/([^/]+)/)?.[1];
  const documentMarker = "/document/";
  const documentIndex = normalized.lastIndexOf(documentMarker);
  if (!authority || documentIndex < 0) {
    return null;
  }
  const documentId = normalized.slice(documentIndex + documentMarker.length);
  return `content://${authority}/document/${documentId}`;
}

function normalizeDocumentIdentity(doc: DocumentRef): string {
  return normalizeSafDocumentIdentity(doc.path) ?? normalizeSourceIdentity(doc.path);
}

function dedupeDocuments(documents: DocumentRef[]): DocumentRef[] {
  const seen = new Set<string>();
  const deduped: DocumentRef[] = [];
  for (const doc of documents) {
    const identity = normalizeDocumentIdentity(doc);
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    deduped.push(doc);
  }
  return deduped;
}

export function isSafUri(uri: string): boolean {
  return uri.startsWith("content://");
}

export function resolveDocumentPath(
  requested: string,
  paths: string[],
): string | null {
  if (paths.includes(requested)) {
    return requested;
  }
  // Paths round-tripped through router params come back URL-decoded once,
  // which corrupts SAF content:// URIs (their document ids embed %2F/%3A
  // escapes). Recover by comparing each listing path's decoded form.
  for (const path of paths) {
    try {
      if (decodeURIComponent(path) === requested) {
        return path;
      }
    } catch {
      // Listing path is not valid percent-encoding; skip it.
    }
  }
  return null;
}

function splitConfig(config: OrgBridgeConfig): {
  nativeConfig: OrgBridgeConfig;
  safRoots: string[];
  safRoamRoots: string[];
} {
  const roots = dedupeSourceList(config.roots);
  const roamRoots = dedupeSourceList(config.roamRoots ?? []);
  const nativeRoots = roots.filter((root) => !isSafUri(root));
  const safRoots = roots.filter(isSafUri);
  const nativeRootIdentities = new Set(nativeRoots.map(normalizeSourceIdentity));
  const safRootIdentities = new Set(safRoots.map(normalizeSourceIdentity));
  const nativeRoamRoots = roamRoots.filter(
    (root) => !isSafUri(root) && !nativeRootIdentities.has(normalizeSourceIdentity(root)),
  );
  const safRoamRoots = roamRoots.filter(
    (root) => isSafUri(root) && !safRootIdentities.has(normalizeSourceIdentity(root)),
  );
  return {
    nativeConfig: {
      roots: nativeRoots,
      ...(nativeRoamRoots && nativeRoamRoots.length > 0
        ? { roamRoots: nativeRoamRoots }
        : {}),
    },
    safRoots,
    safRoamRoots,
  };
}

export async function listDocumentsForConfig(
  config: OrgBridgeConfig,
): Promise<DocumentRef[]> {
  const startedAt = Date.now();
  if (config.roots.length === 0 && (config.roamRoots?.length ?? 0) === 0) {
    return [];
  }

  const cacheKey = configCacheKey(config);
  const cached = documentListCache.get(cacheKey);
  if (cached) {
    documentSourceStats.listCacheHits += 1;
    return cached;
  }

  documentSourceStats.listSourceReads += 1;
  const { nativeConfig, safRoots, safRoamRoots } = splitConfig(config);
  const documents: DocumentRef[] = [];

  if (nativeConfig.roots.length > 0 || (nativeConfig.roamRoots?.length ?? 0) > 0) {
    documents.push(...(await listDocumentsAsync(nativeConfig)));
  }

  const safDocumentRoots = dedupeSourceList([...safRoots, ...safRoamRoots]);
  if (safDocumentRoots.length > 0) {
    const { listOrgFilesRecursively } =
      await import("@postep/bridge/platform/android/saf");
    for (const root of safDocumentRoots) {
      const rootStartedAt = Date.now();
      const listing = await listOrgFilesRecursively(root);
      const elapsedMs = Date.now() - rootStartedAt;
      const level = elapsedMs > LISTING_TARGET_MS ? "warn" : "log";
      console[level]("Postep SAF listing", {
        root,
        files: listing.files.length,
        errors: listing.errors.length,
        elapsedMs,
      });
      documents.push(
        ...listing.files.map((file) => ({
          path: file.uri,
          name: file.name,
        })),
      );
    }
  }

  const sorted = dedupeDocuments(documents).sort((left, right) => left.name.localeCompare(right.name));
  documentListCache.set(cacheKey, sorted);
  console.log("Postep document listing", {
    files: sorted.length,
    elapsedMs: Date.now() - startedAt,
  });
  return sorted;
}

export async function loadDocumentForConfig(
  config: OrgBridgeConfig,
  path: string,
): Promise<DocumentPayload> {
  const cacheKey = pathCacheKey(path);
  const cached = documentPayloadCache.get(cacheKey);
  if (cached) {
    documentSourceStats.documentCacheHits += 1;
    return cached;
  }

  documentSourceStats.documentSourceReads += 1;
  const payload = isSafUri(path)
    ? await loadSafDocument(path)
    : await loadDocumentAsync(splitConfig(config).nativeConfig, path);
  documentPayloadCache.set(cacheKey, payload);
  return payload;
}

async function loadSafDocument(path: string): Promise<DocumentPayload> {
  const { readOrgFile } = await import("@postep/bridge/platform/android/saf");
  const raw = await readOrgFile(path);
  return parseOrgDocument(raw, path);
}

export async function updateDocumentForConfig(
  request: UpdateDocumentRequest,
): Promise<DocumentPayload> {
  documentSourceStats.documentWrites += 1;
  const payload = isSafUri(request.path)
    ? await updateSafDocument(request.path, request.raw)
    : await updateDocumentAsync({
        ...request,
        roots: dedupeSourceList(request.roots).filter((root) => !isSafUri(root)),
        roamRoots: dedupeSourceList(request.roamRoots ?? []).filter((root) => !isSafUri(root)),
      });
  documentPayloadCache.set(pathCacheKey(request.path), payload);
  return payload;
}

async function updateSafDocument(path: string, raw: string): Promise<DocumentPayload> {
  const { writeOrgFile } =
    await import("@postep/bridge/platform/android/saf");
  await writeOrgFile(path, raw);
  return parseOrgDocument(raw, path);
}
