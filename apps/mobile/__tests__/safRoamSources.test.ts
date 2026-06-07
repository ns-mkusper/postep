import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { OrgBridgeConfig } from "@postep/bridge";
import { loadRoamGraphForConfig } from "../lib/roamSources";

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
};

const roamRootUri = "content://com.google.android.apps.docs.storage/tree/roam";
const config: OrgBridgeConfig = { roots: [], roamRoots: [roamRootUri] };

afterEach(() => {
  delete globalThis.__postepContentUri;
});

describe("SAF-backed roam sources", () => {
  it("builds nodes and links from Google Drive content URI org-roam files", async () => {
    installDriveMock(
      new Map([
        [
          driveUri("20240706111627-windows.org"),
          `#+TITLE: Windows
#+FILETAGS: :os:desktop:
:PROPERTIES:
:ID: windows-id
:END:
Link to [[20240706163001-ffmpeg][FFmpeg]] and [[id:projects-id]].
`,
        ],
        [
          driveUri("20240706163001-ffmpeg.org"),
          `#+TITLE: FFmpeg
:PROPERTIES:
:ID: ffmpeg-id
:END:
* Notes :video:
`,
        ],
        [
          driveUri("20240707212545-projects.org"),
          `#+TITLE: Projects
:PROPERTIES:
:ID: projects-id
:END:
[[id:ffmpeg-id]]
`,
        ],
      ]),
    );

    const graph = await loadRoamGraphForConfig(config);

    assert.equal(graph.nodes.length, 3);
    assert.deepEqual(
      graph.nodes.map((node) => node.title),
      ["FFmpeg", "Projects", "Windows"],
    );
    assert.ok(
      graph.nodes.some(
        (node) =>
          node.id === "20240706111627-windows" &&
          node.tags.includes("desktop") &&
          node.tags.includes("os"),
      ),
    );
    assert.deepEqual(
      graph.links
        .map((link) => `${link.source}->${link.target}`)
        .sort(),
      [
        "20240706111627-windows->20240706163001-ffmpeg",
        "20240706111627-windows->20240707212545-projects",
        "20240707212545-projects->20240706163001-ffmpeg",
      ],
    );
  });
});

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
        entries: [
          ...[...docs.keys()].map((uri) => ({
            uri,
            name: uri.slice(uri.lastIndexOf("/") + 1),
          })),
          { uri: driveUri(".#lock.org"), name: ".#lock.org" },
          { uri: driveUri("notes.org~"), name: "notes.org~" },
          { uri: driveUri("image.png"), name: "image.png" },
        ],
        errors: [],
      };
    },
  };
}

function driveUri(name: string): string {
  return `content://com.google.android.apps.docs.storage/document/${name}`;
}
