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
      // sidepanel.html is already picked up via manifest's side_panel.default_path
      // Only add content-main here (not in manifest)
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
