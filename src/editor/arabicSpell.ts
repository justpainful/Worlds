/**
 * Arabic spelling: common mistakes in hamzas, taa marbuta, alif maqsura and
 * joined words are underlined as you type; click one to fix it or ignore
 * it. Rules only, nothing leaves the device. Settings › Editor turns it off.
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { menuAt } from "../ui/Menu";
import { useStore } from "../state/store";
import { tr } from "../i18n/ui";
import { findArabicMistakes, ignoreArabicWord } from "./arabicRules";

function build(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock || node.type.name === "codeBlock") return node.type.name !== "codeBlock";
    const text = node.textBetween(0, node.content.size, "\n", "￼");
    for (const m of findArabicMistakes(text)) {
      decos.push(Decoration.inline(pos + 1 + m.from, pos + 1 + m.to, { class: "ar-spell", "data-fix": m.fix, "data-word": m.word }));
    }
    return false;
  });
  return DecorationSet.create(doc, decos);
}

const key = new PluginKey<DecorationSet>("arabicSpell");

export const ArabicSpell = Extension.create({
  name: "arabicSpell",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, state) => (useStore.getState().settings["editor.arabicSpell"] === false ? DecorationSet.empty : build(state.doc)),
          apply: (tr, old, _o, state) => {
            if (useStore.getState().settings["editor.arabicSpell"] === false) return DecorationSet.empty;
            if (tr.docChanged || tr.getMeta(key)) return build(state.doc);
            return old.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations: (state) => key.getState(state),
          handleClick(view, pos, event) {
            const el = (event.target as HTMLElement).closest<HTMLElement>(".ar-spell");
            if (!el || !view.editable) return false;
            const fix = el.dataset.fix ?? "";
            const word = el.dataset.word ?? "";
            const found = (key.getState(view.state)?.find(pos, pos) ?? [])[0];
            if (!found) return false;
            menuAt(el, [
              { kind: "label", label: tr("Arabic spelling") },
              {
                label: fix,
                icon: "check",
                onSelect: () => view.dispatch(view.state.tr.insertText(fix, found.from, found.to)),
              },
              {
                label: tr("Ignore this word"),
                icon: "close",
                onSelect: () => {
                  ignoreArabicWord(word);
                  view.dispatch(view.state.tr.setMeta(key, true));
                },
              },
            ]);
            return true;
          },
        },
      }),
    ];
  },
});
