import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import webExtension, { readJsonFile } from "vite-plugin-web-extension";
import path from "path";

export default defineConfig({
  root: "src",
  publicDir: path.resolve(__dirname, "src/icons"),
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
  },
  plugins: [
    react(),
    webExtension({
      manifest: () => {
        const pkg = readJsonFile("package.json");
        const mf  = readJsonFile("src/manifest.json");
        return { ...mf, version: pkg.version };
      },
      // The plugin validates against a remote schema by default, which makes production
      // builds flaky when SchemaStore rate-limits or is unreachable.
      skipManifestValidation: true,
      // sidepanel.html is already picked up via manifest's side_panel.default_path
      // Build the content bootstrap entry here; the heavy runtime module is
      // emitted as an ES module by vite.contentRuntime.config.ts so the stub
      // can dynamically import it inside the isolated world on demand.
      additionalInputs: [
        "content/content-main.ts",
      ],
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
