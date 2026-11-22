/**
 * Updates for Worlds on Windows (src-tauri/src/app_update.rs). A while after
 * start and every six hours, Worlds asks the account service for a newer
 * version; testers get the beta channel. With automatic updates on (the
 * default) it downloads and verifies the installer in the background, then
 * a notice offers to restart into the new version.
 */
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { appPlatform } from "../appVersion";
import { useStore } from "../state/store";
import { useService } from "./service";

export interface AppUpdate {
  version: string;
  current: string;
  notes: string | null;
  date: string | null;
}

type Phase = "idle" | "checking" | "downloading" | "ready" | "installing" | "uptodate" | "failed";

export const useAppUpdate = create<{ phase: Phase; update: AppUpdate | null; error: string | null; checkedAt: number | null; dismissed: string | null }>(() => ({
  phase: "idle",
  update: null,
  error: null,
  checkedAt: null,
  dismissed: null,
}));

export const AUTO_UPDATES = "updates.auto";
export const updatesSupported = () => appPlatform() === "windows";
const autoOn = () => useStore.getState().settings[AUTO_UPDATES] !== false;
const channel = () => (useService.getState().config?.tester ? "beta" : "stable");

function call<T>(action: string): Promise<T> {
  return invoke<T>("app_update", { action, channel: channel() });
}

/** Look for a newer version; with automatic updates on, fetch it too. */
export async function checkForUpdate(manual = false): Promise<void> {
  const st = useAppUpdate.getState();
  if (!updatesSupported() || st.phase === "checking" || st.phase === "downloading" || st.phase === "installing") return;
  useAppUpdate.setState({ phase: "checking", error: null });
  try {
    const update = await call<AppUpdate | null>("check");
    useAppUpdate.setState({ update, checkedAt: Date.now(), phase: update ? "idle" : "uptodate" });
    if (update && (autoOn() || manual)) await downloadUpdate();
  } catch (e) {
    useAppUpdate.setState({ phase: "failed", error: String(e), checkedAt: Date.now() });
  }
}

export async function downloadUpdate(): Promise<void> {
  useAppUpdate.setState({ phase: "downloading", error: null });
  try {
    await call("download");
    useAppUpdate.setState({ phase: "ready" });
  } catch (e) {
    useAppUpdate.setState({ phase: "failed", error: String(e) });
  }
}

/** Runs the installer: Worlds closes and the new version opens. */
export async function installUpdate(): Promise<void> {
  useAppUpdate.setState({ phase: "installing" });
  try {
    await call("install");
  } catch (e) {
    useAppUpdate.setState({ phase: "failed", error: String(e) });
  }
}

export function startAppUpdates(): () => void {
  if (!updatesSupported()) return () => {};
  const first = window.setTimeout(() => void checkForUpdate(), 20_000);
  const every = window.setInterval(() => void checkForUpdate(), 6 * 3_600_000);
  return () => {
    window.clearTimeout(first);
    window.clearInterval(every);
  };
}
