import { defineConfig } from "vitest/config";

// The checks and the page are plain code, so their tests run in Node.
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
