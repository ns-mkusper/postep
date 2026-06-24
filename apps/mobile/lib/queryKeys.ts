import type { OrgBridgeConfig } from "@postep/bridge";

const joinRoots = (roots?: string[]) => roots?.join(":") ?? "";

export function hasConfiguredOrgRoots(config: OrgBridgeConfig): boolean {
  return config.roots.length > 0 || (config.roamRoots?.length ?? 0) > 0;
}

export function documentsQueryKey(config: OrgBridgeConfig) {
  return ["documents", joinRoots(config.roots), joinRoots(config.roamRoots)] as const;
}

export function documentPreviewsQueryKey(
  config: OrgBridgeConfig,
  documentPaths?: string[],
) {
  return [
    "document-previews",
    documentPaths?.join(":") ?? "",
    joinRoots(config.roots),
    joinRoots(config.roamRoots),
  ] as const;
}

export function documentQueryKey(config: OrgBridgeConfig, path: string) {
  return [
    "document",
    path,
    joinRoots(config.roots),
    joinRoots(config.roamRoots),
  ] as const;
}

export function agendaQueryKey(config: OrgBridgeConfig) {
  return ["agenda", joinRoots(config.roots), joinRoots(config.roamRoots)] as const;
}

export function roamQueryKey(config: OrgBridgeConfig) {
  return ["roam", joinRoots(config.roots), joinRoots(config.roamRoots)] as const;
}
