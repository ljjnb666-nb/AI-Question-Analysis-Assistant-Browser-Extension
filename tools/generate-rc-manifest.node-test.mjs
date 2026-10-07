import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRcManifest, digestTree } from "./generate-rc-manifest.mjs";

function writeFixtureFile(root, relative, content) {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function makeFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "quiz-solver-rc-manifest-"));
  const distDir = path.join(root, "dist");
  const adminDir = path.join(root, "dist-admin");
  mkdirSync(distDir, { recursive: true });
  mkdirSync(adminDir, { recursive: true });

  writeFixtureFile(distDir, "manifest.json", JSON.stringify({ manifest_version: 3, version: "0.2.0" }));
  writeFixtureFile(distDir, "background/background.js", "console.log('background');");
  writeFixtureFile(adminDir, "index.html", "<!doctype html><title>Admin</title>");
  writeFixtureFile(adminDir, "assets/app.js", "console.log('admin');");

  const packageJsonPath = path.join(root, "package.json");
  const sourceManifestPath = path.join(root, "src-manifest.json");
  const dockerfilePath = path.join(root, "Dockerfile.analytics");
  const composePath = path.join(root, "docker-compose.analytics.prod.yml");

  writeFileSync(packageJsonPath, JSON.stringify({ version: "0.2.0", packageManager: "npm@11.6.2" }), "utf8");
  writeFileSync(
    sourceManifestPath,
    JSON.stringify({ manifest_version: 3, version: "0.2.0" }),
    "utf8",
  );
  writeFileSync(
    dockerfilePath,
    "ARG BASE_IMAGE=node:24.21.0-bookworm-slim@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\nFROM ${BASE_IMAGE}\nRUN npm install --global npm@11.6.2\nFROM ${BASE_IMAGE}\nRUN npm install --global npm@11.6.2\n",
    "utf8",
  );
  writeFileSync(
    composePath,
    "services:\n  analytics-server:\n    image: ${QUIZ_SOLVER_ANALYTICS_IMAGE:-quiz-solver-analytics:0.2.0}\n",
    "utf8",
  );

  return {
    root,
    distDir,
    adminDir,
    packageJsonPath,
    sourceManifestPath,
    dockerfilePath,
    composePath,
  };
}

function createOptions(fixture, overrides = {}) {
  return {
    sourceSha: "a".repeat(40),
    analyticsImageId: `sha256:${"b".repeat(64)}`,
    distDir: fixture.distDir,
    adminDir: fixture.adminDir,
    packageJsonPath: fixture.packageJsonPath,
    sourceManifestPath: fixture.sourceManifestPath,
    dockerfilePath: fixture.dockerfilePath,
    composePath: fixture.composePath,
    ...overrides,
  };
}

test("RC12A-01 binds source SHA, both artifact trees, version, and server image identity", () => {
  const fixture = makeFixture();
  try {
    const manifest = createRcManifest(createOptions(fixture));
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.sourceSha, "a".repeat(40));
    assert.equal(manifest.version, "0.2.0");
    assert.deepEqual(manifest.toolchain, {
      node: "24.21.0",
      packageManager: "npm@11.6.2",
    });
    assert.equal(manifest.extension.manifestVersion, 3);
    assert.equal(manifest.extension.version, "0.2.0");
    assert.match(manifest.extension.treeSha256, /^[a-f0-9]{64}$/);
    assert.equal(manifest.extension.fileCount, 2);
    assert.match(manifest.admin.treeSha256, /^[a-f0-9]{64}$/);
    assert.equal(manifest.admin.fileCount, 2);
    assert.equal(manifest.analyticsServer.imageId, `sha256:${"b".repeat(64)}`);
    assert.match(
      manifest.analyticsServer.baseImage,
      /^node:24\.21\.0-bookworm-slim@sha256:[a-f0-9]{64}$/,
    );
    assert.equal(manifest.analyticsServer.composeDefaultImage, "quiz-solver-analytics:0.2.0");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("RC12A-02 tree digest is stable across creation order and changes with content", () => {
  const left = mkdtempSync(path.join(os.tmpdir(), "quiz-solver-rc-tree-left-"));
  const right = mkdtempSync(path.join(os.tmpdir(), "quiz-solver-rc-tree-right-"));
  try {
    writeFixtureFile(left, "b/file.txt", "two");
    writeFixtureFile(left, "a/file.txt", "one");
    writeFixtureFile(right, "a/file.txt", "one");
    writeFixtureFile(right, "b/file.txt", "two");

    const first = digestTree(left);
    const second = digestTree(right);
    assert.deepEqual(first, second);

    writeFixtureFile(right, "b/file.txt", "changed");
    assert.notEqual(digestTree(right).sha256, first.sha256);
  } finally {
    rmSync(left, { recursive: true, force: true });
    rmSync(right, { recursive: true, force: true });
  }
});

test("RC12A-03 rejects SHA drift and source/build version drift", () => {
  const fixture = makeFixture();
  try {
    assert.throws(
      () => createRcManifest(createOptions(fixture, { sourceSha: "short" })),
      /exact 40-character Git commit SHA/,
    );

    writeFileSync(
      fixture.sourceManifestPath,
      JSON.stringify({ manifest_version: 3, version: "0.1.9" }),
      "utf8",
    );
    assert.throws(
      () => createRcManifest(createOptions(fixture)),
      /source manifest version .* does not match package version/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("RC12A-04 rejects floating base images and stale production compose version tags", () => {
  const fixture = makeFixture();
  try {
    writeFileSync(fixture.dockerfilePath, "ARG BASE_IMAGE=node:24-bookworm-slim\n", "utf8");
    assert.throws(
      () => createRcManifest(createOptions(fixture)),
      /pin an exact Node version and sha256 digest/,
    );

    writeFileSync(
      fixture.dockerfilePath,
      "ARG BASE_IMAGE=node:24.21.0-bookworm-slim@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\nRUN npm install --global npm@11.6.2\nRUN npm install --global npm@11.6.2\n",
      "utf8",
    );
    writeFileSync(
      fixture.composePath,
      "services:\n  analytics-server:\n    image: ${QUIZ_SOLVER_ANALYTICS_IMAGE:-quiz-solver-analytics:phase11}\n",
      "utf8",
    );
    assert.throws(
      () => createRcManifest(createOptions(fixture)),
      /does not match package version 0\.2\.0/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});


test("RC12A-05 rejects npm toolchain drift between package authority and container stages", () => {
  const fixture = makeFixture();
  try {
    writeFileSync(
      fixture.dockerfilePath,
      "ARG BASE_IMAGE=node:24.21.0-bookworm-slim@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\nRUN npm install --global npm@11.19.0\nRUN npm install --global npm@11.19.0\n",
      "utf8",
    );
    assert.throws(
      () => createRcManifest(createOptions(fixture)),
      /npm pins must match packageManager/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
