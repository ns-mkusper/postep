import { NativeModules } from "react-native";

type ContentUriModule = {
  readAsString: (uri: string) => Promise<string>;
  writeAsString: (uri: string, contents: string) => Promise<void>;
  listOrgFilesRecursively?: (
    uri: string,
    maxDepth: number
  ) => Promise<{
    entries: Array<string | { uri: string; name: string }>;
    errors: Array<{ uri: string; message: string }>;
  }>;
};

const modules = NativeModules as typeof NativeModules & {
  PostepContentUri?: ContentUriModule;
};

(globalThis as typeof globalThis & { __postepContentUri?: ContentUriModule }).__postepContentUri =
  modules.PostepContentUri;
