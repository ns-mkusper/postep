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

export function isSafUri(uri: string): boolean {
  return uri.startsWith("content://");
}

function splitConfig(config: OrgBridgeConfig): {
  nativeConfig: OrgBridgeConfig;
  safRoots: string[];
  safRoamRoots: string[];
} {
  const nativeRoots = config.roots.filter((root) => !isSafUri(root));
  const safRoots = config.roots.filter(isSafUri);
  const nativeRoamRoots = config.roamRoots?.filter((root) => !isSafUri(root));
  const safRoamRoots = config.roamRoots?.filter(isSafUri) ?? [];
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

  const { nativeConfig, safRoots, safRoamRoots } = splitConfig(config);
  const documents: DocumentRef[] = [];

  if (nativeConfig.roots.length > 0 || (nativeConfig.roamRoots?.length ?? 0) > 0) {
    documents.push(...(await listDocumentsAsync(nativeConfig)));
  }

  const safDocumentRoots = [...safRoots, ...safRoamRoots];
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

  const sorted = documents.sort((left, right) => left.name.localeCompare(right.name));
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
  if (isSafUri(path)) {
    const { readOrgFile } = await import("@postep/bridge/platform/android/saf");
    const raw = await readOrgFile(path);
    return parseOrgDocument(raw, path);
  }
  return loadDocumentAsync(splitConfig(config).nativeConfig, path);
}

export async function updateDocumentForConfig(
  request: UpdateDocumentRequest,
): Promise<DocumentPayload> {
  if (isSafUri(request.path)) {
    const { writeOrgFile } =
      await import("@postep/bridge/platform/android/saf");
    await writeOrgFile(request.path, request.raw);
    return parseOrgDocument(request.raw, request.path);
  }
  return updateDocumentAsync({
    ...request,
    roots: request.roots.filter((root) => !isSafUri(root)),
    roamRoots: request.roamRoots?.filter((root) => !isSafUri(root)),
  });
}
