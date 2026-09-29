import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const EXPECTED_PERMISSIONS = ["activeTab", "scripting", "sidePanel", "storage"];
const EXPECTED_HOST_PERMISSIONS = ["http://*/*", "https://*/*"];
const FORBIDDEN_RUNTIME_MARKERS = ["chrome.debugger", "REAL_CLICK", "requestRealClick"];

function fail(message) {
  throw new Error(message);
}

function readManifest(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`${label} is missing or invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertExactSet(manifest, field, expected, label) {
  const actual = manifest[field] ?? [];
  if (!Array.isArray(actual) || actual.some((value) => typeof value !== "string")) {
    fail(`${label}.${field} must be an array of strings`);
  }
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  if (new Set(sortedActual).size !== sortedActual.length || JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
    fail(`${label}.${field} must equal ${JSON.stringify(sortedExpected)}; received ${JSON.stringify(sortedActual)}`);
  }
}

export function assertPermissionManifest(manifest, label = "manifest") {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) fail(`${label} must be a JSON object`);
  assertExactSet(manifest, "permissions", EXPECTED_PERMISSIONS, label);
  assertExactSet(manifest, "host_permissions", EXPECTED_HOST_PERMISSIONS, label);
  assertExactSet(manifest, "optional_permissions", [], label);
  assertExactSet(manifest, "optional_host_permissions", [], label);

  const resources = manifest.web_accessible_resources;
  if (!Array.isArray(resources) || resources.length !== 1 || !Array.isArray(resources[0]?.resources) || !resources[0].resources.includes("content/contentRuntimeBootstrap.js")) {
    fail(`${label}.web_accessible_resources must expose the content runtime bootstrap`);
  }
  assertExactSet({ matches: resources[0].matches }, "matches", EXPECTED_HOST_PERMISSIONS, `${label}.web_accessible_resources[0]`);
}

function walkJavaScript(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkJavaScript(target));
    else if (entry.isFile() && /\.(?:m?js|cjs)$/i.test(entry.name)) files.push(target);
  }
  return files;
}

export function assertNoRemovedAuthorityRuntimeReferences(distDir) {
  const files = walkJavaScript(distDir);
  const occurrences = [];
  for (const file of files) {
    const contents = readFileSync(file, "utf8");
    for (const marker of FORBIDDEN_RUNTIME_MARKERS) {
      if (contents.includes(marker)) occurrences.push(`${path.relative(distDir, file)}: ${marker}`);
    }
  }
  if (occurrences.length) fail(`Removed permission runtime references remain in dist: ${occurrences.join(", ")}`);
  return { filesScanned: files.length, forbiddenReferenceCount: 0 };
}

function assertNoRemovedAuthoritySourceReferences(sourceDir) {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile() && /\.(?:[cm]?[jt]sx?)$/i.test(entry.name) && !/\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(entry.name)) files.push(target);
    }
  };
  walk(sourceDir);
  const occurrences = [];
  for (const file of files) {
    const contents = readFileSync(file, "utf8");
    for (const marker of FORBIDDEN_RUNTIME_MARKERS) {
      if (contents.includes(marker)) occurrences.push(`${path.relative(sourceDir, file)}: ${marker}`);
    }
  }
  if (occurrences.length) fail(`Removed permission runtime references remain in source: ${occurrences.join(", ")}`);
}

export function verifyExtensionPermissions({ root = REPO_ROOT, requireDist = false } = {}) {
  const sourceManifest = readManifest(path.join(root, "src", "manifest.json"), "src/manifest.json");
  assertPermissionManifest(sourceManifest, "src/manifest.json");
  assertNoRemovedAuthoritySourceReferences(path.join(root, "src"));

  const distDir = path.join(root, "dist");
  if (requireDist && !existsSync(path.join(distDir, "manifest.json"))) fail("dist/manifest.json is required for the permission check");
  if (existsSync(path.join(distDir, "manifest.json"))) {
    const distManifest = readManifest(path.join(distDir, "manifest.json"), "dist/manifest.json");
    assertPermissionManifest(distManifest, "dist/manifest.json");
    if (JSON.stringify(distManifest.permissions ?? []) !== JSON.stringify(sourceManifest.permissions ?? [])
      || JSON.stringify(distManifest.host_permissions ?? []) !== JSON.stringify(sourceManifest.host_permissions ?? [])
      || JSON.stringify(distManifest.optional_permissions ?? []) !== JSON.stringify(sourceManifest.optional_permissions ?? [])
      || JSON.stringify(distManifest.optional_host_permissions ?? []) !== JSON.stringify(sourceManifest.optional_host_permissions ?? [])) {
      fail("dist manifest permission policy does not exactly match src/manifest.json");
    }
    const scan = assertNoRemovedAuthorityRuntimeReferences(distDir);
    return { sourceManifest, distManifest, scan };
  }
  return { sourceManifest, distManifest: null, scan: null };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = verifyExtensionPermissions({ requireDist: process.argv.includes("--require-dist") });
    const distText = result.distManifest ? `; dist runtime files scanned: ${result.scan.filesScanned}` : "; dist not present yet";
    console.log(`Verified source permission contract${distText}.`);
  } catch (error) {
    console.error(`[verify-extension-permissions] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
