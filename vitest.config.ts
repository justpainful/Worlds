import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Agent worktrees and the services have their own test runs.
    exclude: ["**/node_modules/**", "**/.claude/**", "services/**", "dist/**"],
  },
});
