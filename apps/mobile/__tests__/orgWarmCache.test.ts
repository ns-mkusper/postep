import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { performance } from "node:perf_hooks";

import { QueryClient } from "@tanstack/react-query";
import type { OrgBridgeConfig } from "@postep/bridge";

import {
  clearDocumentSourceCache,
  getDocumentSourceStats,
  loadDocumentForConfig,
  resetDocumentSourceStats,
} from "../lib/documentSources";
import {
  clearWarmOrgCache,
  getWarmOrgCacheStatus,
  hydrateWarmOrgCache,
  refreshWarmOrgWorkspace,
} from "../lib/orgWarmCache";
import { documentsQueryKey, documentQueryKey, agendaQueryKey, roamQueryKey } from "../lib/queryKeys";

declare const globalThis: typeof global & {
  __postepContentUri?: {
    readAsString: (uri: string) => Promise<string>;
    writeAsString: (uri: string, contents: string) => Promise<void>;
    listOrgFilesRecursively: (
      uri: string,
      maxDepth: number,
    ) => Promise<{
      entries: Array<string | { uri: string; name: string }>;
      errors: Array<{ uri: string; message: string }>;
    }>;
  };
  performance?: Performance;
  window?: Window & typeof globalThis;
};

globalThis.performance = performance as unknown as Performance;

const rootUri = "content://com.google.android.apps.docs.storage/document/cache-root";
const config: OrgBridgeConfig = { roots: [rootUri], roamRoots: [rootUri] };

afterEach(async () => {
  clearDocumentSourceCache();
  resetDocumentSourceStats();
  delete globalThis.__postepContentUri;
  await clearWarmOrgCache();
  delete globalThis.window;
});

describe("indexed org warm cache", () => {
  it("persists metadata and hydrates a new QueryClient without source reads", async () => {
    installLocalStorageMock();
    installDriveMock(makeDocs(8));
    const queryClient = new QueryClient();

    const first = await refreshWarmOrgWorkspace(queryClient, config);
    assert.equal(first.changedDocuments, 8);
    assert.equal(first.unchangedDocuments, 0);
    assert.equal(first.persistedDocuments, 8);
    assert.equal(first.documents, 8);
    assert.ok(first.rootFingerprint);
    assert.ok(first.lastIndexedAt);

    const second = await refreshWarmOrgWorkspace(queryClient, config);
    assert.equal(second.changedDocuments, 0);
    assert.equal(second.unchangedDocuments, 8);
    assert.equal(second.persistedDocuments, 8);

    const status = await getWarmOrgCacheStatus(config);
    assert.equal(status.exists, true);
    assert.equal(status.documents, 8);
    assert.equal(status.payloads, 8);
    assert.ok(status.cacheAgeMs !== undefined);

    clearDocumentSourceCache();
    resetDocumentSourceStats();
    const restartedClient = new QueryClient();
    const hydrated = await hydrateWarmOrgCache(restartedClient, config);
    assert.equal(hydrated.hydrated, true);
    assert.equal(hydrated.documents, 8);
    assert.equal(hydrated.unchangedDocuments, 8);

    const documents = restartedClient.getQueryData(documentsQueryKey(config));
    const agenda = restartedClient.getQueryData(agendaQueryKey(config));
    const roam = restartedClient.getQueryData(roamQueryKey(config));
    assert.ok(Array.isArray(documents));
    assert.ok(agenda);
    assert.ok(roam);

    const payload = await loadDocumentForConfig(config, driveUri("cache-01.org"));
    assert.equal(payload.raw.includes("Cache sample 1"), true);
    assert.ok(restartedClient.getQueryData(documentQueryKey(config, payload.path)));
    const stats = getDocumentSourceStats();
    assert.equal(stats.listSourceReads + stats.documentSourceReads, 0);
    assert.ok(stats.documentCacheHits > 0);
  });

  it("clearWarmOrgCache removes indexed storage and query data", async () => {
    installLocalStorageMock();
    installDriveMock(makeDocs(3));
    const queryClient = new QueryClient();
    await refreshWarmOrgWorkspace(queryClient, config);
    assert.equal((await getWarmOrgCacheStatus(config)).exists, true);

    await clearWarmOrgCache(queryClient);

    assert.equal((await getWarmOrgCacheStatus(config)).exists, false);
    assert.equal(globalThis.window?.localStorage.length, 0);
    assert.equal(queryClient.getQueryCache().getAll().length, 0);
  });
});

function makeDocs(count: number): Map<string, string> {
  return new Map(
    Array.from({ length: count }, (_unused, idx) => {
      const number = idx + 1;
      const padded = String(number).padStart(2, "0");
      return [
        driveUri(`cache-${padded}.org`),
        `#+TITLE: Cache sample ${number}
:PROPERTIES:
:ID: cache-id-${number}
:END:
* TODO Cache task ${number}
SCHEDULED: <2026-06-${padded} Tue 09:00 +1d>
[[id:cache-id-${(number % count) + 1}][next]]

* TODO Cache habit ${number}
SCHEDULED: <2026-06-${padded} Tue 07:30 ++1w>
:PROPERTIES:
:STYLE: habit
:END:
`,
      ];
    }),
  );
}

function installDriveMock(docs: Map<string, string>): void {
  globalThis.__postepContentUri = {
    async readAsString(uri: string) {
      const raw = docs.get(uri);
      if (raw === undefined) {
        throw new Error(`Missing mock document ${uri}`);
      }
      return raw;
    },
    async writeAsString(uri: string, contents: string) {
      docs.set(uri, contents);
    },
    async listOrgFilesRecursively() {
      return {
        entries: [...docs.keys()].map((uri) => ({
          uri,
          name: uri.slice(uri.lastIndexOf("/") + 1),
        })),
        errors: [],
      };
    },
  };
}

function installLocalStorageMock(): void {
  const store = new Map<string, string>();
  const localStorage = {
    get length() {
      return store.size;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
  globalThis.window = { localStorage } as Window & typeof globalThis;
}

function driveUri(name: string): string {
  return `content://com.google.android.apps.docs.storage/document/${name}`;
}
