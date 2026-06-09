import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveDocumentPath } from "../lib/documentSources";

const drivePaths = [
  "content://com.google.android.apps.docs.storage/document/acc%3D1%3Bdoc%3Dencoded%3D123",
  "content://com.android.externalstorage.documents/document/primary%3ANotes%2Froam%2Finbox.org",
  "/home/user/org/plain.org",
];

describe("resolveDocumentPath", () => {
  it("returns an exact listing match unchanged", () => {
    assert.equal(
      resolveDocumentPath(drivePaths[1], drivePaths),
      drivePaths[1],
    );
    assert.equal(
      resolveDocumentPath("/home/user/org/plain.org", drivePaths),
      "/home/user/org/plain.org",
    );
  });

  it("recovers a SAF URI that was URL-decoded by router params", () => {
    const decodedOnce =
      "content://com.android.externalstorage.documents/document/primary:Notes/roam/inbox.org";
    assert.equal(resolveDocumentPath(decodedOnce, drivePaths), drivePaths[1]);
  });

  it("recovers a Google Drive URI with = escapes decoded", () => {
    const decodedOnce =
      "content://com.google.android.apps.docs.storage/document/acc=1;doc=encoded=123";
    assert.equal(resolveDocumentPath(decodedOnce, drivePaths), drivePaths[0]);
  });

  it("returns null when the request matches nothing", () => {
    assert.equal(
      resolveDocumentPath("content://gone/document/missing.org", drivePaths),
      null,
    );
  });

  it("skips listing paths with malformed percent escapes instead of throwing", () => {
    const paths = ["content://broken/document/100%legit.org", ...drivePaths];
    assert.equal(
      resolveDocumentPath(
        "content://com.android.externalstorage.documents/document/primary:Notes/roam/inbox.org",
        paths,
      ),
      drivePaths[1],
    );
  });
});
