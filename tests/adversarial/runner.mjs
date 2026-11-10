#!/usr/bin/env node

/**
 * Adversarial Wire Protocol & Document Schema Stress Test Runner Harness
 *
 * Executes the adversarial stress test suite using Vitest.
 */

import { spawn } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");

console.log("\x1b[35m==========================================================\x1b[0m");
console.log("\x1b[33m Worlds Adversarial Wire Protocol & Schema Stress Runner\x1b[0m");
console.log("\x1b[35m==========================================================\x1b[0m");
console.log(`[Config] Project Root: ${projectRoot}`);
console.log("----------------------------------------------------------\n");

const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
const vitestArgs = ["vitest", "run", "--config", "tests/adversarial/vitest.config.ts"];

const child = spawn(npxCmd, vitestArgs, {
  cwd: projectRoot,
  stdio: "inherit",
  shell: true,
});

child.on("close", (code) => {
  if (code === 0) {
    console.log("\n\x1b[32m✔ All adversarial stress test suites passed successfully!\x1b[0m");
  } else {
    console.error(`\n\x1b[31m✖ Adversarial stress test suite failed with exit code ${code}\x1b[0m`);
  }
  process.exit(code ?? 1);
});
