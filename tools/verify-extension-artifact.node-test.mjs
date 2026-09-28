import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyExtensionArtifact } from "./verify-extension-artifact.mjs";

function makeValidArtifact() {
  const root = mkdtempSync(path.join(os.tmpdir(), "quiz-solver-artifact-test-"));
  const distDir = path.join(root, "dist");
  mkdirSync(path.join(distDir, "background"), { recursive: true });
  mkdirSync(path.join(distDir, "popup"), { recursive: true });
  mkdirSync(path.join(distDir, "sidepanel"), { recursive: true });
  mkdirSync(path.join(distDir, "content"), { recursive: true });
  for (const file of [
    "background/background.js",
    "popup/popup.html",
    "sidepanel/sidepanel.html",
    "content/content-main.js",
    "content/contentRuntimeBootstrap.js",
    "icon16.png",
    "icon48.png",
    "icon128.png",
  ]) {
    writeFileSync(path.join(distDir, file), "artifact", "utf8");
  }
  const packageJsonPath = path.join(root, "package.json");
  writeFileSync(packageJsonPath, JSON.stringify({ version: "0.2.0" }), "utf8");
  const manifest = {
    manifest_version: 3,
    version: "0.2.0",
    icons: { "16": "icon16.png", "48": "icon48.png", "128": "icon128.png" },
    action: { default_popup: "popup/popup.html", default_icon: { "16": "icon16.png" } },
    background: { service_worker: "background/background.js" },
    side_panel: { default_path: "sidepanel/sidepanel.html" },
    content_scripts: [{ js: ["content/content-main.js"], css: [] }],
    web_accessible_resources: [{ resources: ["content/contentRuntimeBootstrap.js"], matches: ["<all_urls>"] }],
  };
  const manifestPath = path.join(distDir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
  return { root, distDir, packageJsonPath, manifest, manifestPath };
}

test("verifies all concrete manifest resources in the final dist", () => {
  const fixture = makeValidArtifact();
  try {
    const result = verifyExtensionArtifact(fixture);
    assert.equal(result.version, "0.2.0");
    assert.equal(result.verifiedFileCount, 8);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("fails when a referenced artifact file is missing", () => {
  const fixture = makeValidArtifact();
  try {
    rmSync(path.join(fixture.distDir, "sidepanel/sidepanel.html"));
    assert.throws(() => verifyExtensionArtifact(fixture), /does not exist in dist/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("rejects manifest path traversal outside dist", () => {
  const fixture = makeValidArtifact();
  try {
    fixture.manifest.background.service_worker = "../secret.js";
    writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest), "utf8");
    assert.throws(() => verifyExtensionArtifact(fixture), /path traversal|outside dist/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("rejects a manifest version that differs from package.json", () => {
  const fixture = makeValidArtifact();
  try {
    fixture.manifest.version = "9.9.9";
    writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest), "utf8");
    assert.throws(() => verifyExtensionArtifact(fixture), /does not match package version/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
