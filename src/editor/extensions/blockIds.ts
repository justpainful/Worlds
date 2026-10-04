import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

/** Node types that can be top-level blocks. */
export const BLOCK_TYPES = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "taskList",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "table",
  "callout",
  "prompt",
  "pageLink",
  "image",
  "video",
  "file",
  "embed",
  "discordMessage",
  "schedule",
  "columns",
  "toggle",
  "collection",
  "toc",
  "gallery",
];

export function newBlockId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

const key = new PluginKey("worlds-block-ids");

/**
 * Every top-level block carries a stable `bid` (so storage, history and AI
 * tools address blocks individually) and a `dir` (auto / rtl / ltr) for
 * paragraph-level bidi. Splits, pastes and duplicates get fresh ids.
 */
export const BlockIds = Extension.create({
  name: "blockIds",

  addGlobalAttributes() {
    return [
      {
        types: BLOCK_TYPES,
        attributes: {
          bid: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el) => el.getAttribute("data-bid"),
            renderHTML: (attrs) => (attrs.bid ? { "data-bid": attrs.bid } : {}),
          },
          dir: {
            default: null,
            parseHTML: (el) => {
              const d = el.getAttribute("dir");
              return d === "rtl" || d === "ltr" ? d : null;
            },
            renderHTML: (attrs) => ({ dir: attrs.dir === "rtl" || attrs.dir === "ltr" ? attrs.dir : "auto" }),
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        appendTransaction: (trs, _old, state) => {
          if (!trs.some((t) => t.docChanged)) return null;
          const seen = new Set<string>();
          let tr = null as ReturnType<typeof state.tr.setNodeMarkup> | null;
          state.doc.forEach((node, offset) => {
            if (!node.type.spec.attrs?.bid && !("bid" in node.attrs)) return;
            const id = node.attrs.bid as string | null;
            if (!id || seen.has(id)) {
              const fresh = newBlockId();
              tr = (tr ?? state.tr).setNodeMarkup(offset, undefined, { ...node.attrs, bid: fresh });
              seen.add(fresh);
            } else {
              seen.add(id);
            }
          });
          if (tr) tr.setMeta("addToHistory", false);
          return tr;
        },
      }),
    ];
  },
});
