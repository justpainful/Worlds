#!/usr/bin/env node

/**
 * Worlds Cross-Platform Opaque-Box E2E Test Runner Harness
 *
 * Provides a unified CLI test runner to execute and report on all 4 tiers
 * of opaque-box cross-platform tests across Desktop, Apple, and Android.
 *
 * Usage:
 *   node tests/e2e/runner.mjs
 *   node tests/e2e/runner.mjs --tier=1
 *   node tests/e2e/runner.mjs --tier=2
 *   node tests/e2e/runner.mjs --tier=3
 *   node tests/e2e/runner.mjs --tier=4
 *   node tests/e2e/runner.mjs --platform=desktop|apple|android|cross
 */

import { spawn } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");

const args = process.argv.slice(2);
let tierFilter = "all";
let platformFilter = "all";

for (const arg of args) {
  if (arg.startsWith("--tier=")) {
    tierFilter = arg.split("=")[1];
  } else if (arg.startsWith("--platform=")) {
    platformFilter = arg.split("=")[1];
  }
}

console.log("\x1b[36m==========================================================\x1b[0m");
console.log("\x1b[33m Worlds Cross-Platform Opaque-Box E2E Test Runner\x1b[0m");
console.log("\x1b[36m==========================================================\x1b[0m");
console.log(`[Config] Project Root: ${projectRoot}`);
console.log(`[Config] Tier Filter: ${tierFilter}`);
console.log(`[Config] Platform Filter: ${platformFilter}`);
console.log("----------------------------------------------------------\n");

// Determine which test files to include based on filters
const vitestArgs = ["vitest", "run", "--config", "tests/e2e/vitest.config.ts"];

if (tierFilter === "1") {
  if (platformFilter !== "all") {
    vitestArgs.push(`tests/e2e/tier1-features/${platformFilter}-features.test.ts`);
  } else {
    vitestArgs.push("tests/e2e/tier1-features");
  }
} else if (tierFilter === "2") {
  vitestArgs.push("tests/e2e/tier2-boundaries");
} else if (tierFilter === "3") {
  vitestArgs.push("tests/e2e/tier3-combinations");
} else if (tierFilter === "4") {
  vitestArgs.push("tests/e2e/tier4-scenarios");
} else if (platformFilter !== "all") {
  vitestArgs.push(`tests/e2e/tier1-features/${platformFilter}-features.test.ts`);
}

const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";

const child = spawn(npxCmd, vitestArgs, {
  cwd: projectRoot,
  stdio: "inherit",
  shell: true,
});

child.on("close", (code) => {
  if (code === 0) {
    console.log("\n\x1b[32m✔ All E2E test suites completed successfully!\x1b[0m");
  } else {
    console.error(`\n\x1b[31m✖ E2E test suite failed with exit code ${code}\x1b[0m`);
  }
  process.exit(code ?? 1);
});
