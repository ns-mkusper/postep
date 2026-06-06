export interface SafDirectoryHandle {
  uri: string;
  persistable: boolean;
}

export interface SafDirectoryListing extends SafDirectoryHandle {
  entries: string[];
}

export interface SafWriteResult {
  uri: string;
  bytesWritten: number;
}

export interface SafRecursiveListing extends SafDirectoryHandle {
  entries: string[];
  errors: Array<{ uri: string; message: string }>;
}

async function loadSafModule() {
  const { StorageAccessFramework } = await import('expo-file-system');
  return StorageAccessFramework as SafModule;
}

async function loadFileSystemModule() {
  return import('expo-file-system');
}

type SafModule = {
  requestDirectoryPermissionsAsync: (
    initialUri?: string
  ) => Promise<{ granted: boolean; directoryUri?: string | null }>;
  persistPermissionsAsync: (uri: string) => Promise<void>;
  readDirectoryAsync: (uri: string) => Promise<string[]>;
  writeAsStringAsync: (uri: string, data: string) => Promise<void>;
};

export async function requestOrgDirectory(initialUri?: string): Promise<SafDirectoryHandle> {
  const saf = await loadSafModule();
  const result = await saf.requestDirectoryPermissionsAsync(initialUri);
  if (!result.granted || !result.directoryUri) {
    throw new Error('User cancelled SAF directory picker');
  }
  await saf.persistPermissionsAsync(result.directoryUri);
  return { uri: result.directoryUri, persistable: true };
}

export async function listOrgFiles(uri: string): Promise<SafDirectoryListing> {
  const saf = await loadSafModule();
  const entries = await saf.readDirectoryAsync(uri);
  return { uri, persistable: true, entries };
}

export async function listOrgFilesRecursively(
  uri: string,
  maxDepth = 8
): Promise<SafRecursiveListing> {
  const saf = await loadSafModule();
  const entries: string[] = [];
  const errors: SafRecursiveListing['errors'] = [];
  const seen = new Set<string>();

  async function visit(currentUri: string, depth: number): Promise<void> {
    if (seen.has(currentUri) || depth > maxDepth) {
      return;
    }
    seen.add(currentUri);

    if (isOrgFileUri(currentUri)) {
      entries.push(currentUri);
      return;
    }

    let children: string[];
    try {
      children = await saf.readDirectoryAsync(currentUri);
    } catch (error) {
      errors.push({ uri: currentUri, message: errorMessage(error) });
      return;
    }

    for (const child of children) {
      if (isOrgFileUri(child)) {
        entries.push(child);
      } else {
        await visit(child, depth + 1);
      }
    }
  }

  await visit(uri, 0);
  return {
    uri,
    persistable: true,
    entries: [...new Set(entries)].sort((left, right) =>
      nameFromSafUri(left).localeCompare(nameFromSafUri(right))
    ),
    errors,
  };
}

export async function readOrgFile(uri: string): Promise<string> {
  const fileSystem = await loadFileSystemModule();
  return fileSystem.readAsStringAsync(uri, {
    encoding: fileSystem.EncodingType.UTF8,
  });
}

export async function writeOrgFile(uri: string, contents: string): Promise<SafWriteResult> {
  const saf = await loadSafModule();
  await saf.writeAsStringAsync(uri, contents);
  return { uri, bytesWritten: utf8Length(contents) };
}

export function nameFromSafUri(uri: string): string {
  const decoded = safeDecode(uri);
  const documentMarker = '/document/';
  const documentIndex = decoded.lastIndexOf(documentMarker);
  const tail = documentIndex >= 0
    ? decoded.slice(documentIndex + documentMarker.length)
    : decoded;
  const slashName = tail.split('/').filter(Boolean).pop();
  const colonName = tail.split(':').filter(Boolean).pop();
  return (slashName ?? colonName ?? tail).replace(/^.*\//, '') || uri;
}

function isOrgFileUri(uri: string): boolean {
  return nameFromSafUri(uri).toLowerCase().endsWith('.org');
}

function safeDecode(uri: string): string {
  try {
    return decodeURIComponent(uri);
  } catch {
    return uri;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function utf8Length(value: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).length;
  }
  return value.length;
}
