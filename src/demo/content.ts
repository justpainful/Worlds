/**
 * Small builders for editor blocks (Tiptap JSON), in the same shape the
 * backend's Markdown dialect produces (src-tauri/src/content.rs), so content
 * made here looks and behaves like content typed by hand. Inline text accepts
 * **bold**, *italic*, ==highlight== and `code`.
 */
import type { JSONContent } from "@tiptap/core";

const INLINE = /(\*\*[^*]+\*\*|==[^=]+==|`[^`]+`|\*[^*\s][^*]*\*)/g;

export function inline(src: string): JSONContent[] {
  const out: JSONContent[] = [];
  let last = 0;
  for (const m of src.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ type: "text", text: src.slice(last, at) });
    const token = m[0];
    const [mark, inner] = token.startsWith("**")
      ? ["bold", token.slice(2, -2)]
      : token.startsWith("==")
        ? ["highlight", token.slice(2, -2)]
        : token.startsWith("`")
          ? ["code", token.slice(1, -1)]
          : ["italic", token.slice(1, -1)];
    out.push({ type: "text", text: inner, marks: [{ type: mark }] });
    last = at + token.length;
  }
  if (last < src.length) out.push({ type: "text", text: src.slice(last) });
  return out;
}

export function p(text = ""): JSONContent {
  const content = inline(text);
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
}

export function h(level: 1 | 2 | 3, text: string): JSONContent {
  return { type: "heading", attrs: { level }, content: inline(text) };
}

export function bullets(items: string[]): JSONContent {
  return { type: "bulletList", content: items.map((t) => ({ type: "listItem", content: [p(t)] })) };
}

export function numbered(items: string[]): JSONContent {
  return { type: "orderedList", attrs: { start: 1 }, content: items.map((t) => ({ type: "listItem", content: [p(t)] })) };
}

export function tasks(items: [text: string, done: boolean][]): JSONContent {
  return { type: "taskList", content: items.map(([t, checked]) => ({ type: "taskItem", attrs: { checked }, content: [p(t)] })) };
}

export function callout(tone: "note" | "highlight" | "warning" | "success", ...lines: string[]): JSONContent {
  return { type: "callout", attrs: { tone }, content: lines.map((l) => p(l)) };
}

export function quote(text: string): JSONContent {
  return { type: "blockquote", content: [p(text)] };
}

export function hr(): JSONContent {
  return { type: "horizontalRule" };
}

/** A table whose first row is the header row. */
export function table(rows: string[][]): JSONContent {
  return {
    type: "table",
    content: rows.map((cells, r) => ({
      type: "tableRow",
      content: cells.map((c) => ({ type: r === 0 ? "tableHeader" : "tableCell", content: [p(c)] })),
    })),
  };
}

/** All text in a list of blocks, for previews and checks. */
export function plainText(nodes: JSONContent[]): string {
  const out: string[] = [];
  const walk = (n: JSONContent) => {
    if (typeof n.text === "string") out.push(n.text);
    n.content?.forEach(walk);
  };
  nodes.forEach(walk);
  return out.join(" ");
}
