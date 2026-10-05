/**
 * More page blocks: LaTeX math (inline and display), Mermaid diagrams,
 * charts drawn from a table on the page, and tabs.
 */
import { InputRule, Node, PasteRule, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { ChartView, MathBlockView, MathInlineView, MermaidView, TabsView } from "../views/Pages4Views";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pages4: {
      insertMath: (latex?: string, display?: boolean) => ReturnType;
      insertMermaid: (code?: string) => ReturnType;
      insertChart: (attrs?: Record<string, unknown>) => ReturnType;
      insertTabs: (titles?: string[]) => ReturnType;
    };
  }
}

/** Inline math: $x^2$ while typing, or pasted. */
export const MathInline = Node.create({
  name: "mathInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { latex: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "span[data-math]", getAttrs: (el) => ({ latex: (el as HTMLElement).getAttribute("data-math") ?? "" }) }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-math": node.attrs.latex })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(MathInlineView);
  },
  addInputRules() {
    // $...$ followed by a space or punctuation (not $$, not a lone price like $5 ).
    return [
      new InputRule({
        find: /(?:^|[^$\w])\$([^$\s][^$]*?[^$\s\\]|[^$\s])\$$/,
        handler: ({ state, range, match }) => {
          const latex = match[1];
          const start = range.from + match[0].indexOf("$");
          state.tr.replaceWith(start, range.to, this.type.create({ latex }));
        },
      }),
    ];
  },
  addPasteRules() {
    return [
      new PasteRule({
        find: /\$([^$\n]+?)\$/g,
        handler: ({ state, range, match }) => {
          state.tr.replaceWith(range.from, range.to, this.type.create({ latex: match[1] }));
        },
      }),
    ];
  },
  addCommands() {
    return {
      insertMath:
        (latex = "", display = false) =>
        ({ commands }) =>
          commands.insertContent({ type: display ? "mathBlock" : "mathInline", attrs: { latex } }),
    };
  },
});

/** Display math on its own line: type $$ then Enter, or use /Equation. */
export const MathBlock = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return { latex: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "div[data-math-block]", getAttrs: (el) => ({ latex: (el as HTMLElement).getAttribute("data-math-block") ?? "" }) }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-math-block": node.attrs.latex })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(MathBlockView);
  },
  addInputRules() {
    return [
      new InputRule({
        find: /^\$\$\s$/,
        handler: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          state.tr.replaceRangeWith($from.before(), $from.after(), this.type.create({ latex: "" }));
        },
      }),
    ];
  },
});

export const Mermaid = Node.create({
  name: "mermaid",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return { code: { default: "flowchart LR\n  A[Idea] --> B[Plan] --> C[Ship]" } };
  },
  parseHTML() {
    return [{ tag: "div[data-mermaid]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-mermaid": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(MermaidView);
  },
  addCommands() {
    return {
      insertMermaid:
        (code) =>
        ({ commands }) =>
          commands.insertContent({ type: "mermaid", attrs: code ? { code } : {} }),
    };
  },
});

/** A chart that reads a table on the same page and redraws as it changes. */
export const Chart = Node.create({
  name: "chart",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      source: { default: "" }, // bid of a table block on this page
      kind: { default: "bar" }, // bar | line | pie | area
      title: { default: "" },
      labelColumn: { default: 0 },
      valueColumns: { default: null }, // null = every numeric column
      stacked: { default: false },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-chart]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-chart": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ChartView);
  },
  addCommands() {
    return {
      insertChart:
        (attrs = {}) =>
        ({ commands }) =>
          commands.insertContent({ type: "chart", attrs }),
    };
  },
});

/** Tabs: each tab holds ordinary blocks; only the chosen tab shows. */
export const Tabs = Node.create({
  name: "tabs",
  group: "block",
  content: "tab+",
  defining: true,
  isolating: true,
  draggable: true,
  addAttributes() {
    return { active: { default: 0 } };
  },
  parseHTML() {
    return [{ tag: "div[data-tabs]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-tabs": "", class: "tabs-block" }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(TabsView);
  },
  addCommands() {
    return {
      insertTabs:
        (titles = ["Notes", "Files", "Tasks"]) =>
        ({ commands }) =>
          commands.insertContent({
            type: "tabs",
            content: titles.map((title) => ({ type: "tab", attrs: { title }, content: [{ type: "paragraph" }] })),
          }),
    };
  },
});

export const Tab = Node.create({
  name: "tab",
  content: "block+",
  isolating: true,
  addAttributes() {
    // Rendered as data-tab below, not as a title attribute (no tooltip).
    return { title: { default: "Tab", renderHTML: () => ({}) } };
  },
  parseHTML() {
    return [{ tag: "div[data-tab]", getAttrs: (el) => ({ title: (el as HTMLElement).getAttribute("data-tab") ?? "Tab" }) }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-tab": node.attrs.title, class: "tab-panel" }), 0];
  },
});
