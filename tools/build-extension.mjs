import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const manifestSrcPath = path.join(rootDir, "src", "manifest.json");
const packageJsonPath = path.join(rootDir, "package.json");

function normalizeJsonText(raw) {
  return raw.replace(/^\uFEFF/, "");
}

function buildFallbackManifest() {
  const pkg = JSON.parse(normalizeJsonText(readFileSync(packageJsonPath, "utf8")));
  const srcManifest = JSON.parse(normalizeJsonText(readFileSync(manifestSrcPath, "utf8")));

  const manifest = {
    ...srcManifest,
    version: pkg.version,
    background: {
      ...srcManifest.background,
      service_worker: "background/background.js",
    },
    content_scripts: Array.isArray(srcManifest.content_scripts)
      ? srcManifest.content_scripts.map((entry) => ({
          ...entry,
          js: ["content/content-main.js"],
        }))
      : [],
    action: {
      ...srcManifest.action,
      default_popup: "popup/popup.html",
    },
    side_panel: {
      ...srcManifest.side_panel,
      default_path: "sidepanel/sidepanel.html",
    },
  };

  mkdirSync(distDir, { recursive: true });
  const manifestOutPath = path.join(distDir, "manifest.json");
  writeFileSync(manifestOutPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  if (!existsSync(manifestOutPath)) {
    throw new Error("Failed to write dist/manifest.json");
  }
}

function hasBuiltArtifacts() {
  const required = [
    path.join(distDir, "content", "content-main.js"),
    path.join(distDir, "background", "background.js"),
    path.join(distDir, "popup", "popup.html"),
    path.join(distDir, "sidepanel", "sidepanel.html"),
  ];
  return required.every((filePath) => existsSync(filePath));
}

const viteBin = path.join(rootDir, "node_modules", "vite", "bin", "vite.js");
const result = spawnSync(process.execPath, [viteBin, "build"], {
  cwd: rootDir,
  stdio: "inherit",
  shell: false,
});

if (result.status === 0) {
  buildFallbackManifest();
  if (!existsSync(path.join(distDir, "manifest.json"))) {
    console.error("[build-extension] dist/manifest.json is missing after build.");
    process.exit(1);
  }
  console.log("[build-extension] Wrote dist/manifest.json");
  process.exit(0);
}

if (hasBuiltArtifacts()) {
  console.error(
    `[build-extension] vite exited with status ${result.status ?? "unknown"}${result.signal ? ` (signal: ${result.signal})` : ""}. ` +
      "Partial dist artifacts were generated, but the build is treated as failed.",
  );
}

process.exit(result.status ?? 1);
