/**
 * The only way Worlds hands a URL or file to the operating system.
 *
 * Links come from pages, profiles and Claude's answers, so they are checked
 * here: web, mail and Discord links open; anything else (file:, javascript:,
 * custom handlers) is refused. Attachments that could run code are revealed
 * in Explorer instead of being launched.
 */
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, errorMessage, fileUrl, isTauri, isWeb } from "./api";
import { download } from "../web/files";
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
    if (isTauri && !isWeb) await openUrl(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  } catch (e) {
    useStore.getState().toast({ message: errorMessage(e), tone: "error" });
  }
}

/** The name a web attachment is saved under. */
async function webName(id: string): Promise<string> {
  const { fileMeta } = await import("../dev/mockTauri");
  return fileMeta(id)?.name ?? "file";
}

/** On the web: hand an attachment to the browser as a download. */
export async function downloadAttachment(id: string) {
  const url = fileUrl(id);
  if (!url) {
    useStore.getState().toast({ message: "This file is not in this browser yet.", tone: "error" });
    return;
  }
  download(await webName(id), await fetch(url).then((r) => r.blob()));
}

/** Show an attachment's file in Explorer; on the web, download it. */
export async function revealAttachment(id: string) {
  try {
    if (isWeb) return await downloadAttachment(id);
    await revealItemInDir(await api.attachmentPath(id));
  } catch (e) {
    useStore.getState().toast({ message: errorMessage(e), tone: "error" });
  }
}

/** Open an attachment with its default app, or reveal it if it could run code. */
export async function openAttachment(id: string) {
  try {
    if (isWeb) {
      // The browser opens what it can show (pictures, video, PDF, text) in a tab and downloads the rest.
      const url = fileUrl(id);
      if (!url) throw new Error("This file is not in this browser yet.");
      if (!isRunnable(await webName(id)) && /^(image|video|audio)\/|^application\/pdf$|^text\/plain$/.test((await fetch(url).then((r) => r.blob())).type)) window.open(url, "_blank", "noopener");
      else await downloadAttachment(id);
      return;
    }
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
