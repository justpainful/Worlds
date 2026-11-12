import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { uiLanguage } from "../../i18n/ui";

type Dir = "rtl" | "ltr";

const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const LETTER = /\p{L}/u;

/** The direction of the first letter in the text, or null when it has none. */
export function firstStrong(text: string): Dir | null {
  for (const ch of text) {
    if (RTL.test(ch)) return "rtl";
    if (LETTER.test(ch)) return "ltr";
  }
  return null;
}

/**
 * Text blocks with no letters of their own (an empty line, "/", "12") read as
 * left to right under dir="auto", so in an Arabic page a new line and the
 * slash menu jumped to the left. Such a block takes the direction of the
 * block before it, as word processors do; blocks before any letter take the
 * first direction found, and a page with no letters at all takes `fallback`.
 * The bidi-neutral class lifts unicode-bidi: plaintext, which ignores dir.
 */
export function neutralDirections(doc: PMNode, fallback: Dir): { from: number; to: number; dir: Dir }[] {
  const out: { from: number; to: number; dir: Dir }[] = [];
  const waiting: { from: number; to: number }[] = [];
  let last: Dir | null = null;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (!("dir" in node.attrs)) return false;
    const set = node.attrs.dir === "rtl" || node.attrs.dir === "ltr" ? (node.attrs.dir as Dir) : null;
    const own = set ?? firstStrong(node.textContent);
    if (own) {
      for (const w of waiting) out.push({ ...w, dir: own });
      waiting.length = 0;
      last = own;
    } else if (last) out.push({ from: pos, to: pos + node.nodeSize, dir: last });
    else waiting.push({ from: pos, to: pos + node.nodeSize });
    return false;
  });
  for (const w of waiting) out.push({ ...w, dir: fallback });
  return out;
}

const key = new PluginKey<DecorationSet>("neutralDirection");

function build(doc: PMNode): DecorationSet {
  const fallback: Dir = uiLanguage() === "ar" ? "rtl" : "ltr";
  return DecorationSet.create(
    doc,
    neutralDirections(doc, fallback).map((d) => Decoration.node(d.from, d.to, { dir: d.dir, class: "bidi-neutral" })),
  );
}

export const NeutralDirection = Extension.create({
  name: "neutralDirection",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        state: {
          init: (_, state) => build(state.doc),
          // A language switch changes the direction of a page with no letters yet.
          apply: (tr, old) => (tr.docChanged || tr.getMeta("languageChanged") ? build(tr.doc) : old),
        },
        props: {
          decorations: (state) => key.getState(state),
        },
      }),
    ];
  },
});
