import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distAdminDir = path.join(rootDir, "dist-admin");
const viteBin = path.join(rootDir, "node_modules", "vite", "bin", "vite.js");

const result = spawnSync(process.execPath, [viteBin, "build", "-c", "vite.admin.config.ts"], {
  cwd: rootDir,
  stdio: "inherit",
  shell: false,
});

if (result.status !== 0) {
  console.error(`[build-admin] vite exited with status ${result.status ?? "unknown"}.`);
  process.exit(result.status ?? 1);
}

if (!existsSync(path.join(distAdminDir, "index.html"))) {
  console.error("[build-admin] dist-admin/index.html is missing after build.");
  process.exit(1);
}

console.log("[build-admin] Wrote dist-admin/index.html");
