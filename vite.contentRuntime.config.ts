import { defineConfig } from "vite";
import path from "path";

/**
 * The on-demand content runtime must be an ES module so the content-main
 * bootstrap stub can `import()` it inside the isolated world (MV3 requires the
 * file to also be listed under web_accessible_resources). The main build emits
 * content entries as IIFE for chrome.scripting, which cannot expose exports;
 * this companion build produces the ESM variant instead.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist/content"),
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, "src/content/contentRuntimeBootstrap.ts"),
      name: "contentRuntimeBootstrap",
      formats: ["es"],
      fileName: () => "contentRuntimeBootstrap.js",
    },
  },
  define: {
    // Vite skips NODE_ENV replacement for ES lib output; the browser context
    // that imports this module has no `process` global.
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});
