declare module 'expo-file-system' {
  export const StorageAccessFramework: {
    requestDirectoryPermissionsAsync: (
      initialUri?: string
    ) => Promise<{ granted: boolean; directoryUri?: string | null }>;
    persistPermissionsAsync: (uri: string) => Promise<void>;
    readDirectoryAsync: (uri: string) => Promise<string[]>;
    writeAsStringAsync: (uri: string, contents: string) => Promise<void>;
  };
}
