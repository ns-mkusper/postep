import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { QueryClient } from "@tanstack/react-query";
import type { OrgBridgeConfig } from "@postep/bridge";
import { loadAgendaSnapshotForConfig } from "../lib/agendaSources";
import {
  clearDocumentSourceCache,
  getDocumentSourceStats,
  listDocumentsForConfig,
  loadDocumentForConfig,
  resetDocumentSourceStats,
} from "../lib/documentSources";
import { loadRoamGraphForConfig } from "../lib/roamSources";
import {
  clearWarmOrgCache,
  hydrateWarmOrgCache,
  refreshWarmOrgWorkspace,
} from "../lib/orgWarmCache";

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

const rootUri = "content://com.google.android.apps.docs.storage/document/perf-root";
const config: OrgBridgeConfig = { roots: [rootUri], roamRoots: [rootUri] };
const artifactPath = join(
  process.cwd(),
  "e2e-artifacts/performance/route-switching-before-after.json",
);

type RouteName = "Agenda" | "Habits" | "Roam" | "Library" | "Note";
type RouteMeasurement = {
  route: RouteName;
  elapsedMs: number;
  sourceReads: number;
  cacheHits: number;
  summary: Record<string, number>;
};
type RoutePairMeasurement = RouteMeasurement & { from: RouteName; to: RouteName };

afterEach(async () => {
  clearDocumentSourceCache();
  resetDocumentSourceStats();
  delete globalThis.__postepContentUri;
  if (globalThis.window?.localStorage) {
    await clearWarmOrgCache();
    delete globalThis.window;
  }
});

describe("warm route-switching performance", () => {
  it("serves Agenda, Habits, Roam, Library, and notes from the warm cache without source reads", async () => {
    const documentCount = 72;
    installDriveMock(makePerfDocs(documentCount), { readDelayMs: 2 });

    const routes = routeLoaders();
    const before = [] as RouteMeasurement[];
    for (const route of routes) {
      clearDocumentSourceCache();
      resetDocumentSourceStats();
      before.push(await measureRoute(route.name, route.load));
    }

    clearDocumentSourceCache();
    resetDocumentSourceStats();
    const warmStart = performance.now();
    for (const route of routes) {
      await route.load();
    }
    const warmElapsedMs = performance.now() - warmStart;
    const warmStats = getDocumentSourceStats();
    assert.ok(
      warmStats.listSourceReads > 0 && warmStats.documentSourceReads > 0,
      "warming should perform initial source reads",
    );

    resetDocumentSourceStats();
    const after = [] as RoutePairMeasurement[];
    for (const from of routes) {
      for (const to of routes) {
        if (from.name === to.name) {
          continue;
        }
        const measurement = await measureRoute(to.name, to.load);
        after.push({ ...measurement, from: from.name, to: to.name });
      }
    }

    const afterStats = getDocumentSourceStats();

    installLocalStorageMock();
    const indexedRefreshClient = new QueryClient();
    const indexedRefresh = await refreshWarmOrgWorkspace(indexedRefreshClient, config);
    const indexedRevalidation = await refreshWarmOrgWorkspace(indexedRefreshClient, config);
    clearDocumentSourceCache();
    resetDocumentSourceStats();
    const indexedHydrateClient = new QueryClient();
    const indexedHydrated = await hydrateWarmOrgCache(indexedHydrateClient, config);
    const indexedAfterRestart = [] as RoutePairMeasurement[];
    for (const from of routes) {
      for (const to of routes) {
        if (from.name === to.name) {
          continue;
        }
        const measurement = await measureRoute(to.name, to.load);
        indexedAfterRestart.push({ ...measurement, from: from.name, to: to.name });
      }
    }
    const indexedAfterStats = getDocumentSourceStats();
    const indexedAfterMaxMs = Math.max(...indexedAfterRestart.map((measurement) => measurement.elapsedMs));
    const indexedAfterMedianMs = percentile(
      indexedAfterRestart.map((measurement) => measurement.elapsedMs),
      0.5,
    );

    const maxAfterMs = Math.max(...after.map((measurement) => measurement.elapsedMs));
    const medianAfterMs = percentile(after.map((measurement) => measurement.elapsedMs), 0.5);
    const beforeByRoute = Object.fromEntries(
      before.map((measurement) => [measurement.route, measurement]),
    );
    const afterByRoute = Object.fromEntries(
      routes.map((route) => [
        route.name,
        percentile(
          after
            .filter((measurement) => measurement.to === route.name)
            .map((measurement) => measurement.elapsedMs),
          0.5,
        ),
      ]),
    );

    const artifact = {
      generatedAt: new Date().toISOString(),
      corpus: {
        documents: documentCount,
        sourceReadDelayMs: 2,
        routes: routes.map((route) => route.name),
      },
      beforeColdSourceBound: before,
      warmup: { elapsedMs: warmElapsedMs, stats: warmStats },
      afterWarmRoutePairs: after,
      indexedCacheAfterRestart: {
        refresh: indexedRefresh,
        revalidation: indexedRevalidation,
        hydrate: indexedHydrated,
        routePairs: indexedAfterRestart,
        stats: indexedAfterStats,
        medianMs: indexedAfterMedianMs,
        maxMs: indexedAfterMaxMs,
      },
      summary: {
        beforeColdSourceReads: before.reduce((total, measurement) => total + measurement.sourceReads, 0),
        afterWarmSourceReads: afterStats.listSourceReads + afterStats.documentSourceReads,
        afterWarmCacheHits: afterStats.listCacheHits + afterStats.documentCacheHits,
        afterWarmMedianMs: medianAfterMs,
        afterWarmMaxMs: maxAfterMs,
        indexedAfterRestartSourceReads:
          indexedAfterStats.listSourceReads + indexedAfterStats.documentSourceReads,
        indexedAfterRestartCacheHits:
          indexedAfterStats.listCacheHits + indexedAfterStats.documentCacheHits,
        indexedAfterRestartMedianMs: indexedAfterMedianMs,
        indexedAfterRestartMaxMs: indexedAfterMaxMs,
        indexedRefreshChangedDocuments: indexedRefresh.changedDocuments,
        indexedRefreshUnchangedDocuments: indexedRefresh.unchangedDocuments,
        indexedRevalidationChangedDocuments: indexedRevalidation.changedDocuments,
        indexedRevalidationUnchangedDocuments: indexedRevalidation.unchangedDocuments,
        beforeColdMsByRoute: Object.fromEntries(
          Object.entries(beforeByRoute).map(([route, measurement]) => [route, measurement.elapsedMs]),
        ),
        afterWarmMedianMsByRoute: afterByRoute,
      },
    };
    mkdirSync(join(process.cwd(), "e2e-artifacts/performance"), { recursive: true });
    writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);

    assert.equal(afterStats.listSourceReads, 0, "warm switches must not relist source roots");
    assert.equal(afterStats.documentSourceReads, 0, "warm switches must not reread source documents");
    assert.equal(indexedAfterStats.listSourceReads, 0, "indexed restart switches must not relist source roots");
    assert.equal(indexedAfterStats.documentSourceReads, 0, "indexed restart switches must not reread source documents");
    assert.ok(indexedHydrated.hydrated, "indexed warm cache should hydrate after restart");
    assert.ok(indexedRefresh.persistedDocuments > 0, "indexed warm cache should persist document payloads");
    assert.equal(
      indexedRevalidation.changedDocuments,
      0,
      "indexed warm cache revalidation should not rewrite unchanged documents",
    );
    assert.equal(
      indexedRevalidation.unchangedDocuments,
      documentCount,
      "indexed warm cache revalidation should count unchanged documents",
    );
    assert.ok(afterStats.listCacheHits > 0, "warm switches should hit the document-list cache");
    assert.ok(afterStats.documentCacheHits > 0, "warm switches should hit the document payload cache");
    assert.ok(maxAfterMs < 75, `warm route switch max ${maxAfterMs.toFixed(2)}ms exceeded 75ms`);
    assert.ok(
      indexedAfterMaxMs < 75,
      `indexed restart route switch max ${indexedAfterMaxMs.toFixed(2)}ms exceeded 75ms`,
    );
  });
});

function routeLoaders(): Array<{ name: RouteName; load: () => Promise<Record<string, number>> }> {
  return [
    {
      name: "Agenda",
      load: async () => {
        const snapshot = await loadAgendaSnapshotForConfig(config);
        return { items: snapshot.items.length, habits: snapshot.habits.length };
      },
    },
    {
      name: "Habits",
      load: async () => {
        const snapshot = await loadAgendaSnapshotForConfig(config);
        return { habits: snapshot.habits.length, items: snapshot.items.length };
      },
    },
    {
      name: "Roam",
      load: async () => {
        const graph = await loadRoamGraphForConfig(config);
        return { nodes: graph.nodes.length, links: graph.links.length };
      },
    },
    {
      name: "Library",
      load: async () => {
        const documents = await listDocumentsForConfig(config);
        const previews = await Promise.all(
          documents.slice(0, 24).map((doc) => loadDocumentForConfig(config, doc.path)),
        );
        return { documents: documents.length, previews: previews.length };
      },
    },
    {
      name: "Note",
      load: async () => {
        const [doc] = await listDocumentsForConfig(config);
        const payload = await loadDocumentForConfig(config, doc.path);
        return { lines: payload.raw.split("\n").length, nodes: payload.lexical.length };
      },
    },
  ];
}

async function measureRoute(
  route: RouteName,
  load: () => Promise<Record<string, number>>,
): Promise<RouteMeasurement> {
  const before = getDocumentSourceStats();
  const startedAt = performance.now();
  const summary = await load();
  const elapsedMs = performance.now() - startedAt;
  const after = getDocumentSourceStats();
  return {
    route,
    elapsedMs,
    sourceReads:
      after.listSourceReads - before.listSourceReads +
      after.documentSourceReads - before.documentSourceReads,
    cacheHits:
      after.listCacheHits - before.listCacheHits +
      after.documentCacheHits - before.documentCacheHits,
    summary,
  };
}

function makePerfDocs(count: number): Map<string, string> {
  return new Map(
    Array.from({ length: count }, (_unused, idx) => {
      const number = idx + 1;
      const padded = String(number).padStart(2, "0");
      const day = String((number % 28) + 1).padStart(2, "0");
      return [
        driveUri(`perf-${padded}.org`),
        `#+TITLE: Perf sample ${number}
:PROPERTIES:
:ID: perf-id-${number}
:END:
#+FILETAGS: :mobile:perf:
* TODO Agenda task ${number} :agenda:
SCHEDULED: <2026-06-${day} Tue 09:00 +1d>
Review [[id:perf-id-${(number % count) + 1}][next note]] and keep switching instant.

* TODO Habit ${number} :habit:mobile:
SCHEDULED: <2026-06-${day} Tue 07:30 ++1w>
:PROPERTIES:
:STYLE: habit
:END:
- [ ] open Postep
- [X] keep menus warm

* READ Library note ${number}
DEADLINE: <2026-07-${day} Wed 17:00>
Body text for library preview ${number} with [[perf-${padded}][self link]].
`,
      ];
    }),
  );
}

function installDriveMock(
  docs: Map<string, string>,
  options: { readDelayMs?: number } = {},
): void {
  globalThis.__postepContentUri = {
    async readAsString(uri: string) {
      if (options.readDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.readDelayMs));
      }
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
        entries: [
          ...[...docs.keys()].map((uri) => ({
            uri,
            name: uri.slice(uri.lastIndexOf("/") + 1),
          })),
          { uri: driveUri("notes.org~"), name: "notes.org~" },
          { uri: driveUri(".#lock.org"), name: ".#lock.org" },
          { uri: driveUri("image.png"), name: "image.png" },
        ],
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

function percentile(values: number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((sorted.length - 1) * quantile)),
  );
  return sorted[index];
}
