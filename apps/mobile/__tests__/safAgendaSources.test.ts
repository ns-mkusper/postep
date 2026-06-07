import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import { performance } from 'node:perf_hooks';

import {
  listDocumentsForConfig,
} from '../lib/documentSources';
import {
  loadAgendaSnapshotForConfig,
  setAgendaStatusForConfig,
} from '../lib/agendaSources';
import type { OrgBridgeConfig } from '@postep/bridge';

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
};

globalThis.performance = performance as unknown as Performance;

const rootUri = 'content://com.google.android.apps.docs.storage/document/root';
const config: OrgBridgeConfig = { roots: [rootUri], roamRoots: [] };

afterEach(() => {
  delete globalThis.__postepContentUri;
});

describe('SAF-backed agenda sources', () => {
  it('filters Google Drive SAF listings and Emacs temp files before rendering notes', async () => {
    installDriveMock(makeDriveDocs(8));

    const documents = await listDocumentsForConfig(config);

    assert.equal(documents.length, 8);
    assert.deepEqual(
      documents.map((doc) => doc.name),
      [
        'drive-01.org',
        'drive-02.org',
        'drive-03.org',
        'drive-04.org',
        'drive-05.org',
        'drive-06.org',
        'drive-07.org',
        'drive-08.org',
      ],
    );
  });

  it('loads a non-empty agenda from Google Drive content URIs inside the refresh goal', async () => {
    const { maxActiveReads } = installDriveMock(makeDriveDocs(48), {
      readDelayMs: 8,
    });
    const startedAt = performance.now();

    const snapshot = await loadAgendaSnapshotForConfig(config);
    const elapsedMs = performance.now() - startedAt;

    assert.equal(snapshot.items.length, 160);
    assert.equal(snapshot.habits.length, 16);
    assert.ok(snapshot.items.some((item) => item.title === 'Drive task 1'));
    assert.ok(snapshot.items.some((item) => item.kind === 'Floating'));
    assert.ok(
      snapshot.items.some(
        (item) =>
          item.title === 'Drive habit 3' &&
          item.repeater?.amount === 1 &&
          item.repeater.unit === 'Week',
      ),
    );
    assert.ok(maxActiveReads() <= 12, `read concurrency reached ${maxActiveReads()}`);
    assert.ok(elapsedMs < 10000, `SAF agenda refresh took ${elapsedMs}ms`);
  });

  it('skips unreadable Drive files and still returns the rest of the agenda', async () => {
    installDriveMock(makeDriveDocs(12), {
      brokenUris: new Set([driveUri('drive-05.org')]),
    });

    const snapshot = await loadAgendaSnapshotForConfig(config);

    assert.ok(snapshot.items.length > 0);
    assert.ok(!snapshot.items.some((item) => item.path.endsWith('drive-05.org')));
    assert.ok(snapshot.items.some((item) => item.path.endsWith('drive-06.org')));
  });

  it('writes agenda status changes back through the content URI writer', async () => {
    const { docs, writes } = installDriveMock(makeDriveDocs(3));
    const initial = await loadAgendaSnapshotForConfig(config);
    const item = initial.items.find((candidate) => candidate.title === 'Drive task 1');
    assert.ok(item);

    const updated = await setAgendaStatusForConfig(config, item, 'DONE');

    assert.equal(writes.length, 1);
    assert.match(docs.get(driveUri('drive-01.org')) ?? '', /^\* DONE Drive task 1/m);
    assert.ok(updated.items.some((candidate) => candidate.todo_keyword === 'DONE'));
  });
});

function makeDriveDocs(count: number): Map<string, string> {
  return new Map(
    Array.from({ length: count }, (_unused, idx) => {
      const number = idx + 1;
      const padded = String(number).padStart(2, '0');
      const day = String((number % 20) + 1).padStart(2, '0');
      const maybeHabit =
        number % 3 === 0
          ? `
* TODO Drive habit ${number} :habit:mobile:
SCHEDULED: <2026-06-${day} Tue 07:30 ++1w>
:PROPERTIES:
:STYLE: habit
:END:
- [ ] open Postep
`
          : '';
      return [
        driveUri(`drive-${padded}.org`),
        `#+TITLE: Drive sample ${number}
* TODO Drive task ${number}
SCHEDULED: <2026-06-${day} Tue 09:00 +1d>
Context for task ${number}.

* WAITING Drive deadline ${number}
DEADLINE: <2026-07-${day} Wed 17:00>
Follow up with the team.

* READ Drive floating ${number}
Read without a date.
${maybeHabit}`,
      ];
    }),
  );
}

function installDriveMock(
  docs: Map<string, string>,
  options: { readDelayMs?: number; brokenUris?: Set<string> } = {},
): {
  docs: Map<string, string>;
  writes: Array<{ uri: string; contents: string }>;
  maxActiveReads: () => number;
} {
  let activeReads = 0;
  let maxReads = 0;
  const writes: Array<{ uri: string; contents: string }> = [];
  globalThis.__postepContentUri = {
    async readAsString(uri: string) {
      activeReads += 1;
      maxReads = Math.max(maxReads, activeReads);
      try {
        if (options.readDelayMs) {
          await new Promise((resolve) => setTimeout(resolve, options.readDelayMs));
        }
        if (options.brokenUris?.has(uri)) {
          throw new Error('Drive read failed');
        }
        const raw = docs.get(uri);
        if (raw === undefined) {
          throw new Error(`Missing mock document ${uri}`);
        }
        return raw;
      } finally {
        activeReads -= 1;
      }
    },
    async writeAsString(uri: string, contents: string) {
      writes.push({ uri, contents });
      docs.set(uri, contents);
    },
    async listOrgFilesRecursively() {
      return {
        entries: [
          ...[...docs.keys()].map((uri) => ({
            uri,
            name: uri.slice(uri.lastIndexOf('/') + 1),
          })),
          { uri: driveUri('.#drive-lock.org'), name: '.#drive-lock.org' },
          { uri: driveUri('#autosave.org#'), name: '#autosave.org#' },
          { uri: driveUri('notes.org~'), name: 'notes.org~' },
          { uri: driveUri('agenda.bak'), name: 'agenda.bak' },
          { uri: driveUri('undo-tree-history.org'), name: 'undo-tree-history.org' },
          { uri: driveUri('image.png'), name: 'image.png' },
        ],
        errors: [],
      };
    },
  };
  return {
    docs,
    writes,
    maxActiveReads: () => maxReads,
  };
}

function driveUri(name: string): string {
  return `content://com.google.android.apps.docs.storage/document/${name}`;
}
