import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Independent Admin console build target inside the same repository. The
// extension artifact (dist/) and the admin artifact (dist-admin/) stay two
// separate boundaries; the console is deployed same-origin under /admin/ by
// the analytics server and must never depend on Chrome APIs.
export default defineConfig({
  root: path.resolve(__dirname, "admin-console"),
  base: "/admin/",
  publicDir: "public",
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, "dist-admin"),
    emptyOutDir: true,
    sourcemap: false,
  },
});
