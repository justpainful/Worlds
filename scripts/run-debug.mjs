// Starts the debug build produced by `pnpm app`, wherever cargo put it.
import { execFileSync, spawn } from "node:child_process";
import { join } from "node:path";

const meta = JSON.parse(
  execFileSync("cargo", ["metadata", "--format-version", "1", "--no-deps", "--manifest-path", "src-tauri/Cargo.toml"], { encoding: "utf8" }),
);
const exe = join(meta.target_directory, "debug", process.platform === "win32" ? "worlds.exe" : "worlds");
spawn(exe, { detached: true, stdio: "ignore" }).unref();
