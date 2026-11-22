// The support site at support.enterworlds.space (docs/admin/PLAN.md, phase 2).
// Build from the repository root: node web/support/build-articles.mjs && npx vite build --config web/support/vite.config.ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  base: "/",
  plugins: [react()],
  clearScreen: false,
  server: { port: 5180, strictPort: true, fs: { allow: [fileURLToPath(new URL("..", import.meta.url)), fileURLToPath(new URL("../../node_modules", import.meta.url))] } },
  build: { outDir: "dist", emptyOutDir: true, target: "chrome120", sourcemap: false },
});
