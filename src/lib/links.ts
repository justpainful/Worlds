/**
 * The only way Worlds hands a URL or file to the operating system.
 *
 * Links come from pages, profiles and Claude's answers, so they are checked
 * here: web, mail and Discord links open; anything else (file:, javascript:,
 * custom handlers) is refused. Attachments that could run code are revealed
 * in Explorer instead of being launched.
 */
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, errorMessage, isTauri } from "./api";
import { useStore } from "../state/store";

const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:", "discord:"]);

/** Extensions Windows would execute or interpret when "opened". */
const RUNNABLE = /\.(exe|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|msi|msp|scr|hta|lnk|pif|cpl|reg|jar|appref-ms|application|gadget|msc|inf|url|dll|sys)$/i;

export function isSafeUrl(url: string): boolean {
  try {
    return SAFE_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** A bare domain typed by the user ("example.com") becomes https. */
export function normalizeUrl(raw: string): string {
  const url = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  return `https://${url}`;
}

export async function openExternal(raw: string) {
  const url = normalizeUrl(raw);
  if (!isSafeUrl(url)) {
    useStore.getState().toast({ message: "This link was not opened: only web, mail and Discord links can open from Worlds.", tone: "error" });
    return;
  }
  try {
    if (isTauri) await openUrl(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  } catch (e) {
    useStore.getState().toast({ message: errorMessage(e), tone: "error" });
  }
}

export function isRunnable(fileName: string): boolean {
  return RUNNABLE.test(fileName.trim());
}

/** Open an attachment with its default app, or reveal it if it could run code. */
export async function openAttachment(id: string) {
  try {
    const path = await api.attachmentPath(id);
    if (isRunnable(path)) {
      await revealItemInDir(path);
      useStore.getState().toast({ message: "Programs and scripts are shown in Explorer instead of being opened.", tone: "info" });
      return;
    }
    await openPath(path);
  } catch (e) {
    useStore.getState().toast({ message: errorMessage(e), tone: "error" });
  }
}
