/**
 * Synced blocks: the same blocks on several pages. Each copy is an ordinary
 * `synced` block holding its own content; a registry in settings lists the
 * pages that hold each sync id. When one copy is saved, the others are
 * rewritten to match and their open editors merge the change.
 */
import type { JSONContent } from "@tiptap/core";
import { api, errorMessage } from "../lib/api";
import { emit } from "../lib/bus";
import { useStore } from "../state/store";

const KEY = "synced.registry";

type Registry = Record<string, string[]>;

export function syncRegistry(): Registry {
  const value = useStore.getState().settings[KEY];
  return value && typeof value === "object" ? (value as Registry) : {};
}

function writeRegistry(next: Registry) {
  useStore.getState().setSetting(KEY, next);
}

/** Pages that hold a sync id, this one included. */
export function syncedPages(syncId: string): string[] {
  return syncRegistry()[syncId] ?? [];
}

export function registerSynced(syncId: string, pageId: string) {
  const reg = syncRegistry();
  if (reg[syncId]?.includes(pageId)) return;
  writeRegistry({ ...reg, [syncId]: [...(reg[syncId] ?? []), pageId] });
}

export function unregisterSynced(syncId: string, pageId: string) {
  const reg = syncRegistry();
  if (!reg[syncId]) return;
  const rest = reg[syncId].filter((p) => p !== pageId);
  const next = { ...reg };
  if (rest.length) next[syncId] = rest;
  else delete next[syncId];
  writeRegistry(next);
}

export const newSyncId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Rewrite one page's copies of a synced block. Returns false when the page no longer holds it. */
async function rewrite(pageId: string, syncId: string, content: JSONContent[]): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const page = await api.page(pageId);
    if (!page || page.deletedAt) return false;
    let found = false;
    let changed = false;
    const blocks = page.blocks.map((b) => {
      const n = b.content;
      if (n.type !== "synced" || n.attrs?.syncId !== syncId) return n;
      found = true;
      if (JSON.stringify(n.content ?? []) === JSON.stringify(content)) return n;
      changed = true;
      return { ...n, content };
    });
    if (!found) return false;
    if (!changed) return true;
    try {
      const res = await api.saveBlocks(
        pageId,
        blocks.map((n) => ({ id: n.attrs?.bid as string, content: n })),
        page.updatedAt,
      );
      const s = useStore.getState();
      const meta = s.pages[pageId];
      if (meta) s.patchPageLocal({ ...meta, updatedAt: res.updatedAt });
      emit("page:saved", { pageId, from: "synced" });
      return true;
    } catch (e) {
      if (!errorMessage(e).startsWith("conflict")) throw e;
    }
  }
  return true;
}

/** A page saved new content for some synced blocks: bring every other copy up to date. */
export async function propagateSynced(fromPage: string, changes: Map<string, JSONContent[]>) {
  for (const [syncId, content] of changes) {
    for (const pageId of syncedPages(syncId)) {
      if (pageId === fromPage) continue;
      try {
        if (!(await rewrite(pageId, syncId, content))) unregisterSynced(syncId, pageId);
      } catch (e) {
        useStore.getState().toast({ message: `Could not update a synced copy: ${errorMessage(e)}`, tone: "error" });
      }
    }
  }
}

/** Place a copy of a synced block at the end of another page. */
export async function addSyncedTo(targetPageId: string, syncId: string, content: JSONContent[]) {
  const page = await api.page(targetPageId);
  if (!page) throw new Error("Page not found");
  const bid = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const block: JSONContent = { type: "synced", attrs: { bid, syncId }, content };
  const blocks = [...page.blocks.map((b) => b.content), block];
  const res = await api.saveBlocks(
    targetPageId,
    blocks.map((n) => ({ id: n.attrs?.bid as string, content: n })),
    page.updatedAt,
  );
  registerSynced(syncId, targetPageId);
  const s = useStore.getState();
  const meta = s.pages[targetPageId];
  if (meta) s.patchPageLocal({ ...meta, updatedAt: res.updatedAt });
  emit("page:saved", { pageId: targetPageId, from: "synced" });
}

/**
 * After a page saved: register its synced blocks and hand on the ones whose
 * content changed since the editor's last baseline.
 */
export function afterSave(pageId: string, blocks: JSONContent[], before: Map<string, string>) {
  const changes = new Map<string, JSONContent[]>();
  for (const b of blocks) {
    if (b.type !== "synced" || typeof b.attrs?.syncId !== "string") continue;
    const syncId = b.attrs.syncId as string;
    registerSynced(syncId, pageId);
    const old = before.get(b.attrs?.bid as string);
    const was = old ? (JSON.parse(old) as JSONContent).content : undefined;
    if (JSON.stringify(was ?? null) !== JSON.stringify(b.content ?? [])) changes.set(syncId, b.content ?? []);
  }
  if (changes.size) void propagateSynced(pageId, changes);
}
