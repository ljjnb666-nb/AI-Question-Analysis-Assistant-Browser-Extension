import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_DIST_DIR = path.join(REPO_ROOT, "dist");
const DEFAULT_ADMIN_DIR = path.join(REPO_ROOT, "dist-admin");
const DEFAULT_PACKAGE_JSON = path.join(REPO_ROOT, "package.json");
const DEFAULT_SOURCE_MANIFEST = path.join(REPO_ROOT, "src", "manifest.json");
const DEFAULT_DOCKERFILE = path.join(REPO_ROOT, "Dockerfile.analytics");
const DEFAULT_COMPOSE = path.join(REPO_ROOT, "docker-compose.analytics.prod.yml");
const DEFAULT_ANALYTICS_ARCHIVE = path.join(REPO_ROOT, "quiz-solver-analytics-image.tar.gz");
const DEFAULT_OUTPUT = path.join(REPO_ROOT, "rc-manifest.json");

function fail(message) {
  throw new Error(message);
}

function readJson(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`${label} is missing or invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizeRelative(filePath) {
  return filePath.split(path.sep).join("/");
}

function digestFile(filePath, label) {
  const resolved = path.resolve(filePath);
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    fail(`${label} is missing`);
  }
  const bytes = readFileSync(resolved);
  if (bytes.length === 0) fail(`${label} is empty`);
  return {
    fileName: path.basename(resolved),
    sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function digestTree(directory) {
  const root = path.resolve(directory);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    fail(`artifact directory is missing: ${root}`);
  }

  const rootReal = realpathSync(root);
  const files = [];

  function walk(current) {
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const stats = lstatSync(fullPath);
      if (stats.isSymbolicLink()) {
        fail(`artifact tree must not contain symlinks: ${normalizeRelative(path.relative(root, fullPath))}`);
      }
      if (stats.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!stats.isFile()) {
        fail(`artifact tree contains unsupported entry: ${normalizeRelative(path.relative(root, fullPath))}`);
      }
      const relative = normalizeRelative(path.relative(root, fullPath));
      const resolved = realpathSync(fullPath);
      if (resolved !== fullPath && !resolved.startsWith(`${rootReal}${path.sep}`)) {
        fail(`artifact file resolves outside tree: ${relative}`);
      }
      files.push({ relative, fullPath, size: stats.size });
    }
  }

  walk(root);
  files.sort((left, right) => left.relative.localeCompare(right.relative));
  if (files.length === 0) fail(`artifact directory is empty: ${root}`);

  const hash = createHash("sha256");
  for (const file of files) {
    hash.update("file\0");
    hash.update(file.relative);
    hash.update("\0");
    hash.update(String(file.size));
    hash.update("\0");
    hash.update(readFileSync(file.fullPath));
    hash.update("\0");
  }

  return {
    fileCount: files.length,
    sha256: hash.digest("hex"),
  };
}

function readPinnedToolchain(dockerfilePath, packageManager) {
  const dockerfile = readFileSync(dockerfilePath, "utf8");
  const baseMatch = dockerfile.match(/^ARG BASE_IMAGE=(\S+)$/m);
  if (!baseMatch) fail("Dockerfile.analytics must declare ARG BASE_IMAGE");
  const baseImage = baseMatch[1];
  const nodeMatch = baseImage.match(
    /^node:(\d+\.\d+\.\d+)-bookworm-slim@sha256:[a-f0-9]{64}$/,
  );
  if (!nodeMatch) {
    fail("analytics base image must pin an exact Node version and sha256 digest");
  }

  const managerMatch = String(packageManager || "").match(/^npm@(\d+\.\d+\.\d+)$/);
  if (!managerMatch) fail("packageManager must pin an exact npm version");
  const npmVersion = managerMatch[1];

  const dockerNpmPins = [
    ...dockerfile.matchAll(/npm install --global npm@(\d+\.\d+\.\d+)/g),
  ].map((match) => match[1]);
  if (dockerNpmPins.length < 2 || dockerNpmPins.some((version) => version !== npmVersion)) {
    fail("Dockerfile.analytics npm pins must match packageManager in all build stages");
  }

  return {
    baseImage,
    nodeVersion: nodeMatch[1],
    packageManager: `npm@${npmVersion}`,
  };
}
function readComposeDefaultImage(composePath, version) {
  const compose = readFileSync(composePath, "utf8");
  const match = compose.match(/^\s*image:\s*\$\{QUIZ_SOLVER_ANALYTICS_IMAGE:-([^}]+)\}\s*$/m);
  if (!match) {
    fail("production compose must expose QUIZ_SOLVER_ANALYTICS_IMAGE with a versioned default");
  }
  const expected = `quiz-solver-analytics:${version}`;
  if (match[1] !== expected) {
    fail(`production compose default image ${match[1]} does not match package version ${version}`);
  }
  return match[1];
}

export function createRcManifest({
  sourceSha,
  analyticsImageId,
  analyticsArchivePath = DEFAULT_ANALYTICS_ARCHIVE,
  distDir = DEFAULT_DIST_DIR,
  adminDir = DEFAULT_ADMIN_DIR,
  packageJsonPath = DEFAULT_PACKAGE_JSON,
  sourceManifestPath = DEFAULT_SOURCE_MANIFEST,
  dockerfilePath = DEFAULT_DOCKERFILE,
  composePath = DEFAULT_COMPOSE,
} = {}) {
  const normalizedSha = String(sourceSha || "").trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(normalizedSha)) {
    fail("sourceSha must be the exact 40-character Git commit SHA");
  }

  const normalizedImageId = String(analyticsImageId || "").trim().toLowerCase();
  if (!/^sha256:[a-f0-9]{64}$/.test(normalizedImageId)) {
    fail("analyticsImageId must be a sha256 Docker image ID");
  }

  const packageJson = readJson(path.resolve(packageJsonPath), "package.json");
  const sourceManifest = readJson(path.resolve(sourceManifestPath), "src/manifest.json");
  const distManifest = readJson(path.join(path.resolve(distDir), "manifest.json"), "dist/manifest.json");

  const version = String(packageJson.version || "").trim();
  if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(version)) {
    fail("package version must be a Chrome-compatible numeric version");
  }
  if (sourceManifest.version !== version) {
    fail(`source manifest version ${String(sourceManifest.version)} does not match package version ${version}`);
  }
  if (distManifest.version !== version) {
    fail(`built extension version ${String(distManifest.version)} does not match package version ${version}`);
  }
  if (distManifest.manifest_version !== 3) {
    fail("built extension manifest_version must be 3");
  }

  const extensionTree = digestTree(distDir);
  const adminTree = digestTree(adminDir);
  const analyticsArchive = digestFile(
    analyticsArchivePath,
    "analytics server image archive",
  );
  const toolchain = readPinnedToolchain(
    path.resolve(dockerfilePath),
    packageJson.packageManager,
  );
  const composeDefaultImage = readComposeDefaultImage(path.resolve(composePath), version);

  return {
    schemaVersion: 1,
    sourceSha: normalizedSha,
    version,
    extension: {
      manifestVersion: 3,
      version,
      treeSha256: extensionTree.sha256,
      fileCount: extensionTree.fileCount,
    },
    admin: {
      treeSha256: adminTree.sha256,
      fileCount: adminTree.fileCount,
    },
    toolchain: {
      node: toolchain.nodeVersion,
      packageManager: toolchain.packageManager,
    },
    analyticsServer: {
      imageId: normalizedImageId,
      archive: analyticsArchive,
      baseImage: toolchain.baseImage,
      composeDefaultImage,
    },
  };
}

export function writeRcManifest(options = {}, outputPath = DEFAULT_OUTPUT) {
  const manifest = createRcManifest(options);
  writeFileSync(path.resolve(outputPath), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const sourceSha = process.env.RC_SOURCE_SHA || process.env.GITHUB_SHA;
    const analyticsImageId = process.env.RC_ANALYTICS_IMAGE_ID;
    const analyticsArchivePath =
      process.env.RC_ANALYTICS_ARCHIVE_PATH || DEFAULT_ANALYTICS_ARCHIVE;
    const outputPath = process.env.RC_MANIFEST_PATH || DEFAULT_OUTPUT;
    const manifest = writeRcManifest(
      { sourceSha, analyticsImageId, analyticsArchivePath },
      outputPath,
    );
    console.log(
      `[rc-manifest] v${manifest.version} source=${manifest.sourceSha} extension=${manifest.extension.treeSha256} admin=${manifest.admin.treeSha256} server=${manifest.analyticsServer.imageId}`,
    );
  } catch (error) {
    console.error(`[rc-manifest] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
