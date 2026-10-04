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
import { isRunnable, isSafeUrl, normalizeUrl } from "./urlSafety";

export { isRunnable, isSafeUrl, normalizeUrl };

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
