import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_DIST_DIR = path.join(REPO_ROOT, "dist");
const DEFAULT_PACKAGE_JSON = path.join(REPO_ROOT, "package.json");
const REQUIRED_CONTENT_SCRIPT = "content/content-main.js";
const REQUIRED_CONTENT_RUNTIME = "content/contentRuntimeBootstrap.js";

function fail(message) {
  throw new Error(message);
}

function readJson(filePath, label) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`${label} is missing or invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parsed;
}

function assertContained(root, target, label) {
  const relative = path.relative(root, target);
  if (!relative || relative === ".") return;
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail(`${label} resolves outside dist`);
  }
}

function resolveManifestPath(rawPath, label, distRoot) {
  if (typeof rawPath !== "string" || !rawPath.trim()) fail(`${label} must be a non-empty relative path`);
  if (rawPath.includes("\\") || rawPath.includes("\0") || rawPath.includes(":") || path.posix.isAbsolute(rawPath) || path.win32.isAbsolute(rawPath)) {
    fail(`${label} must be a safe relative path under dist`);
  }
  if (rawPath.split("/").includes("..")) fail(`${label} contains a path traversal segment`);
  if (/\.(?:ts|tsx)$/i.test(rawPath)) fail(`${label} points to a TypeScript source file`);

  const target = path.resolve(distRoot, ...rawPath.split("/"));
  assertContained(distRoot, target, label);
  return target;
}

function verifyFileReference(rawPath, label, distRoot, { concrete = true } = {}) {
  const target = resolveManifestPath(rawPath, label, distRoot);
  if (!concrete || /[*?{}]/.test(rawPath)) return false;
  if (!existsSync(target)) fail(`${label} does not exist in dist`);

  const realTarget = realpathSync(target);
  assertContained(realpathSync(distRoot), realTarget, label);
  const stats = statSync(realTarget);
  if (!stats.isFile() || stats.size === 0) fail(`${label} must be a non-empty file`);
  return true;
}

function verifyIconReferences(icons, label, distRoot, counts) {
  if (icons === undefined) return;
  const paths = typeof icons === "string" ? [icons] : icons && typeof icons === "object" ? Object.values(icons) : null;
  if (!paths || paths.length === 0) fail(`${label} must contain at least one icon path`);
  for (const iconPath of paths) {
    if (verifyFileReference(iconPath, label, distRoot)) counts.add(iconPath);
  }
}

export function verifyExtensionArtifact({ distDir = DEFAULT_DIST_DIR, packageJsonPath = DEFAULT_PACKAGE_JSON } = {}) {
  const resolvedDistDir = path.resolve(distDir);
  if (!existsSync(resolvedDistDir) || !statSync(resolvedDistDir).isDirectory()) fail("dist directory is missing");
  const distRoot = realpathSync(resolvedDistDir);
  const manifestPath = path.join(distRoot, "manifest.json");
  if (!existsSync(manifestPath)) fail("dist/manifest.json is missing");
  const manifest = readJson(manifestPath, "dist/manifest.json");
  const packageJson = readJson(path.resolve(packageJsonPath), "package.json");

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) fail("manifest must be a JSON object");
  if (manifest.manifest_version !== 3) fail("manifest_version must be 3");
  if (typeof packageJson.version !== "string" || manifest.version !== packageJson.version) {
    fail(`manifest version ${String(manifest.version)} does not match package version ${String(packageJson.version)}`);
  }

  const verifiedFiles = new Set();
  const backgroundPath = manifest.background?.service_worker;
  if (verifyFileReference(backgroundPath, "manifest.background.service_worker", distRoot)) verifiedFiles.add(backgroundPath);

  const popupPath = manifest.action?.default_popup;
  if (verifyFileReference(popupPath, "manifest.action.default_popup", distRoot)) verifiedFiles.add(popupPath);

  const sidePanelPath = manifest.side_panel?.default_path;
  if (verifyFileReference(sidePanelPath, "manifest.side_panel.default_path", distRoot)) verifiedFiles.add(sidePanelPath);

  const contentScripts = manifest.content_scripts;
  if (contentScripts !== undefined && !Array.isArray(contentScripts)) fail("manifest.content_scripts must be an array when present");
  let contentJsCount = 0;
  for (let index = 0; index < (contentScripts ?? []).length; index += 1) {
    const entry = contentScripts[index];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail(`manifest.content_scripts[${index}] must be an object`);
    for (const field of ["js", "css"]) {
      if (entry[field] === undefined) continue;
      if (!Array.isArray(entry[field])) fail(`manifest.content_scripts[${index}].${field} must be an array`);
      for (const resource of entry[field]) {
        const label = `manifest.content_scripts[${index}].${field} resource`;
        if (verifyFileReference(resource, label, distRoot)) verifiedFiles.add(resource);
        if (field === "js") contentJsCount += 1;
      }
    }
  }
  if (contentScripts?.length && contentJsCount === 0) fail("manifest.content_scripts must reference JavaScript when present");
  if (verifyFileReference(REQUIRED_CONTENT_SCRIPT, REQUIRED_CONTENT_SCRIPT, distRoot)) {
    verifiedFiles.add(REQUIRED_CONTENT_SCRIPT);
  }

  if (!manifest.icons || typeof manifest.icons !== "object" || Array.isArray(manifest.icons)) fail("manifest.icons must reference at least one icon");
  verifyIconReferences(manifest.icons, "manifest.icons icon", distRoot, verifiedFiles);
  verifyIconReferences(manifest.action?.default_icon, "manifest.action.default_icon icon", distRoot, verifiedFiles);

  if (!Array.isArray(manifest.web_accessible_resources)) fail("manifest.web_accessible_resources must be an array");
  let runtimeResourceReferenced = false;
  for (let index = 0; index < manifest.web_accessible_resources.length; index += 1) {
    const entry = manifest.web_accessible_resources[index];
    if (!entry || typeof entry !== "object" || !Array.isArray(entry.resources)) {
      fail(`manifest.web_accessible_resources[${index}].resources must be an array`);
    }
    for (const resource of entry.resources) {
      const label = `manifest.web_accessible_resources[${index}] resource`;
      const isConcrete = typeof resource === "string" && !/[*?{}]/.test(resource);
      if (verifyFileReference(resource, label, distRoot, { concrete: isConcrete })) verifiedFiles.add(resource);
      if (resource === REQUIRED_CONTENT_RUNTIME) runtimeResourceReferenced = true;
    }
  }
  if (!runtimeResourceReferenced) fail(`manifest.web_accessible_resources must include ${REQUIRED_CONTENT_RUNTIME}`);
  if (verifyFileReference(REQUIRED_CONTENT_RUNTIME, REQUIRED_CONTENT_RUNTIME, distRoot)) {
    verifiedFiles.add(REQUIRED_CONTENT_RUNTIME);
  }

  return {
    version: manifest.version,
    verifiedFileCount: verifiedFiles.size,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = verifyExtensionArtifact();
    console.log(`Verified dist extension artifact v${result.version} (${result.verifiedFileCount} referenced files).`);
  } catch (error) {
    console.error(`[verify-extension-artifact] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
