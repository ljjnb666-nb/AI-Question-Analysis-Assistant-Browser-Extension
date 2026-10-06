import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adminDist = path.join(rootDir, "dist-admin");
const indexPath = path.join(adminDist, "index.html");

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

if (!existsSync(indexPath)) throw new Error("dist-admin/index.html is missing");

const files = walk(adminDist);
if (!files.some((file) => /assets[\\/].+\.js$/.test(file))) {
  throw new Error("admin JavaScript artifact is missing");
}
if (files.some((file) => path.basename(file) === "manifest.json")) {
  throw new Error("admin artifact must not contain an extension manifest");
}

const forbidden = [
  "ANALYTICS_ADMIN_TOKEN",
  "chrome.runtime",
  "chrome.storage",
  "chrome.tabs",
];
for (const file of files.filter((entry) => /\.(?:html|js|css)$/.test(entry))) {
  const text = readFileSync(file, "utf8");
  for (const marker of forbidden) {
    if (text.includes(marker)) throw new Error(`admin artifact contains forbidden marker: ${marker}`);
  }
}

console.log(`[verify-admin-artifact] verified ${files.length} files`);
