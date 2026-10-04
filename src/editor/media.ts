import type { Editor } from "@tiptap/core";
import { open } from "@tauri-apps/plugin-dialog";
import { api, errorMessage } from "../lib/api";
import type { Attachment } from "../lib/types";
import { useStore } from "../state/store";

const FILTERS = {
  image: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg"] }],
  video: [{ name: "Videos", extensions: ["mp4", "webm", "mov", "m4v", "mkv"] }],
  file: [],
};

export function nodeForAttachment(a: Attachment) {
  const type = a.kind === "image" || a.kind === "gif" ? "image" : a.kind === "video" ? "video" : "file";
  return {
    type,
    attrs: {
      attachmentId: a.id,
      name: a.fileName,
      mime: a.mime,
      size: a.size,
      width: a.width,
      height: a.height,
      display: 100,
      align: "center",
      caption: "",
    },
  };
}

/** Import files from disk and insert them at `pos` (or the selection). */
export async function insertPaths(editor: Editor, pageId: string, paths: string[], pos?: number) {
  const nodes = [];
  for (const p of paths) {
    try {
      const a = await api.importFile(pageId, p);
      nodes.push(nodeForAttachment(a));
    } catch (e) {
      useStore.getState().toast({ message: errorMessage(e), tone: "error" });
    }
  }
  if (!nodes.length) return;
  const chain = editor.chain().focus();
  if (pos !== undefined) chain.insertContentAt(pos, nodes);
  else chain.insertContent(nodes);
  chain.run();
}

export async function insertBlobs(editor: Editor, pageId: string, files: File[], pos?: number) {
  const nodes = [];
  for (const f of files) {
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const name = f.name || `pasted-${Date.now()}.${(f.type.split("/")[1] || "bin").replace("jpeg", "jpg")}`;
      const a = await api.importBytes(pageId, name, bytes);
      nodes.push(nodeForAttachment(a));
    } catch (e) {
      useStore.getState().toast({ message: errorMessage(e), tone: "error" });
    }
  }
  if (!nodes.length) return;
  const chain = editor.chain().focus();
  if (pos !== undefined) chain.insertContentAt(pos, nodes);
  else chain.insertContent(nodes);
  chain.run();
}

export async function pickAndInsert(editor: Editor, pageId: string, kind: "image" | "video" | "file") {
  const picked = await open({ multiple: true, filters: FILTERS[kind], title: kind === "file" ? "Attach files" : `Insert ${kind}` });
  if (!picked) return;
  const paths = Array.isArray(picked) ? picked : [picked];
  await insertPaths(editor, pageId, paths);
}
