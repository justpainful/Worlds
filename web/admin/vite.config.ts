// The control dashboard at admin.enterworlds.space (docs/admin/PLAN.md).
// Build from the repository root: npx vite build --config web/admin/vite.config.ts
// Local: npx vite --config web/admin/vite.config.ts (VITE_IDENTITY_URL=http://localhost:8787)
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  base: "/",
  plugins: [react()],
  clearScreen: false,
  server: { port: 5179, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true, target: "chrome120", sourcemap: false },
});
