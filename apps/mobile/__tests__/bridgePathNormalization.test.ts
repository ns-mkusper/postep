import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  E2E_ORG_ROOT,
  listDocuments,
  loadDocument,
  normalizeLocalOrgPath,
  normalizeOrgBridgeConfig,
} from "@postep/bridge";

process.env.POSTEP_E2E = "1";
process.env.HOME = "/home/postep";

describe("bridge path normalization", () => {
  it("expands tilde roots before native bridge calls", () => {
    assert.equal(normalizeLocalOrgPath("~/drive/org"), "/home/postep/drive/org");
    assert.equal(normalizeLocalOrgPath("~"), "/home/postep");
    assert.deepEqual(normalizeOrgBridgeConfig({
      roots: ["~/drive/org"],
      roamRoots: ["~/drive/org/roam"],
    }), {
      roots: ["/home/postep/drive/org"],
      roamRoots: ["/home/postep/drive/org/roam"],
    });
  });

  it("leaves SAF and E2E virtual roots unchanged", () => {
    const safRoot = "content://com.google.android.apps.docs.storage/tree/org";
    assert.equal(normalizeLocalOrgPath(safRoot), safRoot);
    assert.equal(normalizeLocalOrgPath(E2E_ORG_ROOT), E2E_ORG_ROOT);
  });

  it("lists and loads documents when only org-roam roots are configured", () => {
    const docs = listDocuments({ roots: [], roamRoots: [E2E_ORG_ROOT] });
    assert.ok(docs.length > 0);
    const payload = loadDocument({ roots: [], roamRoots: [E2E_ORG_ROOT] }, docs[0].path);
    assert.equal(payload.path, docs[0].path);
    assert.match(payload.raw, /^\#\+TITLE:/m);
    assert.ok(payload.lexical.length > 0);
  });
});
