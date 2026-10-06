import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: "admin-console",
  base: "/admin/",
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, "dist-admin"),
    emptyOutDir: true,
  },
});
