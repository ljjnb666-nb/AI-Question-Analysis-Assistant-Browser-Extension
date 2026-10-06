import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_DIST_ADMIN_DIR = path.join(REPO_ROOT, "dist-admin");
const DEFAULT_EXTENSION_DIST_DIR = path.join(REPO_ROOT, "dist");

const SCANNABLE_EXTENSIONS = new Set([".html", ".js", ".css", ".svg", ".json", ".map", ".txt"]);

// The browser Admin artifact must never carry the long-lived secret, the
// extension runtime, or credentials of any shape.
const FORBIDDEN_MARKERS = [
  { needle: "ANALYTICS_ADMIN_TOKEN", reason: "admin secret variable name" },
  { needle: "chrome-extension://", reason: "chrome extension runtime dependency" },
  { needle: "chrome.runtime", reason: "chrome extension runtime dependency" },
  { needle: "chrome.storage", reason: "chrome extension runtime dependency" },
  { needle: "adminToken", reason: "admin credential field in browser artifact" },
];

function fail(message) {
  throw new Error(message);
}

function listFilesRecursive(root) {
  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    const stats = statSync(current);
    if (stats.isDirectory()) {
      for (const entry of readdirSync(current)) stack.push(path.join(current, entry));
      continue;
    }
    files.push(current);
  }
  return files;
}

function collectLocalAssetReferences(html) {
  const references = new Set();
  const pattern = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let match = pattern.exec(html);
  while (match) {
    const reference = match[1];
    if (reference.startsWith("/admin/")) references.add(reference);
    match = pattern.exec(html);
  }
  return references;
}

function resolveReference(distAdminDir, reference) {
  const relative = reference.slice("/admin/".length).split(/[?#]/, 1)[0];
  if (!relative || relative.split("/").includes("..")) return null;
  return path.resolve(distAdminDir, ...relative.split("/"));
}

function collectForbiddenSecrets() {
  const secrets = [];
  const envToken = String(process.env.ANALYTICS_ADMIN_TOKEN || "").trim();
  if (envToken) secrets.push({ needle: envToken, reason: "configured ANALYTICS_ADMIN_TOKEN value" });
  return secrets;
}

export function verifyAdminArtifact({
  distAdminDir = DEFAULT_DIST_ADMIN_DIR,
  extensionDistDir = DEFAULT_EXTENSION_DIST_DIR,
  forbiddenSecrets = collectForbiddenSecrets(),
} = {}) {
  if (!existsSync(distAdminDir) || !statSync(distAdminDir).isDirectory()) {
    fail("dist-admin directory is missing (run npm run build:admin)");
  }

  const indexPath = path.join(distAdminDir, "index.html");
  if (!existsSync(indexPath)) fail("dist-admin/index.html is missing");
  const indexHtml = readFileSync(indexPath, "utf8");
  if (!indexHtml.trim()) fail("dist-admin/index.html is empty");

  const references = collectLocalAssetReferences(indexHtml);
  let scriptCount = 0;
  for (const reference of references) {
    if (/\.(js|mjs)(?:[?#]|$)/i.test(reference)) scriptCount += 1;
    const target = resolveReference(distAdminDir, reference);
    if (!target) fail(`admin asset reference ${reference} is unsafe`);
    if (!existsSync(target)) fail(`admin asset reference ${reference} does not exist in dist-admin`);
    if (statSync(target).size === 0) fail(`admin asset reference ${reference} is empty`);
  }
  if (scriptCount === 0) fail("dist-admin/index.html must reference at least one /admin/ JS asset");

  const allFiles = listFilesRecursive(distAdminDir);
  for (const file of allFiles) {
    if (path.basename(file) === "manifest.json") {
      fail("dist-admin must not contain an extension manifest.json");
    }
    const extension = path.extname(file).toLowerCase();
    if (!SCANNABLE_EXTENSIONS.has(extension)) continue;
    const content = readFileSync(file, "utf8");
    const markers = [...FORBIDDEN_MARKERS, ...forbiddenSecrets];
    for (const { needle, reason } of markers) {
      if (content.includes(needle)) {
        fail(`${path.relative(distAdminDir, file)} contains ${reason} (${needle})`);
      }
    }
  }

  // The two artifact boundaries must stay separated in both directions.
  if (existsSync(extensionDistDir) && statSync(extensionDistDir).isDirectory()) {
    if (existsSync(path.join(extensionDistDir, "index.html"))) {
      fail("extension dist/ must not contain the admin shell index.html");
    }
  }

  return { fileCount: allFiles.length, referencedAssetCount: references.size, scriptCount };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = verifyAdminArtifact();
    console.log(
      `Verified dist-admin artifact (${result.fileCount} files, ${result.referencedAssetCount} referenced assets).`,
    );
  } catch (error) {
    console.error(`[verify-admin-artifact] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
