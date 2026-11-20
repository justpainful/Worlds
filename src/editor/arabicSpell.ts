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

/** Wrong spelling → right spelling. Whole words only. */
export const ARABIC_FIXES: Record<string, string> = {
  "انشاء الله": "إن شاء الله",
  "إنشاء الله": "إن شاء الله",
  "انشالله": "إن شاء الله",
  "ماشاء الله": "ما شاء الله",
  "الى": "إلى",
  "انا": "أنا",
  "انت": "أنت",
  "انتم": "أنتم",
  "اين": "أين",
  "اذا": "إذا",
  "او": "أو",
  "الان": "الآن",
  "امس": "أمس",
  "اسف": "آسف",
  "اولاد": "أولاد",
  "هاذا": "هذا",
  "هاذه": "هذه",
  "هاذي": "هذي",
  "لاكن": "لكن",
  "لاكنه": "لكنه",
  "ذالك": "ذلك",
  "هاكذا": "هكذا",
  "هاؤلاء": "هؤلاء",
  "هاولاء": "هؤلاء",
  "اللذي": "الذي",
  "اللتي": "التي",
  "الذى": "الذي",
  "التى": "التي",
  "فى": "في",
  "حتي": "حتى",
  "متي": "متى",
  "حتا": "حتى",
  "مستشفي": "مستشفى",
  "إبن": "ابن",
  "إسم": "اسم",
  "إثنين": "اثنين",
  "إمرأة": "امرأة",
  "إنتظار": "انتظار",
  "إستخدام": "استخدام",
  "إستعمال": "استعمال",
  "إتصال": "اتصال",
  "إجتماع": "اجتماع",
  "إختبار": "اختبار",
  "إنتهاء": "انتهاء",
  "إستراحة": "استراحة",
  "مسؤل": "مسؤول",
  "شيئ": "شيء",
  "مدرسه": "مدرسة",
  "جامعه": "جامعة",
  "صفحه": "صفحة",
  "ساعه": "ساعة",
  "طريقه": "طريقة",
  "مشكله": "مشكلة",
  "فكره": "فكرة",
  "كلمه": "كلمة",
  "سنه": "سنة",
  "شركه": "شركة",
  "رساله": "رسالة",
  "خطه": "خطة",
  "مهمه": "مهمة",
  "قائمه": "قائمة",
  "مجموعه": "مجموعة",
  "دقيقه": "دقيقة",
  "مقاله": "مقالة",
  "قصه": "قصة",
  "لغه": "لغة",
  "عربيه": "عربية",
  "انجليزيه": "إنجليزية",
  "الانجليزيه": "الإنجليزية",
  "العربيه": "العربية",
  "مراجعه": "مراجعة",
  "محاضره": "محاضرة",
  "جلسه": "جلسة",
  "تجربه": "تجربة",
  "اجابه": "إجابة",
  "اسئله": "أسئلة",
  "مساله": "مسألة",
};

const IGNORE_KEY = "worlds.arabicSpell.ignore";
function ignored(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(IGNORE_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function ignore(word: string) {
  try {
    localStorage.setItem(IGNORE_KEY, JSON.stringify([...ignored(), word].slice(-500)));
  } catch {
    /* private window */
  }
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Longest first, so "انشاء الله" wins over a part of it.
const PATTERN = new RegExp(
  `(?<![\\p{L}\\p{M}])(${Object.keys(ARABIC_FIXES)
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join("|")})(?![\\p{L}\\p{M}])`,
  "gu",
);

/** The mistakes in a text, with their offsets. */
export function findArabicMistakes(text: string): { from: number; to: number; word: string; fix: string }[] {
  if (!/[؀-ۿ]/.test(text)) return [];
  const skip = ignored();
  const out: { from: number; to: number; word: string; fix: string }[] = [];
  PATTERN.lastIndex = 0;
  for (let m = PATTERN.exec(text); m; m = PATTERN.exec(text)) {
    if (skip.has(m[1])) continue;
    out.push({ from: m.index, to: m.index + m[1].length, word: m[1], fix: ARABIC_FIXES[m[1]] });
  }
  return out;
}

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
                  ignore(word);
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
