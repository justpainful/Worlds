import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { CollectionView, ToggleView } from "../views/Pages2Views";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pages2: {
      insertColumns: (count: 2 | 3) => ReturnType;
      insertToggle: (heading?: 0 | 1 | 2 | 3) => ReturnType;
      insertCollection: (attrs?: Record<string, unknown>) => ReturnType;
    };
  }
}

/** Side-by-side columns. Each column holds ordinary blocks. */
export const Columns = Node.create({
  name: "columns",
  group: "block",
  content: "column{2,3}",
  defining: true,
  isolating: true,
  parseHTML() {
    return [{ tag: "div[data-columns]" }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-columns": node.childCount, class: "columns" }), 0];
  },
  addCommands() {
    return {
      insertColumns:
        (count) =>
        ({ commands }) =>
          commands.insertContent({
            type: "columns",
            content: Array.from({ length: count }, () => ({ type: "column", content: [{ type: "paragraph" }] })),
          }),
    };
  },
});

export const Column = Node.create({
  name: "column",
  content: "block+",
  isolating: true,
  parseHTML() {
    return [{ tag: "div[data-column]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-column": "", class: "column" }), 0];
  },
});

/**
 * A collapsible block. The first child is the always-visible summary (a
 * paragraph or heading); the rest folds away.
 */
export const Toggle = Node.create({
  name: "toggle",
  // Above the default keymap, so Enter on an empty last line leaves the toggle.
  priority: 1000,
  group: "block",
  content: "(paragraph | heading) block*",
  defining: true,
  addAttributes() {
    return { open: { default: true } };
  },
  parseHTML() {
    return [{ tag: "div[data-toggle]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-toggle": "", class: "toggle" }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ToggleView);
  },
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state } = editor;
        const { $from, empty } = state.selection;
        if (!empty || $from.depth < 2) return false;
        const d = $from.depth - 1;
        const toggle = $from.node(d);
        if (toggle.type.name !== "toggle") return false;
        const idx = $from.index(d);
        const para = $from.parent;
        // End of the summary: step into an empty first body line instead of adding another.
        if (idx === 0 && $from.parentOffset === para.content.size) {
          const next = toggle.maybeChild(1);
          if (next && next.type.name === "paragraph" && next.content.size === 0) {
            const at = $from.after($from.depth) + 1;
            return editor.chain().command(({ tr }) => (tr.setSelection(TextSelection.create(tr.doc, at)), true)).run();
          }
          return false;
        }
        // An empty body line with only empty lines after it: leave the toggle, like lists do.
        if (idx === 0 || para.content.size > 0) return false;
        for (let i = idx + 1; i < toggle.childCount; i++) {
          const c = toggle.child(i);
          if (c.type.name !== "paragraph" || c.content.size > 0) return false;
        }
        const start = $from.before($from.depth);
        const end = $from.end(d);
        const after = $from.after(d);
        return editor
          .chain()
          .command(({ tr }) => {
            tr.delete(start, end);
            const at = tr.mapping.map(after);
            tr.insert(at, state.schema.nodes.paragraph.create());
            tr.setSelection(TextSelection.create(tr.doc, at + 1));
            return true;
          })
          .run();
      },
    };
  },
  addCommands() {
    return {
      insertToggle:
        (heading = 0) =>
        ({ chain }) =>
          chain()
            .insertContent({
              type: "toggle",
              attrs: { open: true },
              content: [heading ? { type: "heading", attrs: { level: heading } } : { type: "paragraph" }, { type: "paragraph" }],
            })
            // The caret lands in the body; start in the summary line instead.
            .command(({ tr }) => {
              const $f = tr.selection.$from;
              const inToggleBody = $f.depth > 1 && $f.node($f.depth - 1).type.name === "toggle" && $f.index($f.depth - 1) > 0;
              if (inToggleBody) tr.setSelection(TextSelection.create(tr.doc, $f.before($f.depth) - 1));
              return true;
            })
            .run(),
    };
  },
});

/**
 * A live view of pages: this page's subpages (or every page with a tag), shown
 * as a table, a board grouped by Status, a gallery or a list.
 */
export const Collection = Node.create({
  name: "collection",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      title: { default: "" },
      source: { default: "children" }, // children | tag | all
      tag: { default: "" },
      view: { default: "table" }, // table | board | gallery | list
      groupBy: { default: "Status" },
      sortBy: { default: "updated" }, // updated | created | title | <property name>
      sortDir: { default: "desc" },
      filter: { default: "" },
      columns: { default: null }, // visible property names for table (null = all)
    };
  },
  parseHTML() {
    return [{ tag: "div[data-collection]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-collection": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CollectionView);
  },
  addCommands() {
    return {
      insertCollection:
        (attrs = {}) =>
        ({ commands }) =>
          commands.insertContent({ type: "collection", attrs }),
    };
  },
});
