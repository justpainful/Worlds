/**
 * Block actions that reach beyond the page: sync a block to another page,
 * move blocks to another page, and act on several selected blocks at once.
 *
 * Several blocks are selected by Shift-clicking their handles, or by a text
 * selection that runs across blocks. Blocks dragged by their handle onto a
 * page in the sidebar move there.
 */
import { Extension, type Editor, type JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { api, errorMessage } from "../lib/api";
import { emit, on } from "../lib/bus";
import { useStore, pageTitle } from "../state/store";
import { tr } from "../i18n/ui";
import type { MenuItem } from "../ui/Menu";
import { addSyncedTo, newSyncId, registerSynced } from "./synced";
import { choosePage } from "./choosePage";
import { newBlockId } from "./extensions/blockIds";

const key = new PluginKey<Set<string>>("blockSelection");

/** Block ids chosen with Shift-click on their handles. */
export function selectedBids(editor: Editor): Set<string> {
  return key.getState(editor.state) ?? new Set();
}

export function toggleBlockSelection(editor: Editor, bid: string) {
  const next = new Set(selectedBids(editor));
  if (next.has(bid)) next.delete(bid);
  else next.add(bid);
  editor.view.dispatch(editor.state.tr.setMeta(key, next));
}

export function clearBlockSelection(editor: Editor) {
  if (selectedBids(editor).size) editor.view.dispatch(editor.state.tr.setMeta(key, new Set()));
}

export const BlockSelection = Extension.create({
  name: "blockSelection",
  addProseMirrorPlugins() {
    return [
      new Plugin<Set<string>>({
        key,
        state: {
          init: () => new Set(),
          apply(tr, value) {
            const meta = tr.getMeta(key) as Set<string> | undefined;
            if (meta) return meta;
            // Typing or clicking into the text ends a block selection.
            if (value.size && (tr.docChanged || (tr.selectionSet && !tr.getMeta("keepBlockSelection")))) return new Set();
            return value;
          },
        },
        props: {
          decorations(state) {
            const chosen = key.getState(state);
            if (!chosen?.size) return null;
            const decos: Decoration[] = [];
            state.doc.forEach((n, offset) => {
              if (chosen.has(n.attrs.bid)) decos.push(Decoration.node(offset, offset + n.nodeSize, { class: "is-block-selected" }));
            });
            return DecorationSet.create(state.doc, decos);
          },
          handleKeyDown(view, event) {
            const chosen = key.getState(view.state);
            if (!chosen?.size) return false;
            if (event.key === "Escape") {
              view.dispatch(view.state.tr.setMeta(key, new Set()));
              return true;
            }
            if (event.key === "Delete" || event.key === "Backspace") {
              const tr = view.state.tr;
              const ranges: [number, number][] = [];
              view.state.doc.forEach((n, offset) => {
                if (chosen.has(n.attrs.bid)) ranges.push([offset, offset + n.nodeSize]);
              });
              for (const [from, to] of ranges.reverse()) tr.delete(from, to);
              view.dispatch(tr.setMeta(key, new Set()));
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});

/** Top-level blocks an action applies to: the Shift-click selection, a selection across blocks, or the one block. */
export function targetBlocks(editor: Editor, node?: PMNode, pos?: number): { node: PMNode; pos: number }[] {
  const out: { node: PMNode; pos: number }[] = [];
  const chosen = selectedBids(editor);
  if (chosen.size) {
    editor.state.doc.forEach((n, offset) => {
      if (chosen.has(n.attrs.bid)) out.push({ node: n, pos: offset });
    });
    if (out.length) return out;
  }
  const { from, to, empty } = editor.state.selection;
  if (!empty) {
    editor.state.doc.forEach((n, offset) => {
      if (offset + n.nodeSize > from && offset < to) out.push({ node: n, pos: offset });
    });
    if (out.length > 1) return out;
    out.length = 0;
  }
  if (node && pos !== undefined) out.push({ node, pos });
  return out;
}

const fresh = (n: JSONContent): JSONContent => ({ ...n, attrs: { ...(n.attrs ?? {}), bid: newBlockId() } });

/** Append blocks to the end of another page. */
async function appendTo(targetPageId: string, blocks: JSONContent[]) {
  const page = await api.page(targetPageId);
  if (!page) throw new Error(tr("Page not found"));
  const all = [...page.blocks.map((b) => b.content), ...blocks.map(fresh)];
  const res = await api.saveBlocks(
    targetPageId,
    all.map((n) => ({ id: n.attrs?.bid as string, content: n })),
    page.updatedAt,
  );
  for (const b of blocks) if (b.type === "synced" && b.attrs?.syncId) registerSynced(b.attrs.syncId as string, targetPageId);
  const s = useStore.getState();
  const meta = s.pages[targetPageId];
  if (meta) s.patchPageLocal({ ...meta, updatedAt: res.updatedAt });
  emit("page:saved", { pageId: targetPageId, from: "move" });
}

function deleteBlocks(editor: Editor, targets: { node: PMNode; pos: number }[]) {
  const tr = editor.state.tr;
  for (const t of [...targets].sort((a, b) => b.pos - a.pos)) tr.delete(t.pos, t.pos + t.node.nodeSize);
  editor.view.dispatch(tr.setMeta(key, new Set()));
}

/** Move blocks to another page and take them out of this one. */
export async function moveBlocksTo(editor: Editor, targetPageId: string, targets: { node: PMNode; pos: number }[]) {
  const json = targets.map((t) => t.node.toJSON() as JSONContent);
  await appendTo(targetPageId, json);
  deleteBlocks(editor, targets);
  const title = pageTitle(useStore.getState().pages[targetPageId]);
  useStore.getState().toast({
    message: `${targets.length === 1 ? tr("Moved to") : `${targets.length} ${tr("blocks moved to")}`} ${title}`,
    action: { label: tr("Open"), run: () => useStore.getState().openPage(targetPageId) },
  });
}

/** Make blocks synced (if they are not) and place a synced copy on another page. */
async function syncTo(editor: Editor, targetPageId: string, pageId: string, targets: { node: PMNode; pos: number }[]) {
  let syncId: string;
  let content: JSONContent[];
  if (targets.length === 1 && targets[0].node.type.name === "synced") {
    syncId = targets[0].node.attrs.syncId;
    content = (targets[0].node.toJSON() as JSONContent).content ?? [];
  } else {
    syncId = newSyncId();
    content = targets.map((t) => t.node.toJSON() as JSONContent);
    const first = targets[0].pos;
    const last = targets[targets.length - 1];
    const wrapper = editor.schema.nodeFromJSON({ type: "synced", attrs: { syncId, bid: newBlockId() }, content });
    editor.view.dispatch(editor.state.tr.replaceWith(first, last.pos + last.node.nodeSize, wrapper).setMeta(key, new Set()));
    registerSynced(syncId, pageId);
  }
  await addSyncedTo(targetPageId, syncId, content);
  useStore.getState().toast({ message: `${tr("Synced with")} ${pageTitle(useStore.getState().pages[targetPageId])}` });
}

const fail = (e: unknown) => useStore.getState().toast({ message: errorMessage(e), tone: "error" });

/** Extra items for a block's menu. */
export function blockActions(editor: Editor, pageId: string, node: PMNode, pos: number): MenuItem[] {
  if (!editor.isEditable) return [];
  const targets = targetBlocks(editor, node, pos);
  const many = targets.length > 1;
  const anchor = () => (document.activeElement as HTMLElement) ?? document.body;
  const items: MenuItem[] = [{ kind: "separator" }];
  if (many) items.push({ kind: "label", label: `${targets.length} ${tr("blocks selected")}` });
  items.push(
    {
      label: many ? "Move Blocks to Page" : "Move to Page",
      icon: "move",
      onSelect: async () => {
        const target = await choosePage(anchor());
        if (!target || target === pageId) return;
        moveBlocksTo(editor, target, targets).catch(fail);
      },
    },
    {
      label: many ? "Sync Blocks to Page" : node.type.name === "synced" ? "Add to Another Page" : "Sync to Another Page",
      icon: "synced",
      onSelect: async () => {
        const target = await choosePage(anchor());
        if (!target || target === pageId) return;
        syncTo(editor, target, pageId, targets).catch(fail);
      },
    },
  );
  if (many)
    items.push({
      label: "Delete Blocks",
      icon: "delete",
      danger: true,
      onSelect: () => deleteBlocks(editor, targets),
    });
  return items;
}

/**
 * Dragging blocks by their handle carries them as `application/x-worlds-blocks`,
 * so a page in the sidebar can take them.
 */
export function watchBlockDrags(editor: Editor, pageId: string, root: HTMLElement): () => void {
  const onStart = (e: DragEvent) => {
    const dragging = (editor.view as unknown as { dragging?: { slice: { content: { forEach: (f: (n: PMNode) => void) => void } } } | null }).dragging;
    if (!dragging || !e.dataTransfer) return;
    const bids: string[] = [];
    dragging.slice.content.forEach((n) => n.attrs?.bid && bids.push(n.attrs.bid));
    const chosen = selectedBids(editor);
    const all = chosen.size ? [...new Set([...chosen, ...bids])] : bids;
    if (all.length) e.dataTransfer.setData("application/x-worlds-blocks", JSON.stringify({ pageId, bids: all }));
  };
  root.addEventListener("dragstart", onStart, true);
  const off = on("blocks:moved-out", ({ pageId: from, bids, target }) => {
    if (from !== pageId || editor.isDestroyed) return;
    const targets: { node: PMNode; pos: number }[] = [];
    editor.state.doc.forEach((n, offset) => {
      if (bids.includes(n.attrs.bid)) targets.push({ node: n, pos: offset });
    });
    if (targets.length) moveBlocksTo(editor, target, targets).catch(fail);
  });
  return () => {
    root.removeEventListener("dragstart", onStart, true);
    off();
  };
}
