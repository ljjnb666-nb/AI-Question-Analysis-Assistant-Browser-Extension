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
    `<!doctype html><html lang="zh-CN"><head><title>Quiz Solver Admin Console</title>` +
      `<link rel="stylesheet" href="/admin/assets/admin-index.css">` +
      `<script type="module" src="/admin/assets/admin-index.js"></script></head>` +
      `<body><div id="admin-root"></div></body></html>`,
    "utf8",
  );
  writeFileSync(path.join(distAdminDir, "assets", "admin-index.js"), "console.log(\"admin\");\n", "utf8");
  writeFileSync(path.join(distAdminDir, "assets", "admin-index.css"), "#admin-root{display:block}\n", "utf8");
  writeFileSync(path.join(distAdminDir, "admin-login.css"), ".admin-login-panel{margin:0 auto}\n", "utf8");
  return { root, distAdminDir };
}

test("ADMIN11B1-22: verifies a well-formed admin artifact", () => {
  const fixture = makeValidArtifact();
  try {
    const result = verifyAdminArtifact({ distAdminDir: fixture.distAdminDir, extensionDistDir: path.join(fixture.root, "dist") });
    assert.ok(result.fileCount >= 4);
    assert.equal(result.scriptCount, 1);
    assert.equal(result.referencedAssetCount, 2);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("fails when index.html is missing", () => {
  const fixture = makeValidArtifact();
  try {
    rmSync(path.join(fixture.distAdminDir, "index.html"));
    assert.throws(() => verifyAdminArtifact({ distAdminDir: fixture.distAdminDir }), /index\.html is missing/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("fails when a referenced admin asset is missing", () => {
  const fixture = makeValidArtifact();
  try {
    rmSync(path.join(fixture.distAdminDir, "assets", "admin-index.js"));
    assert.throws(
      () => verifyAdminArtifact({ distAdminDir: fixture.distAdminDir }),
      /does not exist in dist-admin/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("fails when no JS asset is referenced", () => {
  const fixture = makeValidArtifact();
  try {
    writeFileSync(
      path.join(fixture.distAdminDir, "index.html"),
      `<link rel="stylesheet" href="/admin/assets/admin-index.css">`,
      "utf8",
    );
    assert.throws(() => verifyAdminArtifact({ distAdminDir: fixture.distAdminDir }), /at least one \/admin\/ JS asset/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("ADMIN11B1-24: rejects an extension manifest inside dist-admin", () => {
  const fixture = makeValidArtifact();
  try {
    writeFileSync(
      path.join(fixture.distAdminDir, "manifest.json"),
      JSON.stringify({ manifest_version: 3 }),
      "utf8",
    );
    assert.throws(() => verifyAdminArtifact({ distAdminDir: fixture.distAdminDir }), /manifest\.json/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("ADMIN11B1-12: rejects the admin secret literal inside the artifact", () => {
  const fixture = makeValidArtifact();
  try {
    writeFileSync(
      path.join(fixture.distAdminDir, "assets", "admin-index.js"),
      "const token = \"ANALYTICS_ADMIN_TOKEN\";\n",
      "utf8",
    );
    assert.throws(() => verifyAdminArtifact({ distAdminDir: fixture.distAdminDir }), /admin secret variable name/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("ADMIN11B1-12: rejects the configured admin secret value inside the artifact", () => {
  const fixture = makeValidArtifact();
  try {
    writeFileSync(
      path.join(fixture.distAdminDir, "assets", "admin-index.js"),
      "const leak = \"super-secret-value-123\";\n",
      "utf8",
    );
    assert.throws(
      () =>
        verifyAdminArtifact({
          distAdminDir: fixture.distAdminDir,
          forbiddenSecrets: [{ needle: "super-secret-value-123", reason: "configured secret value" }],
        }),
      /configured secret value/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("rejects chrome extension runtime dependencies inside the artifact", () => {
  const fixture = makeValidArtifact();
  try {
    writeFileSync(
      path.join(fixture.distAdminDir, "assets", "admin-index.js"),
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

test("ADMIN11B1-24: rejects the admin shell leaking into the extension artifact", () => {
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

test("fails when the dist-admin directory is missing entirely", () => {
  assert.throws(
    () => verifyAdminArtifact({ distAdminDir: path.join(os.tmpdir(), "quiz-admin-artifact-missing") }),
    /dist-admin directory is missing/,
  );
});
