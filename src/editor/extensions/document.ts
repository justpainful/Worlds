/**
 * Extensions for Documents (on top of the page editor):
 *
 *  - Character formatting as TextStyle marks (font, size, line height,
 *    colour). Marks carry over to text typed next to them and to new
 *    paragraphs, so typing inside formatted text keeps its formatting; nothing
 *    picks a style on its own.
 *  - Paragraph styles as a single attribute on paragraphs (Normal, Title,
 *    Subtitle, Caption) next to headings and quotes, instead of ad hoc sizes.
 *  - Alignment for paragraphs and headings.
 */
import { Extension } from "@tiptap/core";
import TextAlign from "@tiptap/extension-text-align";
import { FontFamily, FontSize, LineHeight } from "@tiptap/extension-text-style";

export type ParagraphStyle = "normal" | "title" | "subtitle" | "caption";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    paragraphStyle: {
      setParagraphStyle: (style: ParagraphStyle) => ReturnType;
    };
  }
}

export const ParagraphStyles = Extension.create({
  name: "paragraphStyle",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          pstyle: {
            default: "normal",
            parseHTML: (el) => (el.getAttribute("data-pstyle") as ParagraphStyle) || "normal",
            renderHTML: (attrs) => (attrs.pstyle && attrs.pstyle !== "normal" ? { "data-pstyle": attrs.pstyle } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setParagraphStyle:
        (style) =>
        ({ chain }) =>
          chain().setNode("paragraph", { pstyle: style }).run(),
    };
  },
});

export const documentExtensions = [
  FontFamily,
  FontSize,
  LineHeight,
  TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right", "justify"] }),
  ParagraphStyles,
];
