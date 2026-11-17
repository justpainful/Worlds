import { defineConfig } from "vitest/config";

// The edge is plain fetch code, so its tests run in Node.
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
