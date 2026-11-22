import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "chrome120",
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Large libraries get their own files so the app shell parses first and updates cache well.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\/](react|react-dom|scheduler)[\/]/.test(id)) return "vendor-react";
          if (/@tiptap|prosemirror/.test(id)) return "vendor-editor";
          if (/[\/](yjs|y-protocols|lib0|y-prosemirror)[\/]/.test(id)) return "vendor-sync";
          if (/[\/]katex[\/]/.test(id)) return "vendor-katex";
          return undefined;
        },
      },
    },
  },
});
