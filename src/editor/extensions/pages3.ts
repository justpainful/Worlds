import { Extension, Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import Suggestion from "@tiptap/suggestion";
import { PageMention } from "./suggest";
import { GalleryView, TocView } from "../views/Pages3Views";

export { TextStyle, Color, BackgroundColor } from "@tiptap/extension-text-style";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pages3: {
      insertToc: () => ReturnType;
      insertGallery: (images?: { attachmentId: string; name: string }[]) => ReturnType;
    };
    findReplace: {
      setFind: (query: string, matchCase?: boolean) => ReturnType;
      findStep: (dir: 1 | -1) => ReturnType;
      replaceCurrent: (text: string) => ReturnType;
      replaceAll: (text: string) => ReturnType;
      clearFind: () => ReturnType;
    };
  }
}

/** `[[` opens the same page picker as `@`, for people used to wiki links. */
export const WikiLink = Extension.create({
  name: "wikiLink",
  addProseMirrorPlugins() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const base = (PageMention as any).options.suggestion;
    return [Suggestion({ ...base, editor: this.editor, char: "[[", pluginKey: new PluginKey("worlds-wikilink"), allowSpaces: true })];
  },
});

/** A live table of contents: it follows the page's headings as they change. */
export const Toc = Node.create({
  name: "toc",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  parseHTML() {
    return [{ tag: "div[data-toc]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-toc": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(TocView);
  },
  addCommands() {
    return {
      insertToc:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: "toc" }),
    };
  },
});

/** Several pictures as one tidy grid, opening in a full-screen viewer. */
export const Gallery = Node.create({
  name: "gallery",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      images: { default: [] },
      columns: { default: 3 },
      gap: { default: 8 },
      aspect: { default: "square" }, // square | landscape | portrait | natural
      caption: { default: "" },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-gallery]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-gallery": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(GalleryView);
  },
  addCommands() {
    return {
      insertGallery:
        (images = []) =>
        ({ commands }) =>
          commands.insertContent({ type: "gallery", attrs: { images } }),
    };
  },
});

// ---------------------------------------------------------------------------
// Find and replace
// ---------------------------------------------------------------------------

interface FindState {
  query: string;
  matchCase: boolean;
  index: number;
  matches: { from: number; to: number }[];
  deco: DecorationSet;
}

export const findKey = new PluginKey<FindState>("worlds-find");

function scan(doc: PMNode, query: string, matchCase: boolean) {
  const out: { from: number; to: number }[] = [];
  if (!query) return out;
  const q = matchCase ? query : query.toLowerCase();
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = matchCase ? node.text : node.text.toLowerCase();
    let i = text.indexOf(q);
    while (i !== -1) {
      out.push({ from: pos + i, to: pos + i + q.length });
      i = text.indexOf(q, i + q.length);
    }
  });
  return out;
}

function decorate(doc: PMNode, matches: { from: number; to: number }[], index: number) {
  return DecorationSet.create(
    doc,
    matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === index ? "find-hit is-current" : "find-hit" })),
  );
}

export const FindReplace = Extension.create({
  name: "findReplace",
  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: () => ({ query: "", matchCase: false, index: 0, matches: [], deco: DecorationSet.empty }),
          apply(tr, prev, _old, state) {
            const meta = tr.getMeta(findKey) as Partial<FindState> | undefined;
            if (!meta && !tr.docChanged) return prev;
            const query = meta?.query ?? prev.query;
            const matchCase = meta?.matchCase ?? prev.matchCase;
            const matches = scan(state.doc, query, matchCase);
            const index = Math.min(Math.max(0, meta?.index ?? prev.index), Math.max(0, matches.length - 1));
            return { query, matchCase, index, matches, deco: decorate(state.doc, matches, index) };
          },
        },
        props: {
          decorations(state) {
            return findKey.getState(state)?.deco ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
  addCommands() {
    const reveal = (view: import("@tiptap/pm/view").EditorView, pos: number) => {
      const dom = view.domAtPos(pos).node as HTMLElement;
      (dom.nodeType === 1 ? dom : dom.parentElement)?.scrollIntoView({ block: "center", behavior: "smooth" });
    };
    return {
      setFind:
        (query, matchCase = false) =>
        ({ tr, dispatch }) => {
          dispatch?.(tr.setMeta(findKey, { query, matchCase, index: 0 }));
          return true;
        },
      findStep:
        (dir) =>
        ({ state, tr, dispatch, view }) => {
          const s = findKey.getState(state);
          if (!s?.matches.length) return false;
          const index = (s.index + dir + s.matches.length) % s.matches.length;
          dispatch?.(tr.setMeta(findKey, { index }));
          reveal(view, s.matches[index].from);
          return true;
        },
      replaceCurrent:
        (text) =>
        ({ state, tr, dispatch }) => {
          const s = findKey.getState(state);
          const m = s?.matches[s.index];
          if (!m) return false;
          if (text) tr.insertText(text, m.from, m.to);
          else tr.delete(m.from, m.to);
          dispatch?.(tr);
          return true;
        },
      replaceAll:
        (text) =>
        ({ state, tr, dispatch }) => {
          const s = findKey.getState(state);
          if (!s?.matches.length) return false;
          // Back to front, so earlier positions stay valid.
          [...s.matches].reverse().forEach((m) => (text ? tr.insertText(text, m.from, m.to) : tr.delete(m.from, m.to)));
          dispatch?.(tr);
          return true;
        },
      clearFind:
        () =>
        ({ tr, dispatch }) => {
          dispatch?.(tr.setMeta(findKey, { query: "", index: 0 }));
          return true;
        },
    };
  },
});
