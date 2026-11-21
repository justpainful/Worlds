/**
 * Cognition blocks: memory cards, open questions, thinking tools and the page
 * fingerprint, plus the "origin" mark that remembers where words came from.
 */
import { Mark, Node, Extension, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Fragment, Slice, type Node as PMNode, type Schema } from "@tiptap/pm/model";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { ArgumentView, CardBlockView, DecisionView, FingerprintView, ProsConsView, QuestionBlockView, WhysView } from "./BlockViews";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    cognition: {
      insertCognition: (type: CognitionBlock, attrs?: Record<string, unknown>) => ReturnType;
    };
  }
}

export type CognitionBlock = "cgCard" | "cgQuestion" | "cgArgument" | "cgProsCons" | "cgDecision" | "cgWhys" | "cgFingerprint";

const keepEvents = ({ event }: { event: Event }) => !event.type.startsWith("drag") && !event.type.startsWith("drop");

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

function atom(name: CognitionBlock, attrs: Record<string, unknown>, view: unknown) {
  return Node.create({
    name,
    group: "block",
    atom: true,
    draggable: true,
    selectable: true,
    addAttributes() {
      return attrs;
    },
    parseHTML() {
      return [{ tag: `div[data-${name.toLowerCase()}]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, { [`data-${name.toLowerCase()}`]: "" })];
    },
    addNodeView() {
      return ReactNodeViewRenderer(view as Parameters<typeof ReactNodeViewRenderer>[0], { stopEvent: keepEvents });
    },
  });
}

export interface Row {
  id: string;
  text: string;
  weight?: number;
}

export const CardBlock = atom("cgCard", { cardId: { default: null } }, CardBlockView);
export const QuestionBlock = atom("cgQuestion", { qid: { default: null } }, QuestionBlockView);
export const ArgumentBlock = atom(
  "cgArgument",
  { claim: { default: "" }, evidence: jsonAttr<Row[]>("evidence", []), counter: jsonAttr<Row[]>("counter", []) },
  ArgumentView,
);
export const ProsConsBlock = atom("cgProsCons", { topic: { default: "" }, pros: jsonAttr<Row[]>("pros", []), cons: jsonAttr<Row[]>("cons", []) }, ProsConsView);
export const DecisionBlock = atom(
  "cgDecision",
  { decision: { default: "" }, options: jsonAttr<Row[]>("options", []), why: { default: "" }, revisit: { default: null }, decided: { default: null } },
  DecisionView,
);
export const WhysBlock = atom("cgWhys", { problem: { default: "" }, whys: jsonAttr<Row[]>("whys", []) }, WhysView);
export const FingerprintBlock = atom("cgFingerprint", {}, FingerprintView);

export const CognitionCommands = Extension.create({
  name: "cognitionCommands",
  addCommands() {
    return {
      insertCognition:
        (type, attrs) =>
        ({ commands }) =>
          commands.insertContent({ type, attrs: attrs ?? {} }),
    };
  },
});

/** Where a run of words came from: pasted from elsewhere, written by Claude, or imported. */
export const OriginMark = Mark.create({
  name: "origin",
  inclusive: false,
  addAttributes() {
    return { kind: { default: "quoted" }, source: { default: null } };
  },
  parseHTML() {
    return [{ tag: "span[data-origin]", getAttrs: (el) => ({ kind: (el as HTMLElement).getAttribute("data-origin"), source: (el as HTMLElement).getAttribute("data-source") }) }];
  },
  renderHTML({ HTMLAttributes, mark }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-origin": mark.attrs.kind, "data-source": mark.attrs.source ?? undefined, class: `origin origin-${mark.attrs.kind}` }), 0];
  },
});

function markAll(fragment: Fragment, schema: Schema): Fragment {
  const type = schema.marks.origin;
  const out: PMNode[] = [];
  fragment.forEach((n) => {
    if (n.isText) out.push(type.isInSet(n.marks) ? n : n.mark(type.create({ kind: "quoted" }).addToSet(n.marks)));
    else out.push(n.copy(markAll(n.content, schema)));
  });
  return Fragment.from(out);
}

/**
 * Text pasted from outside Worlds is marked as quoted, so the page fingerprint
 * can tell your words from borrowed ones. Copying inside Worlds keeps marks as they were.
 */
export const OriginPaste = Extension.create({
  name: "originPaste",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("originPaste"),
        props: {
          handlePaste: (view, event, slice) => {
            const html = event.clipboardData?.getData("text/html") ?? "";
            if (html.includes("data-pm-slice") || !view.state.schema.marks.origin) return false;
            const text = slice.content.textBetween(0, slice.content.size, " ").trim();
            if (text.length < 20) return false;
            const marked = new Slice(markAll(slice.content, view.state.schema), slice.openStart, slice.openEnd);
            view.dispatch(view.state.tr.replaceSelection(marked).scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});

export const cognitionExtensions = [CardBlock, QuestionBlock, ArgumentBlock, ProsConsBlock, DecisionBlock, WhysBlock, FingerprintBlock, CognitionCommands, OriginMark, OriginPaste];
