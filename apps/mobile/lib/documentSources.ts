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

export function isSafUri(uri: string): boolean {
  return uri.startsWith("content://");
}

function splitConfig(config: OrgBridgeConfig): {
  nativeConfig: OrgBridgeConfig;
  safRoots: string[];
} {
  const nativeRoots = config.roots.filter((root) => !isSafUri(root));
  const safRoots = config.roots.filter(isSafUri);
  const nativeRoamRoots = config.roamRoots?.filter((root) => !isSafUri(root));
  return {
    nativeConfig: {
      roots: nativeRoots,
      ...(nativeRoamRoots && nativeRoamRoots.length > 0
        ? { roamRoots: nativeRoamRoots }
        : {}),
    },
    safRoots,
  };
}

export async function listDocumentsForConfig(
  config: OrgBridgeConfig,
): Promise<DocumentRef[]> {
  if (config.roots.length === 0) {
    return [];
  }

  const { nativeConfig, safRoots } = splitConfig(config);
  const documents: DocumentRef[] = [];

  if (nativeConfig.roots.length > 0) {
    documents.push(...(await listDocumentsAsync(nativeConfig)));
  }

  if (safRoots.length > 0) {
    const { listOrgFilesRecursively, nameFromSafUri } =
      await import("@postep/bridge/platform/android/saf");
    for (const root of safRoots) {
      const listing = await listOrgFilesRecursively(root);
      documents.push(
        ...listing.entries.map((path) => ({
          path,
          name: nameFromSafUri(path),
        })),
      );
    }
  }

  return documents.sort((left, right) => left.name.localeCompare(right.name));
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
