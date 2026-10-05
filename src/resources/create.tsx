/**
 * Creating resources: the New menu, file uploads (a `file` resource per file,
 * never an empty page) and external stream links.
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, errorMessage } from "../lib/api";
import type { PageMeta, ResourceKind } from "../lib/types";
import { useStore, type OpenWhere } from "../state/store";
import { menuAt, type MenuItem } from "../ui/Menu";
import { Modal } from "../ui/Modal";
import type { IconName } from "../ui/Icon";
import { KIND_INFO, NEW_KINDS, defaultIcon, fileIcon } from "./kinds";

const LINE_ICON: Record<ResourceKind, IconName> = {
  page: "page",
  document: "text",
  presentation: "monitor",
  project: "folder",
  gallery: "image",
  file: "upload",
  stream: "play",
};

/** Starting data for each kind (persisted with the resource). */
function initialMetadata(kind: ResourceKind): Record<string, unknown> {
  switch (kind) {
    case "document":
      return { doc: { size: "A4", orientation: "portrait", margins: { top: 25, right: 22, bottom: 25, left: 22 }, header: "", footer: "", font: "Default", fontSize: 12, lineHeight: 1.5 } };
    case "presentation":
      return { deck: { aspect: "16:9", theme: "dark" } };
    case "project":
      return { project: { status: "active", start: null, due: null, description: "", links: [] } };
    case "gallery":
      return { gallery: { view: "grid" } };
    default:
      return {};
  }
}

export async function createResource(kind: ResourceKind, opts: { parentId?: string | null; where?: OpenWhere; title?: string } = {}) {
  return useStore.getState().createPage(
    { kind, title: opts.title ?? "", icon: defaultIcon(kind), parentId: opts.parentId ?? null, metadata: initialMetadata(kind) },
    opts.where ?? "current",
  );
}

/** Pick files and add each as its own File resource. Returns the created resources. */
export async function uploadFiles(opts: { parentId?: string | null; paths?: string[]; open?: boolean } = {}): Promise<PageMeta[]> {
  let paths = opts.paths;
  if (!paths) {
    const picked = await openDialog({ multiple: true, title: "Add files to Worlds" });
    if (!picked) return [];
    paths = Array.isArray(picked) ? picked : [picked];
  }
  const s = useStore.getState();
  const made: PageMeta[] = [];
  for (const path of paths) {
    const name = path.split(/[\\/]/).pop() || "File";
    try {
      const meta = await api.createPage({ kind: "file", title: name, icon: "pi:file", parentId: opts.parentId ?? null });
      const att = await api.importFile(meta.id, path);
      const updated = await api.updatePage(meta.id, {
        icon: fileIcon(att.mime, att.fileName),
        metadata: { file: { attachmentId: att.id, name: att.fileName, mime: att.mime, size: att.size, kind: att.kind } },
      });
      s.patchPageLocal(updated);
      made.push(updated);
    } catch (e) {
      s.toast({ message: `${name}: ${errorMessage(e)}`, tone: "error" });
    }
  }
  if (made.length) {
    if (opts.parentId) s.setExpanded(opts.parentId, true);
    if (opts.open !== false && made.length === 1) s.openPage(made[0].id, "current");
    else if (made.length > 1) s.toast({ message: `Added ${made.length} files`, tone: "success" });
  }
  return made;
}

export type StreamFormat = "hls" | "dash" | "progressive";

export function detectStreamFormat(url: string): StreamFormat {
  const path = url.split(/[?#]/)[0].toLowerCase();
  if (path.endsWith(".m3u8") || path.endsWith(".m3u")) return "hls";
  if (path.endsWith(".mpd")) return "dash";
  return "progressive";
}

function StreamDialog({ onDone }: { onDone: (v: { name: string; url: string } | null) => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  let valid = false;
  try {
    const u = new URL(url.trim());
    valid = u.protocol === "https:" || u.protocol === "http:";
  } catch {
    valid = false;
  }
  const submit = () => valid && onDone({ name: name.trim() || new URL(url.trim()).pathname.split("/").pop() || "Stream", url: url.trim() });
  return (
    <Modal
      title="Add a stream"
      width={460}
      onClose={() => onDone(null)}
      footer={
        <>
          <button className="btn btn-quiet btn-standard" onClick={() => onDone(null)}>Cancel</button>
          <button className="btn btn-tinted btn-standard" disabled={!valid} onClick={submit}>Add</button>
        </>
      }
    >
      <div className="field-stack" onKeyDown={(e) => e.key === "Enter" && submit()}>
        <label className="field-label">Link</label>
        <input className="field" dir="ltr" autoFocus placeholder="https://example.com/live/index.m3u8" value={url} onChange={(e) => setUrl(e.target.value)} />
        <label className="field-label">Name</label>
        <input className="field" dir="auto" placeholder="Optional" value={name} onChange={(e) => setName(e.target.value)} />
        <p className="field-hint">Worlds keeps the link and plays it here. Nothing is downloaded; the stream stays where it is.</p>
      </div>
    </Modal>
  );
}

export function addStream(opts: { parentId?: string | null } = {}): Promise<PageMeta | null> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = async (v: { name: string; url: string } | null) => {
      root.unmount();
      host.remove();
      if (!v) return resolve(null);
      const meta = await useStore.getState().createPage(
        { kind: "stream", title: v.name, icon: defaultIcon("stream"), parentId: opts.parentId ?? null, metadata: { stream: { url: v.url, format: detectStreamFormat(v.url) } } },
        "current",
      );
      resolve(meta);
    };
    root.render(<StreamDialog onDone={done} />);
  });
}

/** The New menu: every kind, an upload and a stream link. */
export function newResourceMenu(anchor: HTMLElement, opts: { parentId?: string | null; align?: "start" | "end" } = {}) {
  const items: MenuItem[] = NEW_KINDS.map((k) => ({
    label: KIND_INFO[k].label,
    icon: LINE_ICON[k],
    shortcut: k === "page" ? "Ctrl+N" : undefined,
    onSelect: () => createResource(k, { parentId: opts.parentId }),
  }));
  items.push(
    { kind: "separator" },
    { label: "Upload Files", icon: "upload", onSelect: () => uploadFiles({ parentId: opts.parentId }) },
    { label: "Add Stream Link", icon: "link", onSelect: () => addStream({ parentId: opts.parentId }) },
  );
  menuAt(anchor, items, opts.align ?? "start");
}
