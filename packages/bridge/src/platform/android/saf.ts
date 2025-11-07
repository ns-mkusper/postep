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

async function loadSafModule() {
  const { StorageAccessFramework } = await import('expo-file-system');
  return StorageAccessFramework as SafModule;
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

export async function writeOrgFile(uri: string, contents: string): Promise<SafWriteResult> {
  const saf = await loadSafModule();
  await saf.writeAsStringAsync(uri, contents);
  return { uri, bytesWritten: utf8Length(contents) };
}

function utf8Length(value: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).length;
  }
  return value.length;
}
