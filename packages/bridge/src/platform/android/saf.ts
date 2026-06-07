export interface SafDirectoryHandle {
  uri: string;
  persistable: boolean;
}

export interface SafDirectoryListing extends SafDirectoryHandle {
  entries: string[];
}

export interface SafOrgFileEntry {
  uri: string;
  name: string;
}

export interface SafWriteResult {
  uri: string;
  bytesWritten: number;
}

export interface SafRecursiveListing extends SafDirectoryHandle {
  entries: string[];
  files: SafOrgFileEntry[];
  errors: Array<{ uri: string; message: string }>;
}

async function loadSafModule() {
  const { StorageAccessFramework } = await import('expo-file-system');
  return StorageAccessFramework as SafModule;
}

type SafModule = {
  requestDirectoryPermissionsAsync: (
    initialUri?: string
  ) => Promise<{ granted: boolean; directoryUri?: string | null }>;
  readDirectoryAsync: (uri: string) => Promise<string[]>;
  writeAsStringAsync: (uri: string, data: string) => Promise<void>;
};

type ContentUriModule = {
  readAsString: (uri: string) => Promise<string>;
  writeAsString: (uri: string, contents: string) => Promise<void>;
  listOrgFilesRecursively?: (
    uri: string,
    maxDepth: number
  ) => Promise<{
    entries: Array<string | SafOrgFileEntry>;
    errors: Array<{ uri: string; message: string }>;
  }>;
};

export async function requestOrgDirectory(initialUri?: string): Promise<SafDirectoryHandle> {
  const saf = await loadSafModule();
  const result = await saf.requestDirectoryPermissionsAsync(initialUri);
  if (!result.granted || !result.directoryUri) {
    throw new Error('User cancelled SAF directory picker');
  }
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
  const contentUri = getContentUriModule();
  if (isGenericContentUri(uri) && contentUri?.listOrgFilesRecursively) {
    const listing = await contentUri.listOrgFilesRecursively(uri, maxDepth);
    const files = normalizeSafEntries(listing.entries);
    return {
      uri,
      persistable: true,
      entries: files.map((file) => file.uri),
      files,
      errors: listing.errors,
    };
  }

  const saf = await loadSafModule();
  const entries: string[] = [];
  const errors: SafRecursiveListing['errors'] = [];
  const seen = new Set<string>();

  async function visit(currentUri: string, depth: number): Promise<void> {
    if (seen.has(currentUri) || depth > maxDepth) {
      return;
    }
    seen.add(currentUri);

    if (shouldIgnoreSafName(nameFromSafUri(currentUri))) {
      return;
    }

    if (isOrgFileUri(currentUri)) {
      entries.push(currentUri);
      return;
    }

    let children: string[];
    try {
      children = await saf.readDirectoryAsync(currentUri);
    } catch (error) {
      if (!looksLikeSkippableFile(currentUri)) {
        errors.push({ uri: currentUri, message: errorMessage(error) });
      }
      return;
    }

    for (const child of children) {
      const childName = nameFromSafUri(child);
      if (shouldIgnoreSafName(childName)) {
        continue;
      }
      if (isOrgFileUri(child)) {
        entries.push(child);
      } else {
        await visit(child, depth + 1);
      }
    }
  }

  await visit(uri, 0);
  const files = normalizeSafEntries(entries);
  return {
    uri,
    persistable: true,
    entries: files.map((file) => file.uri),
    files,
    errors,
  };
}

export async function readOrgFile(uri: string): Promise<string> {
  const contentUri = getContentUriModule();
  if (isGenericContentUri(uri) && contentUri) {
    return contentUri.readAsString(uri);
  }
  if (isGenericContentUri(uri)) {
    throw new Error('Native content URI reader is unavailable');
  }
  const fileSystem = await import('expo-file-system');
  return fileSystem.readAsStringAsync(uri, {
    encoding: fileSystem.EncodingType.UTF8,
  });
}

export async function writeOrgFile(uri: string, contents: string): Promise<SafWriteResult> {
  const contentUri = getContentUriModule();
  if (isGenericContentUri(uri) && contentUri) {
    await contentUri.writeAsString(uri, contents);
  } else {
    const saf = await loadSafModule();
    await saf.writeAsStringAsync(uri, contents);
  }
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

function normalizeSafEntries(entries: Array<string | SafOrgFileEntry>): SafOrgFileEntry[] {
  const byUri = new Map<string, SafOrgFileEntry>();
  for (const entry of entries) {
    const file = typeof entry === 'string'
      ? { uri: entry, name: nameFromSafUri(entry) }
      : { uri: entry.uri, name: entry.name || nameFromSafUri(entry.uri) };
    if (!isOrgFileName(file.name) || shouldIgnoreSafName(file.name)) {
      continue;
    }
    if (!byUri.has(file.uri)) {
      byUri.set(file.uri, file);
    }
  }
  return [...byUri.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function isOrgFileUri(uri: string): boolean {
  return isOrgFileName(nameFromSafUri(uri));
}

function isOrgFileName(name: string): boolean {
  return name.toLowerCase().endsWith('.org');
}

function shouldIgnoreSafName(name: string): boolean {
  const lower = name.toLowerCase();
  return name.startsWith('.#') ||
    (name.startsWith('#') && name.endsWith('#')) ||
    lower.endsWith('~') ||
    lower.endsWith('.bak') ||
    lower.endsWith('.tmp') ||
    lower.endsWith('.temp') ||
    lower.includes('undo-tree') ||
    lower === '.git' ||
    lower === '.hg' ||
    lower === '.svn' ||
    lower === 'node_modules';
}

function looksLikeSkippableFile(uri: string): boolean {
  const name = nameFromSafUri(uri);
  return name.includes('.') || shouldIgnoreSafName(name);
}

function getContentUriModule(): ContentUriModule | null {
  const globalWithModule = globalThis as typeof globalThis & {
    __postepContentUri?: ContentUriModule;
  };
  return globalWithModule.__postepContentUri ?? null;
}

function isGenericContentUri(uri: string): boolean {
  return uri.startsWith('content://') && !uri.startsWith('content://com.android.externalstorage');
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
