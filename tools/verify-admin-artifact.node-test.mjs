import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyAdminArtifact } from "./verify-admin-artifact.mjs";

function makeValidArtifact() {
  const root = mkdtempSync(path.join(os.tmpdir(), "quiz-admin-artifact-test-"));
  const distAdminDir = path.join(root, "dist-admin");
  mkdirSync(path.join(distAdminDir, "assets"), { recursive: true });
  writeFileSync(
    path.join(distAdminDir, "index.html"),
    '<!doctype html><meta name="referrer" content="strict-origin"><link rel="stylesheet" href="/admin/assets/admin.css"><script type="module" src="/admin/assets/admin.js"></script>',
    "utf8",
  );
  writeFileSync(path.join(distAdminDir, "assets", "admin.js"), 'console.log("admin");\n', "utf8");
  writeFileSync(path.join(distAdminDir, "assets", "admin.css"), "body{display:block}\n", "utf8");
  return { root, distAdminDir };
}

test("ADMIN11B1-R1-ART-01 verifies a valid independent Admin artifact", () => {
  const fixture = makeValidArtifact();
  try {
    const result = verifyAdminArtifact({
      distAdminDir: fixture.distAdminDir,
      extensionDistDir: path.join(fixture.root, "dist"),
    });
    assert.equal(result.fileCount, 3);
    assert.equal(result.scriptCount, 1);
    assert.equal(result.referencedAssetCount, 2);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("ADMIN11B1-R1-ART-02 rejects missing referenced assets", () => {
  const fixture = makeValidArtifact();
  try {
    rmSync(path.join(fixture.distAdminDir, "assets", "admin.js"));
    assert.throws(
      () => verifyAdminArtifact({ distAdminDir: fixture.distAdminDir }),
      /does not exist in dist-admin/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("ADMIN11B1-R1-ART-03 requires at least one Admin JavaScript entry", () => {
  const fixture = makeValidArtifact();
  try {
    writeFileSync(
      path.join(fixture.distAdminDir, "index.html"),
      '<meta name="referrer" content="strict-origin"><link rel="stylesheet" href="/admin/assets/admin.css">',
      "utf8",
    );
    assert.throws(
      () => verifyAdminArtifact({ distAdminDir: fixture.distAdminDir }),
      /at least one \/admin\/ JS asset/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("ADMIN11B1-R1-ART-04 rejects an extension manifest in dist-admin", () => {
  const fixture = makeValidArtifact();
  try {
    writeFileSync(path.join(fixture.distAdminDir, "manifest.json"), "{}", "utf8");
    assert.throws(
      () => verifyAdminArtifact({ distAdminDir: fixture.distAdminDir }),
      /extension manifest/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("ADMIN11B1-R1-ART-05 rejects Admin credential markers", () => {
  const fixture = makeValidArtifact();
  try {
    writeFileSync(
      path.join(fixture.distAdminDir, "assets", "admin.js"),
      'const field = "adminToken";\n',
      "utf8",
    );
    assert.throws(
      () => verifyAdminArtifact({ distAdminDir: fixture.distAdminDir }),
      /admin credential field/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("ADMIN11B1-R1-ART-06 rejects the configured secret value", () => {
  const fixture = makeValidArtifact();
  try {
    writeFileSync(
      path.join(fixture.distAdminDir, "assets", "admin.js"),
      'const leak = "configured-secret-value";\n',
      "utf8",
    );
    assert.throws(
      () =>
        verifyAdminArtifact({
          distAdminDir: fixture.distAdminDir,
          forbiddenSecrets: [{ needle: "configured-secret-value", reason: "configured secret value" }],
        }),
      /configured secret value/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("ADMIN11B1-R1-ART-07 rejects Chrome extension runtime dependencies", () => {
  const fixture = makeValidArtifact();
  try {
    writeFileSync(
      path.join(fixture.distAdminDir, "assets", "admin.js"),
      "chrome.runtime.sendMessage({});\n",
      "utf8",
    );
    assert.throws(
      () => verifyAdminArtifact({ distAdminDir: fixture.distAdminDir }),
      /chrome extension runtime dependency/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("ADMIN11B1-R1-ART-08 rejects Admin shell leakage into extension dist", () => {
  const fixture = makeValidArtifact();
  const extensionDistDir = path.join(fixture.root, "dist");
  mkdirSync(extensionDistDir, { recursive: true });
  try {
    writeFileSync(path.join(extensionDistDir, "index.html"), "<html></html>", "utf8");
    assert.throws(
      () => verifyAdminArtifact({ distAdminDir: fixture.distAdminDir, extensionDistDir }),
      /must not contain the admin shell/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("ADMIN11B1-R1-ART-09 rejects a missing dist-admin directory", () => {
  assert.throws(
    () => verifyAdminArtifact({ distAdminDir: path.join(os.tmpdir(), "quiz-admin-artifact-missing-r1") }),
    /dist-admin directory is missing/,
  );
});


test("ADMIN11F-ART-10 rejects an Admin artifact that regresses the SPA referrer policy", () => {
  const fixture = makeValidArtifact();
  try {
    writeFileSync(
      path.join(fixture.distAdminDir, "index.html"),
      '<!doctype html><meta name="referrer" content="no-referrer"><script type="module" src="/admin/assets/admin.js"></script>',
      "utf8",
    );
    assert.throws(
      () => verifyAdminArtifact({ distAdminDir: fixture.distAdminDir }),
      /meta referrer=strict-origin/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
