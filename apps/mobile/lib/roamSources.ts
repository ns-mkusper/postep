import {
  loadRoamGraphAsync,
  type OrgBridgeConfig,
  type RoamGraph,
} from "@postep/bridge";

import {
  dedupeSourceList,
  isSafUri,
  listDocumentsForConfig,
  loadDocumentForConfig,
  normalizeSourceIdentity,
} from "./documentSources";

const ROAM_LOAD_CONCURRENCY = 12;
const ROAM_DOC_LOAD_TIMEOUT_MS = 2000;

type SafOrgFile = {
  uri: string;
  name: string;
};

export async function loadRoamGraphForConfig(
  config: OrgBridgeConfig,
): Promise<RoamGraph> {
  const nativeConfig = splitNativeConfig(config);
  const safRoamRoots = dedupeSourceList(config.roamRoots?.filter(isSafUri) ?? []);
  const graphs: RoamGraph[] = [];

  if (
    nativeConfig.roots.length > 0 ||
    (nativeConfig.roamRoots?.length ?? 0) > 0
  ) {
    graphs.push(await loadRoamGraphAsync(nativeConfig));
  }

  if (safRoamRoots.length > 0) {
    graphs.push(await loadSafRoamGraph(safRoamRoots));
  }

  return mergeGraphs(graphs);
}

function splitNativeConfig(config: OrgBridgeConfig): OrgBridgeConfig {
  const roots = dedupeSourceList(config.roots.filter((root) => !isSafUri(root)));
  const roamRoots = dedupeSourceList(config.roamRoots?.filter((root) => !isSafUri(root)) ?? []);
  return {
    roots,
    ...(roamRoots.length > 0 ? { roamRoots } : {}),
  };
}

async function loadSafRoamGraph(roots: string[]): Promise<RoamGraph> {
  const files = (await listDocumentsForConfig({ roots: [], roamRoots: roots })).map(
    (doc): SafOrgFile => ({ uri: doc.path, name: doc.name }),
  );

  const uniqueFiles = dedupeFiles(files);
  const documents = await mapConcurrent(
    uniqueFiles,
    ROAM_LOAD_CONCURRENCY,
    async (file) => {
      try {
        return {
          file,
          raw: (
            await withTimeout(
              loadDocumentForConfig({ roots: [], roamRoots: roots }, file.uri),
              ROAM_DOC_LOAD_TIMEOUT_MS,
              `${file.name} timed out after ${ROAM_DOC_LOAD_TIMEOUT_MS}ms`,
            )
          ).raw,
        };
      } catch (error) {
        console.warn("Postep roam document skipped", {
          name: file.name,
          path: file.uri,
          message: error instanceof Error ? error.message : String(error),
        });
        return { file, raw: null };
      }
    },
  );
  const aliasToNodeId = new Map<string, string>();
  for (const { file, raw } of documents) {
    const id = nodeIdFromName(file.name);
    aliasToNodeId.set(id, id);
    if (raw) {
      const orgId = orgIdFromOrg(raw);
      if (orgId) {
        aliasToNodeId.set(orgId, id);
      }
    }
  }
  const nodes = documents.map(({ file, raw }) => {
    const id = nodeIdFromName(file.name);
    return {
      id,
      title: raw ? titleFromOrg(raw) ?? id : id,
      path: file.uri,
      tags: raw ? tagsFromOrg(raw) : [],
    };
  });

  const seenLinks = new Set<string>();
  const links = documents.flatMap(({ file, raw }) => {
    if (!raw) {
      return [];
    }
    const source = nodeIdFromName(file.name);
    return extractLinks(raw)
      .map(normalizeLinkTarget)
      .map((target) => (target ? aliasToNodeId.get(target) : null))
      .filter((targetId): targetId is string => Boolean(targetId))
      .filter((targetId) => targetId !== source)
      .filter((targetId) => {
        const key = `${source}\u0000${targetId}`;
        if (seenLinks.has(key)) {
          return false;
        }
        seenLinks.add(key);
        return true;
      })
      .map((target) => ({ source, target }));
  });

  console.log("Postep SAF roam graph", {
    documents: documents.length,
    nodes: nodes.length,
    links: links.length,
  });

  return { nodes, links };
}

function mergeGraphs(graphs: RoamGraph[]): RoamGraph {
  const nodes = new Map<string, RoamGraph["nodes"][number]>();
  const links = new Map<string, RoamGraph["links"][number]>();

  for (const graph of graphs) {
    for (const node of graph.nodes) {
      nodes.set(node.id, node);
    }
    for (const link of graph.links) {
      links.set(`${link.source}\u0000${link.target}`, link);
    }
  }

  return {
    nodes: [...nodes.values()].sort((left, right) =>
      left.title.localeCompare(right.title),
    ),
    links: [...links.values()],
  };
}

function dedupeFiles(files: SafOrgFile[]): SafOrgFile[] {
  const byUri = new Map<string, SafOrgFile>();
  for (const file of files) {
    byUri.set(normalizeSourceIdentity(file.uri), file);
  }
  return [...byUri.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function nodeIdFromName(name: string): string {
  return name.replace(/\.org$/i, "");
}

function titleFromOrg(raw: string): string | null {
  const titleLine = raw
    .split("\n")
    .find((line) => /^#\+title:/i.test(line.trim()));
  return titleLine?.replace(/^#\+title:\s*/i, "").trim() || null;
}

function orgIdFromOrg(raw: string): string | null {
  const idLine = raw
    .split("\n")
    .find((line) => /^\s*:ID:\s+/i.test(line));
  return idLine?.replace(/^\s*:ID:\s*/i, "").trim() || null;
}

function tagsFromOrg(raw: string): string[] {
  const tags = new Set<string>();
  for (const line of raw.split("\n")) {
    const fileTags = line.match(/^#\+filetags:\s*(.+)$/i)?.[1];
    if (fileTags) {
      for (const tag of fileTags.match(/[^:\s]+/g) ?? []) {
        tags.add(tag);
      }
    }
    const headingTags = line.match(/\s:([A-Za-z0-9_@#%:]+):\s*$/)?.[1];
    if (headingTags) {
      for (const tag of headingTags.split(":").filter(Boolean)) {
        tags.add(tag);
      }
    }
  }
  return [...tags].sort((left, right) => left.localeCompare(right));
}

function extractLinks(raw: string): string[] {
  const links: string[] = [];
  const pattern = /\[\[([^\]]+)(?:\]\[[^\]]*)?\]\]/g;
  for (const line of raw.split("\n")) {
    for (const match of line.matchAll(pattern)) {
      if (match[1]) {
        links.push(match[1]);
      }
    }
  }
  return links;
}

function normalizeLinkTarget(target: string): string | null {
  const trimmed = target.trim();
  if (!trimmed || trimmed.startsWith("http:") || trimmed.startsWith("https:")) {
    return null;
  }
  const withoutScheme = trimmed
    .replace(/^id:/i, "")
    .replace(/^file:/i, "")
    .replace(/\.org(?:::.*)?$/i, "");
  return withoutScheme.split("#")[0]?.trim() || null;
}

async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await worker(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(label)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
