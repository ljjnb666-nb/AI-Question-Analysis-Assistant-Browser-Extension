import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertNoRemovedAuthorityRuntimeReferences, assertPermissionManifest } from "./verify-extension-permissions.mjs";

function validManifest() {
  return {
    manifest_version: 3,
    permissions: ["activeTab", "scripting", "sidePanel", "storage"],
    host_permissions: ["http://*/*", "https://*/*"],
    optional_permissions: [],
    optional_host_permissions: [],
    web_accessible_resources: [{
      resources: ["content/contentRuntimeBootstrap.js"],
      matches: ["http://*/*", "https://*/*"],
    }],
  };
}

test("P_REL_PERM_01_NO_DEBUGGER_AUTHORITY rejects debugger permission and runtime markers", () => {
  const manifest = validManifest();
  manifest.permissions.push("debugger");
  assert.throws(() => assertPermissionManifest(manifest), /permissions must equal/);

  const distDir = mkdtempSync(path.join(os.tmpdir(), "quiz-solver-permission-dist-"));
  try {
    writeFileSync(path.join(distDir, "background.js"), "chrome.debugger.attach();", "utf8");
    assert.throws(() => assertNoRemovedAuthorityRuntimeReferences(distDir), /chrome\.debugger/);
  } finally {
    rmSync(distDir, { recursive: true, force: true });
  }
});

test("P_REL_PERM_05_PERMISSION_MANIFEST_CONTRACT accepts only the explicit permission and site policy", () => {
  assert.doesNotThrow(() => assertPermissionManifest(validManifest(), "source"));

  const narrowedSiteScope = validManifest();
  narrowedSiteScope.host_permissions = ["https://learn.example/*"];
  assert.throws(() => assertPermissionManifest(narrowedSiteScope), /host_permissions must equal/);

  const hiddenOptionalPermission = validManifest();
  hiddenOptionalPermission.optional_permissions = ["tabs"];
  assert.throws(() => assertPermissionManifest(hiddenOptionalPermission), /optional_permissions must equal/);
});

test("P_REL_PERM_06_DIST_PERMISSION_CONTRACT checks final dist permissions and serialized runtime", () => {
  const distDir = mkdtempSync(path.join(os.tmpdir(), "quiz-solver-permission-contract-"));
  try {
    mkdirSync(path.join(distDir, "content"), { recursive: true });
    const manifestPath = path.join(distDir, "manifest.json");
    writeFileSync(manifestPath, JSON.stringify(validManifest()), "utf8");
    writeFileSync(path.join(distDir, "content", "main.js"), "export {};", "utf8");

    assert.doesNotThrow(() => assertPermissionManifest(JSON.parse(readFileSync(manifestPath, "utf8")), "dist"));
    assert.equal(assertNoRemovedAuthorityRuntimeReferences(distDir).forbiddenReferenceCount, 0);

    writeFileSync(manifestPath, JSON.stringify({ ...validManifest(), permissions: ["scripting", "sidePanel", "storage", "tabs"] }), "utf8");
    assert.throws(() => assertPermissionManifest(JSON.parse(readFileSync(manifestPath, "utf8")), "dist"), /permissions must equal/);

    writeFileSync(path.join(distDir, "content", "main.js"), "const stale = 'REAL_CLICK';", "utf8");
    assert.throws(() => assertNoRemovedAuthorityRuntimeReferences(distDir), /REAL_CLICK/);
  } finally {
    rmSync(distDir, { recursive: true, force: true });
  }
});
