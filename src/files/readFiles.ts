/**
 * Text inside pictures and PDFs. Claude reads the file once; the words go
 * into the page (in a folded section under the file), so search finds them
 * like any other text. A PDF can also become a page of its own to read and
 * highlight, and a page's highlights can be gathered at the top.
 */
import type { Editor, JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { api, errorMessage } from "../lib/api";
import { useStore } from "../state/store";
import { tr } from "../i18n/ui";
import type { MenuItem } from "../ui/Menu";

const toast = (message: string, tone?: "error" | "success") => useStore.getState().toast({ message, tone });
const isPdf = (n: PMNode) => /pdf/i.test(String(n.attrs.mime)) || /\.pdf$/i.test(String(n.attrs.name));
const readable = (n: PMNode) => !!n.attrs.attachmentId && (n.type.name === "image" || (n.type.name === "file" && (isPdf(n) || /^image\//.test(String(n.attrs.mime)))));

const paragraphs = (text: string): JSONContent[] =>
  text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] }));

/** Put the text Claude reads from a picture or PDF in a folded section under it. */
export async function readTextInto(editor: Editor, node: PMNode, pos: number) {
  toast(tr("Claude is reading the file"));
  try {
    const text = await api.aiReadFile(
      node.attrs.attachmentId,
      "Write out all the text in this file exactly as it appears, keeping paragraphs and the original language. If it has no text, describe it in one sentence.",
    );
    const at = Math.min(pos + node.nodeSize, editor.state.doc.content.size);
    editor
      .chain()
      .focus()
      .insertContentAt(at, {
        type: "toggle",
        attrs: { open: false },
        content: [{ type: "paragraph", content: [{ type: "text", text: `${tr("Text in")} ${node.attrs.name || tr("this picture")}` }] }, ...paragraphs(text)],
      })
      .run();
    toast(tr("The text is in the page now, and search finds it."), "success");
  } catch (e) {
    toast(errorMessage(e), "error");
  }
}

/** A PDF as a page of its own: its text in Markdown, to read, highlight and search. */
export async function pdfAsPage(pageId: string, node: PMNode) {
  toast(tr("Claude is turning the PDF into a page"));
  try {
    const md = await api.aiReadFile(
      node.attrs.attachmentId,
      "Convert the whole document to clean Markdown: keep the headings, paragraphs, lists and tables, in the original language. Leave out page numbers, running headers and footers.",
    );
    const s = useStore.getState();
    const meta = await api.createPage({ title: String(node.attrs.name || "PDF").replace(/\.pdf$/i, ""), parentId: pageId, markdown: md } as never);
    await s.refreshPages();
    s.openPage(meta.id);
  } catch (e) {
    toast(errorMessage(e), "error");
  }
}

/** Block menu items for pictures and PDFs. */
export function fileActions(editor: Editor, pageId: string, node: PMNode, pos: number): MenuItem[] {
  if (!editor.isEditable || !readable(node)) return [];
  const items: MenuItem[] = [{ label: "Read the Text in It", icon: "reader", onSelect: () => void readTextInto(editor, node, pos) }];
  if (isPdf(node)) items.push({ label: "Open as a Page to Read and Highlight", icon: "pen", onSelect: () => void pdfAsPage(pageId, node) });
  return items;
}

/** Gather every highlighted passage of the page into a list at the top. */
export function collectHighlights(editor: Editor) {
  // Neighbouring highlighted pieces of one passage are joined.
  const passages: string[] = [];
  let run = "";
  editor.state.doc.descendants((n) => {
    if (n.isTextblock) {
      if (run.trim()) passages.push(run.trim());
      run = "";
      n.forEach((c) => {
        if (c.isText && c.marks.some((m) => m.type.name === "highlight")) run += c.text;
        else if (run.trim()) {
          passages.push(run.trim());
          run = "";
        }
      });
      if (run.trim()) passages.push(run.trim());
      run = "";
      return false;
    }
    return true;
  });
  if (!passages.length) return toast(tr("Highlight some text first (select it, then Highlight)."));
  editor
    .chain()
    .insertContentAt(0, [
      { type: "callout", attrs: { tone: "highlight" }, content: [{ type: "paragraph", content: [{ type: "text", text: `${tr("Highlights")} (${passages.length})`, marks: [{ type: "bold" }] }] }, { type: "bulletList", content: passages.map((p) => ({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: p }] }] })) }] },
    ])
    .run();
  toast(`${passages.length} ${tr("highlights gathered at the top")}`, "success");
}
