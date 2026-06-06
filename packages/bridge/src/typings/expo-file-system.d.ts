declare module 'expo-file-system' {
  export const EncodingType: {
    UTF8: string;
  };

  export function readAsStringAsync(
    uri: string,
    options?: { encoding?: string }
  ): Promise<string>;

  export const StorageAccessFramework: {
    requestDirectoryPermissionsAsync: (
      initialUri?: string
    ) => Promise<{ granted: boolean; directoryUri?: string | null }>;
    persistPermissionsAsync: (uri: string) => Promise<void>;
    readDirectoryAsync: (uri: string) => Promise<string[]>;
    writeAsStringAsync: (uri: string, contents: string) => Promise<void>;
  };
}
