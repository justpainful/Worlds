/**
 * Pages 2.0 blocks: synced blocks, buttons, voice notes, footnotes, forms,
 * runnable code and whiteboards.
 */
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { newSyncId } from "../synced";
import { tr } from "../../i18n/ui";
import {
  ButtonBlockView,
  CodeRunView,
  FootnoteView,
  FootnotesView,
  FormBlockView,
  SyncedView,
  VoiceNoteView,
  WhiteboardView,
} from "../views/Pages5Views";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pages5: {
      insertSynced: () => ReturnType;
      insertButtonBlock: (attrs?: Record<string, unknown>) => ReturnType;
      insertVoiceNote: () => ReturnType;
      insertFootnote: (text?: string) => ReturnType;
      insertForm: () => ReturnType;
      insertCodeRun: (language?: "javascript" | "python") => ReturnType;
      insertWhiteboard: () => ReturnType;
    };
  }
}

/**
 * Interactive blocks keep their own pointer and key events, so clicking a
 * field or the board never hands the caret back to the page. Drags still
 * reach the editor, so the block can be moved by its handle.
 */
const keepEvents = ({ event }: { event: Event }) => !event.type.startsWith("drag") && !event.type.startsWith("drop");

/** JSON held in a string attribute, parsed on read. */
const jsonAttr = <T>(name: string, fallback: T) => ({
  default: fallback,
  parseHTML: (el: HTMLElement) => {
    try {
      return JSON.parse(el.getAttribute(`data-${name}`) ?? "") as T;
    } catch {
      return fallback;
    }
  },
  renderHTML: (attrs: Record<string, unknown>) => ({ [`data-${name}`]: JSON.stringify(attrs[name] ?? fallback) }),
});

/** The same blocks on several pages: edit any copy and the others follow. */
export const Synced = Node.create({
  name: "synced",
  group: "block",
  content: "block+",
  defining: true,
  isolating: true,
  draggable: true,
  addAttributes() {
    return { syncId: { default: null } };
  },
  parseHTML() {
    return [{ tag: "div[data-synced]", getAttrs: (el) => ({ syncId: (el as HTMLElement).getAttribute("data-synced") }) }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-synced": node.attrs.syncId, class: "synced-block" }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(SyncedView);
  },
  addCommands() {
    return {
      insertSynced:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: "synced", attrs: { syncId: newSyncId() }, content: [{ type: "paragraph" }] }),
    };
  },
});

/** A button that inserts text, opens a page, runs an automation, uses a template or asks Claude. */
export const ButtonBlock = Node.create({
  name: "buttonBlock",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      label: { default: "" },
      action: { default: "insert" },
      value: { default: "" },
      style: { default: "tinted" },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-button-block]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-button-block": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ButtonBlockView, { stopEvent: keepEvents });
  },
  addCommands() {
    return {
      insertButtonBlock:
        (attrs = {}) =>
        ({ commands }) =>
          commands.insertContent({ type: "buttonBlock", attrs }),
    };
  },
});

/** A recorded voice note with its transcript. */
export const VoiceNote = Node.create({
  name: "voiceNote",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      attachmentId: { default: null },
      transcript: { default: "" },
      duration: { default: 0 },
      lang: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-voice-note]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-voice-note": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(VoiceNoteView, { stopEvent: keepEvents });
  },
  addCommands() {
    return {
      insertVoiceNote:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: "voiceNote" }),
    };
  },
});

/** A numbered note in the text; its words are listed with the others at the end of the page. */
export const Footnote = Node.create({
  name: "footnote",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { text: { default: "" }, fid: { default: null } };
  },
  parseHTML() {
    return [{ tag: "sup[data-footnote]", getAttrs: (el) => ({ text: (el as HTMLElement).getAttribute("data-footnote") ?? "" }) }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return ["sup", mergeAttributes(HTMLAttributes, { "data-footnote": node.attrs.text })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(FootnoteView);
  },
  addCommands() {
    return {
      insertFootnote:
        (text = "") =>
        ({ chain, state }) => {
          let hasList = false;
          state.doc.forEach((n) => {
            if (n.type.name === "footnotes") hasList = true;
          });
          const fid = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
          const c = chain().insertContent({ type: "footnote", attrs: { text, fid } });
          if (!hasList) c.insertContentAt(state.doc.content.size + 1, { type: "footnotes" });
          return c.run();
        },
    };
  },
});

/** The list of a page's footnotes, in the order they appear. */
export const Footnotes = Node.create({
  name: "footnotes",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: "div[data-footnotes]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-footnotes": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(FootnotesView);
  },
});

export interface FormField {
  id: string;
  label: string;
  type: "text" | "longtext" | "number" | "date" | "select" | "checkbox" | "email";
  options?: string[];
  required?: boolean;
}

/** A form inside the page: each response becomes a subpage with one property per field. */
export const FormBlock = Node.create({
  name: "formBlock",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      title: { default: "" },
      description: { default: "" },
      fields: jsonAttr<FormField[]>("fields", []),
      target: { default: null },
      submit: { default: "" },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-form-block]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-form-block": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(FormBlockView, { stopEvent: keepEvents });
  },
  addCommands() {
    return {
      insertForm:
        () =>
        ({ commands }) =>
          commands.insertContent({
            type: "formBlock",
            attrs: {
              title: "",
              fields: [
                { id: "name", label: tr("Name"), type: "text", required: true },
                { id: "email", label: tr("Email"), type: "email" },
                { id: "message", label: tr("Message"), type: "longtext" },
              ],
            },
          }),
    };
  },
});

/** Code you can run in the page: JavaScript, or Python through Pyodide. */
export const CodeRun = Node.create({
  name: "codeRun",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      language: { default: "javascript" },
      code: { default: "" },
      output: { default: "" },
      ok: { default: true },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-code-run]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-code-run": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CodeRunView, { stopEvent: keepEvents });
  },
  addCommands() {
    return {
      insertCodeRun:
        (language = "javascript") =>
        ({ commands }) =>
          commands.insertContent({
            type: "codeRun",
            attrs: { language, code: language === "python" ? 'print("Hello from Worlds")' : 'console.log("Hello from Worlds");' },
          }),
    };
  },
});

export interface WhiteboardItem {
  id: string;
  kind: "sticky" | "text" | "rect" | "ellipse" | "arrow" | "pen" | "image" | "page";
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  color?: string;
  points?: [number, number][];
  /** Arrow ends, as item ids it is attached to. */
  from?: string | null;
  to?: string | null;
  attachmentId?: string;
  pageId?: string;
}

/** An open board inside the page: sticky notes, text, shapes, arrows, pen strokes, pictures and pages. */
export const Whiteboard = Node.create({
  name: "whiteboard",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      items: jsonAttr<WhiteboardItem[]>("items", []),
      height: { default: 460 },
      view: jsonAttr<{ x: number; y: number; zoom: number }>("view", { x: 0, y: 0, zoom: 1 }),
    };
  },
  parseHTML() {
    return [{ tag: "div[data-whiteboard]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-whiteboard": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(WhiteboardView, { stopEvent: keepEvents });
  },
  addCommands() {
    return {
      insertWhiteboard:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: "whiteboard" }),
    };
  },
});

export const pages5Extensions = [Synced, ButtonBlock, VoiceNote, Footnote, Footnotes, FormBlock, CodeRun, Whiteboard];
