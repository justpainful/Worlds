import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Extension, type JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import Highlight from "@tiptap/extension-highlight";
import DragHandle from "@tiptap/extension-drag-handle-react";
import { api, errorMessage } from "../lib/api";
import type { Page } from "../lib/types";
import { useStore } from "../state/store";
import { emit, on } from "../lib/bus";
import { BlockIds, newBlockId } from "./extensions/blockIds";
import { Callout, Prompt, PageLink, ImageNode, VideoNode, FileNode, Embed, DiscordMessage, Schedule } from "./extensions/nodes";
import { Collection, Column, Columns, Toggle } from "./extensions/pages2";
import { BackgroundColor, Color, FindReplace, Gallery, TextStyle, Toc, WikiLink } from "./extensions/pages3";
import { openLightbox } from "./views/Pages3Views";
import { documentExtensions } from "./extensions/document";
import { Chart, MathBlock, MathInline, Mermaid, Tab, Tabs } from "./extensions/pages4";

/** Apple-like text and background colours. */
export const TEXT_COLORS: { name: string; value: string | null }[] = [
  { name: "Default", value: null },
  { name: "Gray", value: "#a1a1a8" },
  { name: "Brown", value: "#c8a27c" },
  { name: "Orange", value: "#ff9f50" },
  { name: "Yellow", value: "#f2c94c" },
  { name: "Green", value: "#4cd38a" },
  { name: "Blue", value: "#64a8ff" },
  { name: "Purple", value: "#b28dff" },
  { name: "Pink", value: "#f582c0" },
  { name: "Red", value: "#ff6f6f" },
];
const bg = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0.24)`;
};
import { SlashCommand, PageMention, resolveTitle } from "./extensions/suggest";
import { insertBlobs, pickAndInsert } from "./media";
import { mergeBlocks } from "./merge";
import { promptText } from "./prompt";
import { Glass } from "../glass/Glass";
import { LAYER } from "../glass/materials";
import { Icon, type IconName } from "../ui/Icon";
import { menuAt, useMenu, type MenuItem } from "../ui/Menu";
import { useCollab } from "../sync/useCollab";

export interface PageEditorHandle {
  editor: Editor | null;
  flush: () => Promise<void>;
  focusStart: () => void;
}

/** Holds the page id so node views can reach it. */
const WorldsContext = Extension.create<{ pageId: string }>({
  name: "worlds",
  addOptions() {
    return { pageId: "" };
  },
  addStorage() {
    return { pageId: this.options.pageId };
  },
});

function docFrom(page: Page): JSONContent {
  const content = page.blocks.map((b) => refreshMentionLabels(b.content));
  return { type: "doc", content: content.length ? content : [{ type: "paragraph", attrs: { bid: newBlockId() } }] };
}

function refreshMentionLabels(n: JSONContent): JSONContent {
  if (n.type === "pageMention") return { ...n, attrs: { ...n.attrs, label: resolveTitle(n.attrs?.id, n.attrs?.label ?? "") } };
  if (!n.content) return n;
  return { ...n, content: n.content.map(refreshMentionLabels) };
}

const blocksOf = (editor: Editor): JSONContent[] => editor.getJSON().content ?? [];
const blocksOfDoc = (doc: PMNode): JSONContent[] => (doc.toJSON() as JSONContent).content ?? [];

/**
 * Saves still on their way to the database, per page. Opening a page waits
 * for its pending save first, so a quick "leave and come back" never loads
 * (and then re-saves) content older than what was just typed.
 */
const inflight = new Map<string, Promise<void>>();
export function whenSaved(pageId: string): Promise<void> {
  return inflight.get(pageId) ?? Promise.resolve();
}

export const PageEditor = forwardRef<
  PageEditorHandle,
  { page: Page; onSaved?: (at: number) => void; onSaving?: (s: boolean) => void; variant?: "page" | "document" }
>(function PageEditor(
  { page, onSaved, onSaving, variant = "page" },
  ref,
) {
  const pageId = page.id;
  const baseline = useRef<Map<string, string>>(new Map());
  const saveTimer = useRef(0);
  const saving = useRef<Promise<void> | null>(null);
  const dirty = useRef(false);
  /** The latest document, kept so the final save works even after the editor is torn down. */
  const lastDoc = useRef<PMNode | null>(null);
  /** Identifies this editor among several open on the same page (split panes). */
  const instance = useRef(Math.random().toString(36).slice(2));
  const external = useStore((s) => s.externalRevision[pageId] ?? 0);
  const [hovered, setHovered] = useState<{ node: PMNode; pos: number } | null>(null);
  const show = useMenu((s) => s.show);
  // Live collaboration: shared pages edit through Yjs; personal pages are untouched.
  const collab = useCollab(page, { onSaved });

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener", class: "link" } },
          dropcursor: { color: "rgba(var(--accent-rgb), 0.9)", width: 2 },
          codeBlock: { HTMLAttributes: { class: "code-block", dir: "ltr" } },
          ...collab.starterKit,
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        TableKit.configure({ table: { resizable: false, HTMLAttributes: { class: "table" } } }),
        Highlight.configure({ multicolor: true }),
        TextStyle,
        Color,
        BackgroundColor,
        WikiLink,
        Toc,
        Gallery,
        FindReplace,
        Placeholder.configure({
          includeChildren: true,
          placeholder: ({ node, editor: ed, pos }) => {
            // Nested blocks: only toggle summaries and empty columns get a hint.
            // The hint is computed while a new document is being drawn and
            // `ed.state` can still be the previous one, so a position may not
            // exist there yet. A hint must never throw: an exception here
            // aborts the whole view update (and breaks undo/redo).
            const doc = ed.state.doc;
            if (pos < 0 || pos > doc.content.size) return "";
            let $p;
            try {
              $p = doc.resolve(pos);
            } catch {
              return "";
            }
            if (doc.nodeAt(pos) !== node) return $p.depth > 0 ? "" : "Press / for blocks";
            if ($p.depth > 0) {
              if ($p.parent.type.name === "toggle") return $p.index() === 0 ? "Toggle" : "Hidden content";
              if ($p.parent.type.name === "column" && $p.parent.childCount === 1) return "Column";
              return "";
            }
            if (node.type.name === "heading") return `Heading ${node.attrs.level}`;
            if (ed.state.doc.childCount === 1 && node.type.name === "paragraph") return variant === "document" ? "Start writing" : "Start writing, or press / for blocks and @ for pages";
            return "Press / for blocks";
          },
        }),
        BlockIds,
        Callout,
        Prompt,
        PageLink,
        ImageNode,
        VideoNode,
        FileNode,
        Embed,
        DiscordMessage,
        Schedule,
        Columns,
        Column,
        Toggle,
        Collection,
        PageMention,
        MathInline,
        MathBlock,
        Mermaid,
        Chart,
        Tabs,
        Tab,
        ...(variant === "document" ? documentExtensions : []),
        SlashCommand.configure({ getContext: () => ({ pageId }) }),
        WorldsContext.configure({ pageId }),
        ...collab.extensions,
      ],
      content: collab.key.startsWith("yjs") ? undefined : docFrom(page),
      editable: collab.editable,
      editorProps: {
        attributes: { class: "prose", spellcheck: "true" },
        handlePaste: (_view, event) => {
          const files = [...(event.clipboardData?.files ?? [])];
          if (files.length && editorRef.current) {
            event.preventDefault();
            insertBlobs(editorRef.current, pageId, files);
            return true;
          }
          return false;
        },
        handleDrop: (view, event) => {
          const files = [...((event as DragEvent).dataTransfer?.files ?? [])];
          if (files.length && editorRef.current) {
            event.preventDefault();
            const pos = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY })?.pos;
            insertBlobs(editorRef.current, pageId, files, pos);
            return true;
          }
          return false;
        },
        handleClickOn: (_view, _pos, node, _np, event) => {
          if (node.type.name === "pageMention" && node.attrs.id) {
            const e = event as MouseEvent;
            useStore.getState().openPage(node.attrs.id, e.ctrlKey ? "tab" : e.altKey ? "right" : "current");
            return true;
          }
          return false;
        },
        handleKeyDown: (_view, event) => {
          // Ctrl+Click style link opening is handled by click; keep Mod+S as an explicit save.
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            flush();
            return true;
          }
          return false;
        },
      },
      onCreate: ({ editor: ed }) => {
        baseline.current = new Map(blocksOf(ed).map((n) => [n.attrs?.bid as string, JSON.stringify(n)]));
        lastDoc.current = ed.state.doc;
      },
      onUpdate: ({ editor: ed }) => {
        lastDoc.current = ed.state.doc;
        dirty.current = true;
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => flush(), 450);
      },
    },
    [pageId, collab.key],
  );
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  /** When this editor last agreed with the database (the save's `base`). */
  const syncedAt = useRef(page.updatedAt);
  const merging = useRef<Promise<boolean> | null>(null);

  async function flush(): Promise<void> {
    if (collab.shared) return collab.flush();
    const ed = editorRef.current;
    window.clearTimeout(saveTimer.current);
    // Never save a block list that predates a merge in progress.
    if (merging.current) await merging.current;
    if (saving.current) await saving.current;
    if (!dirty.current) return;
    const live = !!ed && !ed.isDestroyed;
    const doc = live ? ed.state.doc : lastDoc.current;
    if (!doc) return;
    dirty.current = false;
    const blocks = blocksOfDoc(doc);
    const changed = blocks.length !== baseline.current.size || blocks.some((b) => baseline.current.get(b.attrs?.bid) !== JSON.stringify(b));
    if (!changed) return;
    let conflict = false;
    onSaving?.(true);
    saving.current = (async () => {
      try {
        const res = await api.saveBlocks(
          pageId,
          blocks.map((b) => ({ id: b.attrs?.bid as string, content: b })),
          syncedAt.current,
        );
        syncedAt.current = res.updatedAt;
        if (live && !ed.isDestroyed) {
          if (res.remapped.length) applyRemaps(ed, res.remapped);
          baseline.current = new Map(blocksOf(ed).map((n) => [n.attrs?.bid as string, JSON.stringify(n)]));
        } else {
          baseline.current = new Map(blocks.map((n) => [n.attrs?.bid as string, JSON.stringify(n)]));
        }
        emit("page:saved", { pageId, from: instance.current });
        onSaved?.(res.updatedAt);
        const s = useStore.getState();
        const meta = s.pages[pageId];
        if (meta) s.patchPageLocal({ ...meta, updatedAt: res.updatedAt });
      } catch (e) {
        dirty.current = true;
        const message = errorMessage(e);
        // Someone else wrote the page since we synced: merge, then save again.
        if (message.startsWith("conflict")) conflict = true;
        else useStore.getState().toast({ message: `Could not save: ${message}`, tone: "error" });
      } finally {
        onSaving?.(false);
        if (inflight.get(pageId) === saving.current) inflight.delete(pageId);
        saving.current = null;
      }
    })();
    const current = saving.current;
    inflight.set(pageId, current);
    await current;
    if (conflict) await pullAndMerge();
  }

  /**
   * Fold the database's version of the page into this editor (three-way, by
   * block, against what this editor last synced), then save the result if it
   * differs. Works after the editor is torn down too, on the kept document,
   * so a last save that hits a conflict is merged rather than dropped.
   */
  async function pullAndMerge(): Promise<void> {
    if (collab.shared) return; // shared pages fold outside writes into the Yjs document
    if (merging.current) {
      await merging.current;
      return;
    }
    let resolveDone!: (v: boolean) => void;
    merging.current = new Promise<boolean>((r) => (resolveDone = r));
    let needsSave = false;
    try {
      window.clearTimeout(saveTimer.current);
      if (saving.current) await saving.current;
      const fresh = await api.page(pageId);
      const ed = editorRef.current;
      const live = !!ed && !ed.isDestroyed;
      const doc = live ? ed.state.doc : lastDoc.current;
      if (!fresh || !doc) return;
      syncedAt.current = fresh.updatedAt;
      const server = fresh.blocks.map((b) => refreshMentionLabels(b.content));
      const local = blocksOfDoc(doc);
      if (JSON.stringify(server) === JSON.stringify(local)) {
        baseline.current = new Map(server.map((n) => [n.attrs?.bid as string, JSON.stringify(n)]));
        dirty.current = false;
        return;
      }
      const { merged, dirty: differs } = mergeBlocks(baseline.current, local, server);
      const mergedDoc = doc.type.schema.nodeFromJSON({ type: "doc", content: merged.length ? merged : [{ type: "paragraph" }] });
      if (live) {
        const { from, to } = ed.state.selection;
        const tr = ed.state.tr.replaceWith(0, ed.state.doc.content.size, mergedDoc.content).setMeta("addToHistory", false);
        const max = tr.doc.content.size;
        try {
          tr.setSelection(TextSelection.create(tr.doc, Math.min(from, max), Math.min(to, max)));
        } catch {
          /* selection landed in an atom; leave default */
        }
        ed.view.dispatch(tr);
      }
      lastDoc.current = live ? ed.state.doc : mergedDoc;
      baseline.current = new Map(server.map((n) => [n.attrs?.bid as string, JSON.stringify(n)]));
      dirty.current = differs;
      needsSave = differs;
    } catch (e) {
      useStore.getState().toast({ message: `Could not merge changes: ${errorMessage(e)}`, tone: "error" });
    } finally {
      resolveDone(needsSave);
      merging.current = null;
    }
    if (needsSave) await flush();
  }

  useImperativeHandle(ref, () => ({
    editor: collab.expose(editor),
    flush,
    focusStart: () => editor?.chain().focus("start").run(),
  }));

  // Save when leaving.
  useEffect(() => {
    const before = () => {
      flush();
    };
    const hidden = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("beforeunload", before);
    // Closing to the tray, quitting from it, or switching apps: save now, not in 450ms.
    window.addEventListener("blur", before);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("beforeunload", before);
      window.removeEventListener("blur", before);
      document.removeEventListener("visibilitychange", hidden);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Another writer (Claude, an automation, or this page open in another pane)
  // changed the page: three-way merge against what this editor last saved.
  const lastExternal = useRef(external);
  const [peerRevision, setPeerRevision] = useState(0);
  useEffect(
    () =>
      on("page:saved", ({ pageId: saved, from }) => {
        if (saved === pageId && from !== instance.current) setPeerRevision((r) => r + 1);
      }),
    [pageId],
  );
  const lastPeer = useRef(0);
  useEffect(() => {
    if ((external === lastExternal.current && peerRevision === lastPeer.current) || !editor) return;
    lastExternal.current = external;
    lastPeer.current = peerRevision;
    pullAndMerge();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [external, peerRevision, editor]);

  // Palette / menu commands targeting this page's editor.
  useEffect(() => {
    return on("editor:command", ({ pageId: target, command, args }) => {
      if (target !== pageId || !editorRef.current) return;
      if (command === "insertSchedule") {
        editorRef.current.chain().focus().insertAtom("schedule", { automationId: (args as { automationId: string }).automationId }).run();
      }
      if (command === "insertImage") pickAndInsert(editorRef.current, pageId, "image");
      if (command === "insertFile") pickAndInsert(editorRef.current, pageId, "file");
      if (command === "insertVideo") pickAndInsert(editorRef.current, pageId, "video");
    });
  }, [pageId]);

  if (!editor) return null;

  const blockMenu = (node: PMNode, pos: number): MenuItem[] => {
    const isText = node.isTextblock || ["bulletList", "orderedList", "taskList", "blockquote", "callout", "prompt"].includes(node.type.name);
    const selectInside = () => editor.chain().focus().setTextSelection(pos + 1);
    const turn = (label: string, icon: IconName, fn: () => void): MenuItem => ({ label, icon, onSelect: fn });
    const items: MenuItem[] = [];
    if (isText) {
      items.push({
        label: "Turn Into",
        icon: "repeat",
        submenu: [
          turn("Text", "text", () => selectInside().clearNodes().run()),
          turn("Heading 1", "h1", () => selectInside().clearNodes().setHeading({ level: 1 }).run()),
          turn("Heading 2", "h2", () => selectInside().clearNodes().setHeading({ level: 2 }).run()),
          turn("Heading 3", "h3", () => selectInside().clearNodes().setHeading({ level: 3 }).run()),
          turn("Bulleted List", "bulletList", () => selectInside().clearNodes().toggleBulletList().run()),
          turn("Numbered List", "numberedList", () => selectInside().clearNodes().toggleOrderedList().run()),
          turn("Checklist", "checklist", () => selectInside().clearNodes().toggleTaskList().run()),
          turn("Quote", "quote", () => selectInside().clearNodes().toggleBlockquote().run()),
          turn("Callout", "callout", () => selectInside().clearNodes().setCallout("note").run()),
          turn("Code", "code", () => selectInside().clearNodes().toggleCodeBlock().run()),
        ],
      });
      const dir = node.attrs.dir as string | null;
      items.push({
        label: "Text Direction",
        icon: "language",
        submenu: [
          { label: "Automatic", checked: !dir, onSelect: () => setDir(editor, pos, null) },
          { label: "Right to Left", checked: dir === "rtl", onSelect: () => setDir(editor, pos, "rtl") },
          { label: "Left to Right", checked: dir === "ltr", onSelect: () => setDir(editor, pos, "ltr") },
        ],
      });
    }
    if (node.isTextblock || ["bulletList", "orderedList", "taskList", "blockquote", "callout", "toggle"].includes(node.type.name)) {
      const paint = (fn: (c: ReturnType<typeof editor.chain>) => ReturnType<typeof editor.chain>) =>
        fn(editor.chain().focus().setTextSelection({ from: pos + 1, to: pos + node.nodeSize - 1 })).run();
      items.push({
        label: "Color",
        icon: "appearance",
        submenu: [
          { kind: "label", label: "Text" },
          ...TEXT_COLORS.map((c) => ({ label: c.name, onSelect: () => paint((ch) => (c.value ? ch.setColor(c.value) : ch.unsetColor())) })),
          { kind: "separator" },
          { kind: "label", label: "Background" },
          ...TEXT_COLORS.map((c) => ({
            label: c.value ? `${c.name} background` : "No background",
            onSelect: () => paint((ch) => (c.value ? ch.setBackgroundColor(bg(c.value)) : ch.unsetBackgroundColor())),
          })),
        ],
      });
    }
    if (node.type.name === "codeBlock") {
      items.push({
        label: "Copy Code",
        icon: "duplicate",
        onSelect: () => {
          navigator.clipboard.writeText(node.textContent);
          useStore.getState().toast({ message: "Code copied" });
        },
      });
    }
    if (node.type.name === "table") {
      const inTable = () => editor.chain().focus().setTextSelection(pos + 3);
      items.push({
        label: "Table",
        icon: "table",
        submenu: [
          { label: "Add Row Below", onSelect: () => inTable().addRowAfter().run() },
          { label: "Add Column Right", onSelect: () => inTable().addColumnAfter().run() },
          { label: "Toggle Header Row", onSelect: () => inTable().toggleHeaderRow().run() },
          { kind: "separator" },
          { label: "Delete Table", danger: true, onSelect: () => inTable().deleteTable().run() },
        ],
      });
    }
    items.push(
      { kind: "separator" },
      { label: "Duplicate", icon: "duplicate", shortcut: "Ctrl+D", onSelect: () => duplicateBlock(editor, pos, node) },
      { label: "Move Up", icon: "arrowLeft", onSelect: () => moveBlock(editor, pos, -1) },
      { label: "Move Down", icon: "arrowRight", onSelect: () => moveBlock(editor, pos, 1) },
      {
        label: "Copy Link",
        icon: "link",
        onSelect: () => {
          navigator.clipboard.writeText(`worlds://page/${pageId}#${node.attrs.bid}`);
          useStore.getState().toast({ message: "Block link copied" });
        },
      },
      {
        label: "Ask Claude About This",
        icon: "assistant",
        onSelect: () => emit("ai:open", { pageId, prompt: `About block ${node.attrs.bid}: ` }),
      },
      { kind: "separator" },
      {
        label: "Delete",
        icon: "delete",
        danger: true,
        onSelect: () => editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run(),
      },
    );
    return items;
  };

  // Double-click a picture to see every picture on the page full screen.
  const onDoubleClick = (e: React.MouseEvent) => {
    const img = (e.target as HTMLElement).closest(".ProseMirror img") as HTMLImageElement | null;
    if (!img || img.closest(".gallery-block")) return;
    const images: { attachmentId: string; name: string }[] = [];
    editor.state.doc.descendants((n) => {
      if (n.type.name === "image" && n.attrs.attachmentId) images.push({ attachmentId: n.attrs.attachmentId, name: n.attrs.name || n.attrs.caption || "" });
    });
    const idx = Math.max(0, images.findIndex((im) => img.src.includes(im.attachmentId)));
    if (images.length) openLightbox(images, idx);
  };

  return (
    <div className="editor-wrap" onDoubleClick={onDoubleClick}>
      {collab.render(editor)}
      <DragHandle
        editor={editor}
        onNodeChange={({ node, pos }) => setHovered(node ? { node, pos } : null)}
        className="drag-handle-host"
      >
        <div className="block-handle">
          <button
            className="bh-btn"
            aria-label="Insert block below"
            data-tip="Insert below"
            onClick={() => {
              if (!hovered) return;
              const at = hovered.pos + hovered.node.nodeSize;
              editor.chain().insertContentAt(at, { type: "paragraph" }).setTextSelection(at + 1).insertContent("/").focus().run();
            }}
          >
            <Icon name="add" size={15} />
          </button>
          <button
            className="bh-btn bh-grip"
            aria-label="Drag to move, click for options"
            data-tip="Drag to move · Click for options"
            onClick={(e) => {
              if (!hovered) return;
              editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, hovered.pos)));
              const r = e.currentTarget.getBoundingClientRect();
              show(r.left, r.bottom + 4, blockMenu(hovered.node, hovered.pos));
            }}
          >
            <Icon name="grip" size={15} />
          </button>
        </div>
      </DragHandle>

      <BubbleMenu
        editor={editor}
        options={{ placement: "top", offset: 10 }}
        shouldShow={({ editor: ed, state }) => {
          const { selection } = state;
          if (selection.empty || selection instanceof NodeSelection) return false;
          if (ed.isActive("codeBlock")) return false;
          return state.doc.textBetween(selection.from, selection.to, " ").trim().length > 0;
        }}
      >
        <Glass material="dense" layer={LAYER.popover} className="bubble" radius="var(--r-capsule)">
          <div className="bubble-row">
            <button
              className="bb-btn bb-text"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                const { $from } = editor.state.selection;
                const depth = Math.max(1, $from.depth);
                const pos = $from.before(1);
                menuAt(e.currentTarget, blockMenu(editor.state.doc.nodeAt(pos)!, pos).slice(0, 2));
                void depth;
              }}
            >
              Turn into
              <Icon name="chevronDown" size={12} />
            </button>
            <span className="bb-sep" />
            <BB icon="text" label="Bold" shortcut="Ctrl+B" active={editor.isActive("bold")} run={() => editor.chain().focus().toggleBold().run()} glyph="B" />
            <BB icon="text" label="Italic" shortcut="Ctrl+I" active={editor.isActive("italic")} run={() => editor.chain().focus().toggleItalic().run()} glyph="I" italic />
            <BB icon="text" label="Strikethrough" active={editor.isActive("strike")} run={() => editor.chain().focus().toggleStrike().run()} glyph="S" strike />
            <BB icon="code" label="Code" active={editor.isActive("code")} run={() => editor.chain().focus().toggleCode().run()} />
            <BB icon="highlight" label="Highlight" active={editor.isActive("highlight")} run={() => editor.chain().focus().toggleHighlight().run()} />
            <button
              className="bb-btn"
              aria-label="Color"
              data-tip="Text and background color"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) =>
                menuAt(e.currentTarget, [
                  { kind: "label", label: "Text" },
                  ...TEXT_COLORS.map((c) => ({
                    label: c.name,
                    checked: c.value ? editor.isActive("textStyle", { color: c.value }) : false,
                    onSelect: () => (c.value ? editor.chain().focus().setColor(c.value).run() : editor.chain().focus().unsetColor().run()),
                  })),
                  { kind: "separator" },
                  { kind: "label", label: "Background" },
                  ...TEXT_COLORS.map((c) => ({
                    label: c.value ? c.name : "None",
                    onSelect: () => (c.value ? editor.chain().focus().setBackgroundColor(bg(c.value)).run() : editor.chain().focus().unsetBackgroundColor().run()),
                  })),
                ])
              }
            >
              <span className="bb-color" style={{ color: (editor.getAttributes("textStyle").color as string) || undefined }}>A</span>
            </button>
            <BB
              icon="link"
              label="Link"
              active={editor.isActive("link")}
              run={async () => {
                if (editor.isActive("link")) return editor.chain().focus().unsetLink().run();
                const url = await promptText({ title: "Link", placeholder: "https://", confirm: "Apply", validate: (v) => (/^(https?:|mailto:)/.test(v) ? null : "Enter a full URL") });
                if (url) editor.chain().focus().setLink({ href: url }).run();
              }}
            />
            <span className="bb-sep" />
            <BB
              icon="assistant"
              label="Ask Claude about the selection"
              run={() => {
                const { from, to } = editor.state.selection;
                const text = editor.state.doc.textBetween(from, to, "\n");
                emit("ai:open", { pageId, prompt: `Regarding this part of the page:\n"""\n${text}\n"""\n` });
              }}
            />
          </div>
        </Glass>
      </BubbleMenu>

      <BubbleMenu
        editor={editor}
        pluginKey="tableMenu"
        options={{ placement: "top-end", offset: 8 }}
        shouldShow={({ editor: ed, state }) => ed.isActive("table") && state.selection.empty}
      >
        <Glass material="dense" layer={LAYER.popover} className="bubble" radius="var(--r-capsule)">
          <div className="bubble-row">
            <button className="bb-btn bb-text" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().addRowAfter().run()}>+ Row</button>
            <button className="bb-btn bb-text" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().addColumnAfter().run()}>+ Column</button>
            <span className="bb-sep" />
            <button className="bb-btn bb-text" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().deleteRow().run()}>Delete row</button>
            <button className="bb-btn bb-text" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().deleteColumn().run()}>Delete column</button>
          </div>
        </Glass>
      </BubbleMenu>

      <EditorContent
        editor={editor}
        className="editor-content"
        onContextMenu={(e) => {
          // Block-level context menu on non-text blocks (media, cards).
          const target = e.target as HTMLElement;
          if (target.closest("input, textarea")) return;
          const pos = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
          if (!pos) return;
          const $p = editor.state.doc.resolve(pos.pos);
          if ($p.depth === 0 && !$p.nodeAfter) return;
          const top = $p.depth > 0 ? $p.before(1) : pos.pos;
          const node = editor.state.doc.nodeAt(top);
          if (!node) return;
          if (window.getSelection()?.toString()) return; // let text context menu happen
          e.preventDefault();
          show(e.clientX, e.clientY, blockMenu(node, top));
        }}
      />
    </div>
  );
});

function BB({ icon, label, active, run, glyph, italic, strike, shortcut }: { icon: IconName; label: string; active?: boolean; run: () => void; glyph?: string; italic?: boolean; strike?: boolean; shortcut?: string }) {
  return (
    <button
      className={`bb-btn ${active ? "is-active" : ""}`}
      aria-label={label}
      data-tip={shortcut ? `${label}  ${shortcut}` : label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {glyph ? <span className={`bb-glyph ${italic ? "is-italic" : ""} ${strike ? "is-strike" : ""}`}>{glyph}</span> : <Icon name={icon} size={15} />}
    </button>
  );
}

function setDir(editor: Editor, pos: number, dir: "rtl" | "ltr" | null) {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, dir }));
}

function duplicateBlock(editor: Editor, pos: number, node: PMNode) {
  const json = node.toJSON() as JSONContent;
  const copy = { ...json, attrs: { ...(json.attrs ?? {}), bid: null } };
  editor.chain().focus().insertContentAt(pos + node.nodeSize, copy).run();
}

function moveBlock(editor: Editor, pos: number, delta: -1 | 1) {
  const { doc } = editor.state;
  const $pos = doc.resolve(pos);
  const index = $pos.index(0);
  const target = index + delta;
  if (target < 0 || target >= doc.childCount) return;
  const node = doc.child(index);
  const other = doc.child(target);
  const tr = editor.state.tr;
  if (delta === -1) {
    const otherPos = pos - other.nodeSize;
    tr.delete(pos, pos + node.nodeSize).insert(otherPos, node);
  } else {
    const after = pos + node.nodeSize + other.nodeSize;
    tr.insert(after, node).delete(pos, pos + node.nodeSize);
  }
  editor.view.dispatch(tr);
}

function applyRemaps(editor: Editor, remaps: [string, string][]) {
  const map = new Map(remaps);
  const tr = editor.state.tr;
  editor.state.doc.forEach((node, offset) => {
    const next = map.get(node.attrs.bid);
    if (next) tr.setNodeMarkup(offset, undefined, { ...node.attrs, bid: next });
  });
  if (tr.docChanged) editor.view.dispatch(tr.setMeta("addToHistory", false));
}
