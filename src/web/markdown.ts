/**
 * Worlds' constrained Markdown dialect, ported line for line from the
 * desktop backend (src-tauri/src/content.rs: from_markdown, to_markdown,
 * inline_markdown and their helpers) so the web version, which has no Rust
 * backend, builds exactly the same blocks the desktop does.
 *
 * Like the Rust, `fromMarkdown` leaves block ids to the caller (the desktop
 * store assigns them when it saves); `withBids` does that step here.
 *
 * Rust strings are UTF-8 and the parser walks Unicode scalar values, so the
 * inline parser works on code points (Array.from), and trimming follows
 * Rust's `char::is_whitespace`, which differs from String.prototype.trim.
 */

/** A ProseMirror / TipTap JSON node, as the backend stores it. */
export interface JSONLike {
  type?: string;
  attrs?: { [key: string]: unknown };
  content?: JSONLike[];
  marks?: JSONLike[];
  text?: string;
}

type Obj = { [key: string]: unknown };

// ---------------------------------------------------------------------------
// Small helpers mirroring serde_json access and Rust string methods
// ---------------------------------------------------------------------------

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function get(v: unknown, key: string): unknown {
  return isObj(v) && Object.hasOwn(v, key) ? v[key] : undefined;
}

/** `node_type`: the "type" string, or "paragraph" when missing. */
function nodeType(node: unknown): string {
  const t = get(node, "type");
  return typeof t === "string" ? t : "paragraph";
}

function attr(node: unknown, key: string): unknown {
  return get(get(node, "attrs"), key);
}

function attrStr(node: unknown, key: string): string | undefined {
  const v = attr(node, key);
  return typeof v === "string" ? v : undefined;
}

function children(node: unknown): unknown[] {
  const c = get(node, "content");
  return Array.isArray(c) ? c : [];
}

/** Rust `char::is_whitespace` (Unicode White_Space). All of these are BMP. */
function isWs(code: number): boolean {
  return (
    (code >= 0x09 && code <= 0x0d) ||
    code === 0x20 ||
    code === 0x85 ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000
  );
}

function trimStart(s: string): string {
  let i = 0;
  while (i < s.length && isWs(s.charCodeAt(i))) i++;
  return s.slice(i);
}

function trimEnd(s: string): string {
  let j = s.length;
  while (j > 0 && isWs(s.charCodeAt(j - 1))) j--;
  return s.slice(0, j);
}

function trim(s: string): string {
  return trimStart(trimEnd(s));
}

/** Rust `str::trim_matches(c)` for a single character. */
function trimMatches(s: string, c: string): string {
  let i = 0;
  let j = s.length;
  while (i < j && s[i] === c) i++;
  while (j > i && s[j - 1] === c) j--;
  return s.slice(i, j);
}

/** Rust `str::lines`: split on "\n", drop one "\r" before it, no final empty line. */
function lines(s: string): string[] {
  const out: string[] = [];
  let start = 0;
  while (start < s.length) {
    const nl = s.indexOf("\n", start);
    if (nl < 0) {
      out.push(s.slice(start));
      break;
    }
    let line = s.slice(start, nl);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    out.push(line);
    start = nl + 1;
  }
  return out;
}

function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

// ---------------------------------------------------------------------------
// Markdown (constrained dialect) to nodes
// ---------------------------------------------------------------------------

/** `text_node`: a text node, with marks only when there are any. */
export function textNode(text: string, marks: JSONLike[] = []): JSONLike {
  return marks.length === 0 ? { type: "text", text } : { type: "text", text, marks: [...marks] };
}

/** `paragraph`: a paragraph, with content only when there is any. */
export function paragraph(inline: JSONLike[]): JSONLike {
  return inline.length === 0 ? { type: "paragraph" } : { type: "paragraph", content: inline };
}

const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["**", "bold"],
  ["~~", "strike"],
  ["==", "highlight"],
  ["`", "code"],
  ["*", "italic"],
];

/**
 * `parse_inline`: **bold**, *italic*, `code`, ~~strike~~, ==highlight==,
 * [label](url), @[Title](page:ID).
 */
export function parseInline(src: string): JSONLike[] {
  const out: JSONLike[] = [];
  let buf = "";
  const chars = Array.from(src);
  let i = 0;
  const flush = () => {
    if (buf !== "") {
      out.push(textNode(buf));
      buf = "";
    }
  };
  const matchesAt = (j: number, p: string[]) => {
    if (j + p.length > chars.length) return false;
    for (let k = 0; k < p.length; k++) if (chars[j + k] !== p[k]) return false;
    return true;
  };
  const find = (from: number, pat: string): number | undefined => {
    const p = Array.from(pat);
    const upper = Math.max(0, chars.length - (p.length - 1));
    for (let j = from; j < upper; j++) if (matchesAt(j, p)) return j;
    return undefined;
  };
  const slice = (a: number, b: number) => chars.slice(a, b).join("");

  while (i < chars.length) {
    const starts = (s: string) => matchesAt(i, Array.from(s));
    // page mention
    if (starts("@[")) {
      const close = find(i + 2, "](page:");
      if (close !== undefined) {
        const end = find(close + 7, ")");
        if (end !== undefined) {
          flush();
          const label = slice(i + 2, close);
          const id = slice(close + 7, end);
          out.push({ type: "pageMention", attrs: { id, label } });
          i = end + 1;
          continue;
        }
      }
    }
    if (starts("[")) {
      const close = find(i + 1, "](");
      if (close !== undefined) {
        const end = find(close + 2, ")");
        if (end !== undefined) {
          const label = slice(i + 1, close);
          const href = slice(close + 2, end);
          if (label !== "" && !href.includes(" ")) {
            flush();
            out.push(textNode(label, [{ type: "link", attrs: { href } }]));
            i = end + 1;
            continue;
          }
        }
      }
    }
    let matched = false;
    for (const [delim, mark] of PAIRS) {
      if (starts(delim)) {
        const dl = Array.from(delim).length;
        const end = find(i + dl, delim);
        if (end !== undefined && end > i + dl) {
          flush();
          const inner = slice(i + dl, end);
          if (mark === "code") {
            out.push(textNode(inner, [{ type: mark }]));
          } else {
            for (const n of parseInline(inner)) {
              addMark(n, { type: mark });
              out.push(n);
            }
          }
          i = end + dl;
          matched = true;
          break;
        }
      }
    }
    if (matched) continue;
    buf += chars[i];
    i += 1;
  }
  flush();
  return out;
}

/** `add_mark`: append a mark to a text node; other nodes are left alone. */
function addMark(node: JSONLike, mark: JSONLike): void {
  if (nodeType(node) !== "text") return;
  (node.marks ??= []).push(mark);
}

function flushPara(para: string[], blocks: JSONLike[]): void {
  if (para.length === 0) return;
  const inline: JSONLike[] = [];
  para.forEach((line, n) => {
    if (n > 0) inline.push({ type: "hardBreak" });
    inline.push(...parseInline(line));
  });
  blocks.push(paragraph(inline));
  para.length = 0;
}

/** `heading`: "# ", "## " or "### " and the rest of the line. */
function heading(t: string): [number, string] | undefined {
  for (const [prefix, level] of [["### ", 3], ["## ", 2], ["# ", 1]] as const) {
    if (t.startsWith(prefix)) return [level, t.slice(prefix.length)];
  }
  return undefined;
}

type ListKind = "taskList" | "bulletList" | "orderedList";

function leadingDigits(t: string): number {
  let d = 0;
  while (d < t.length && t.charCodeAt(d) >= 0x30 && t.charCodeAt(d) <= 0x39) d++;
  return d;
}

/**
 * `list_kind`. Empty items ("- ", "- [ ] ") are accepted with or without the
 * trailing space, since editors and sync tools routinely strip trailing whitespace.
 */
function listKind(t: string): ListKind | undefined {
  for (const p of ["- [ ]", "- [x]", "- [X]"]) {
    if (t === p || t.startsWith(`${p} `)) return "taskList";
  }
  if (t === "-" || t === "*" || t.startsWith("- ") || t.startsWith("* ")) return "bulletList";
  const digits = leadingDigits(t);
  if (digits > 0 && (t.slice(digits) === "." || t.slice(digits).startsWith(". "))) return "orderedList";
  return undefined;
}

/** `list_item_text`: (checked, text after the marker). The markers are ASCII, so offsets match Rust's byte offsets. */
function listItemText(t: string, kind: ListKind): [boolean, string] {
  switch (kind) {
    case "taskList":
      return [t.slice(3, 4).toLowerCase() === "x", t.slice(6)];
    case "bulletList":
      return [false, t.slice(2)];
    default:
      return [false, t.slice(leadingDigits(t) + 2)];
  }
}

/** `from_markdown`: parse a markdown document into top-level block nodes (no ids; see `withBids`). */
export function fromMarkdown(src: string): JSONLike[] {
  const ls = lines(src);
  const blocks: JSONLike[] = [];
  let i = 0;
  const para: string[] = [];

  while (i < ls.length) {
    const line = trimEnd(ls[i]);
    const t = trimStart(line);

    if (t === "") {
      flushPara(para, blocks);
      i += 1;
      continue;
    }
    // fenced code
    if (t.startsWith("```")) {
      flushPara(para, blocks);
      const code: string[] = [];
      i += 1;
      while (i < ls.length && !trimStart(ls[i]).startsWith("```")) {
        code.push(ls[i]);
        i += 1;
      }
      i += 1;
      const text = code.join("\n");
      const lang = trim(t.slice(3));
      if (asciiLower(lang) === "mermaid") {
        blocks.push({ type: "mermaid", attrs: { code: text } });
        continue;
      }
      const node: JSONLike = { type: "codeBlock", attrs: { language: lang } };
      if (text !== "") node.content = [textNode(text)];
      blocks.push(node);
      continue;
    }
    if (t === "---" || t === "***") {
      flushPara(para, blocks);
      blocks.push({ type: "horizontalRule" });
      i += 1;
      continue;
    }
    const h = heading(t);
    if (h) {
      flushPara(para, blocks);
      const node: JSONLike = { type: "heading", attrs: { level: h[0] } };
      const inline = parseInline(h[1]);
      if (inline.length > 0) node.content = inline;
      blocks.push(node);
      i += 1;
      continue;
    }
    // callouts / prompt / quote
    if (t.startsWith(">")) {
      flushPara(para, blocks);
      const body: string[] = [];
      while (i < ls.length && trimStart(ls[i]).startsWith(">")) {
        const l = trimStart(ls[i]).replace(/^>+/, "");
        body.push(l.startsWith(" ") ? l.slice(1) : l);
        i += 1;
      }
      const first = body[0] ?? "";
      const tagEnd = first.startsWith("[!") ? first.indexOf("]", 2) : -1;
      if (tagEnd >= 0) {
        const tag = first.slice(2, tagEnd).toLowerCase();
        const after = trim(first.slice(tagEnd + 1));
        const rest: string[] = [];
        if (after !== "") rest.push(after);
        rest.push(...body.slice(1));
        let paras = rest.map((l) => paragraph(parseInline(l)));
        if (paras.length === 0) paras = [paragraph([])];
        if (tag === "prompt") {
          blocks.push({ type: "prompt", attrs: { label: "Prompt" }, content: paras });
        } else {
          blocks.push({ type: "callout", attrs: { tone: tag }, content: paras });
        }
      } else {
        const paras = body.map((l) => paragraph(parseInline(l)));
        blocks.push({ type: "blockquote", content: paras });
      }
      continue;
    }
    // tables
    if (t.startsWith("|")) {
      flushPara(para, blocks);
      const rows: string[][] = [];
      while (i < ls.length && trimStart(ls[i]).startsWith("|")) {
        const row = trim(ls[i]);
        const cells = trimMatches(row, "|").split("|").map(trim);
        const isSep = cells.every((c) => c !== "" && /^[-:]+$/.test(c));
        if (!isSep) rows.push(cells);
        i += 1;
      }
      const tableRows: JSONLike[] = rows.map((cells, r) => {
        const cellType = r === 0 ? "tableHeader" : "tableCell";
        return {
          type: "tableRow",
          content: cells.map((c) => ({ type: cellType, content: [paragraph(parseInline(c))] })),
        };
      });
      blocks.push({ type: "table", content: tableRows });
      continue;
    }
    // lists
    const kind = listKind(t);
    if (kind) {
      flushPara(para, blocks);
      const items: JSONLike[] = [];
      const start = i;
      while (i < ls.length) {
        let l = trimStart(ls[i]);
        // The Rust re-reads the first line without trimming its end, so a
        // marker followed only by a tab or a no-break space ("-\t") never
        // matches and the desktop loops forever. Use the trimmed line there.
        if (i === start && listKind(l) !== kind) l = t;
        if (listKind(l) !== kind) break;
        const [checked, text] = listItemText(l, kind);
        const p = paragraph(parseInline(text));
        items.push(kind === "taskList" ? { type: "taskItem", attrs: { checked }, content: [p] } : { type: "listItem", content: [p] });
        i += 1;
      }
      blocks.push({ type: kind, content: items });
      continue;
    }
    para.push(t);
    i += 1;
  }
  flushPara(para, blocks);
  return blocks;
}

// ---------------------------------------------------------------------------
// Block ids
// ---------------------------------------------------------------------------

/** A fresh block id, in the same style the web backend (src/dev/mockTauri.ts) uses. */
export function newBid(): string {
  return Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
}

/**
 * Give each top-level block an `attrs.bid`, the way the desktop store does on
 * save: a missing, empty or repeated id gets a fresh one. Returns new nodes.
 */
export function withBids(nodes: JSONLike[], makeId: () => string = newBid): JSONLike[] {
  const seen = new Set<string>();
  return nodes.map((node) => {
    const cur = attr(node, "bid");
    let id = typeof cur === "string" ? cur : "";
    if (id === "" || seen.has(id)) id = makeId();
    seen.add(id);
    return { ...node, attrs: { ...(isObj(node.attrs) ? node.attrs : {}), bid: id } };
  });
}

// ---------------------------------------------------------------------------
// Plain text (used by to_markdown for code, table cells and unknown blocks)
// ---------------------------------------------------------------------------

function isBlockType(t: string): boolean {
  return !(t === "text" || t === "hardBreak" || t === "pageMention" || t === "mathInline");
}

/** `plain_text`: inline nodes concatenated, block children on separate lines, trimmed. */
export function plainText(node: unknown): string {
  const out = { s: "" };
  collectText(node, out);
  return trim(out.s);
}

function collectText(node: unknown, out: { s: string }): void {
  switch (nodeType(node)) {
    case "text": {
      const t = get(node, "text");
      out.s += typeof t === "string" ? t : "";
      return;
    }
    case "hardBreak":
      out.s += "\n";
      return;
    case "pageMention":
      out.s += "@" + (attrStr(node, "label") ?? "");
      return;
    case "image":
    case "video":
    case "file": {
      const c = attrStr(node, "caption");
      if (c !== undefined) out.s += c;
      const n = attrStr(node, "name");
      if (n !== undefined) {
        if (out.s !== "") out.s += " ";
        out.s += n;
      }
      return;
    }
    case "pageLink":
      out.s += attrStr(node, "title") ?? "";
      return;
    // Presentation slides keep their text in positioned elements; notes count too.
    case "slide": {
      const elements = attr(node, "elements");
      for (const el of Array.isArray(elements) ? elements : []) {
        const t = get(el, "text");
        if (typeof t === "string") {
          if (out.s !== "") out.s += "\n";
          out.s += t;
        }
      }
      const notes = attrStr(node, "notes");
      if (notes !== undefined && notes !== "") out.s += "\n" + notes;
      return;
    }
    case "galleryItem":
      for (const k of ["caption", "name"]) {
        const t = attrStr(node, k);
        if (t !== undefined && t !== "") {
          if (out.s !== "") out.s += " ";
          out.s += t;
        }
      }
      return;
    case "embed":
      out.s += attrStr(node, "url") ?? "";
      return;
    case "discordMessage":
      out.s += attrStr(node, "content") ?? "";
      return;
    case "mathInline":
    case "mathBlock":
      out.s += attrStr(node, "latex") ?? "";
      return;
    case "mermaid":
      out.s += attrStr(node, "code") ?? "";
      return;
    case "chart":
      out.s += attrStr(node, "title") ?? "";
      return;
    case "tab":
      out.s += attrStr(node, "title") ?? "";
      for (const k of children(node)) {
        out.s += "\n";
        collectText(k, out);
      }
      return;
    default: {
      const kids = children(node);
      const blockKids = kids.some((k) => isBlockType(nodeType(k)));
      kids.forEach((k, i) => {
        if (blockKids && i > 0) out.s += "\n";
        collectText(k, out);
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Nodes to markdown
// ---------------------------------------------------------------------------

/** `inline_markdown`: inline nodes back to the dialect. */
export function inlineMarkdown(nodes: readonly unknown[]): string {
  let out = "";
  for (const n of nodes) {
    switch (nodeType(n)) {
      case "text": {
        const t = get(n, "text");
        let s = typeof t === "string" ? t : "";
        const marks = get(n, "marks");
        const list = Array.isArray(marks) ? marks : [];
        for (let k = list.length - 1; k >= 0; k--) {
          const m: unknown = list[k];
          switch (nodeType(m)) {
            case "bold":
              s = `**${s}**`;
              break;
            case "italic":
              s = `*${s}*`;
              break;
            case "strike":
              s = `~~${s}~~`;
              break;
            case "code":
              s = `\`${s}\``;
              break;
            case "highlight":
              s = `==${s}==`;
              break;
            case "link":
              s = `[${s}](${attrStr(m, "href") ?? ""})`;
              break;
          }
        }
        out += s;
        break;
      }
      case "hardBreak":
        out += "\n";
        break;
      case "pageMention":
        out += `@[${attrStr(n, "label") ?? ""}](page:${attrStr(n, "id") ?? ""})`;
        break;
      case "mathInline":
        out += `$${attrStr(n, "latex") ?? ""}$`;
        break;
      default:
        out += inlineMarkdown(children(n));
    }
  }
  return out;
}

/** serde_json `as_u64`: a non-negative integer, else undefined. */
function asU64(v: unknown): number | undefined {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined;
}

/** `to_markdown`: one block back to the dialect. */
export function toMarkdown(node: unknown): string {
  const kids = children(node);
  switch (nodeType(node)) {
    case "paragraph":
      return inlineMarkdown(kids);
    case "heading": {
      const level = Math.min(3, Math.max(1, asU64(attr(node, "level")) ?? 1));
      return `${"#".repeat(level)} ${inlineMarkdown(kids)}`;
    }
    case "bulletList":
      return kids.map((li) => `- ${itemMd(li)}`).join("\n");
    case "orderedList":
      return kids.map((li, i) => `${i + 1}. ${itemMd(li)}`).join("\n");
    case "taskList":
      return kids
        .map((li) => {
          const c = attr(li, "checked");
          return `- [${c === true ? "x" : " "}] ${itemMd(li)}`;
        })
        .join("\n");
    case "blockquote":
      return kids.map((p) => `> ${toMarkdown(p)}`).join("\n");
    case "callout": {
      const tone = attrStr(node, "tone") ?? "note";
      return `> [!${tone}] ${kids.map(toMarkdown).join("\n> ")}`;
    }
    case "prompt":
      return `> [!prompt] ${kids.map(toMarkdown).join("\n> ")}`;
    case "codeBlock":
      return `\`\`\`${attrStr(node, "language") ?? ""}\n${plainText(node)}\n\`\`\``;
    case "horizontalRule":
      return "---";
    case "table": {
      const out: string[] = [];
      kids.forEach((row, r) => {
        const cells = children(row).map((c) => plainText(c).split("|").join("\\|"));
        out.push(`| ${cells.join(" | ")} |`);
        if (r === 0) out.push(`|${cells.map(() => "---").join("|")}|`);
      });
      return out.join("\n");
    }
    case "image":
      return `[image: ${attrStr(node, "caption") ?? attrStr(node, "name") ?? ""}]`;
    case "video":
      return `[video: ${attrStr(node, "caption") ?? attrStr(node, "name") ?? ""}]`;
    case "file":
      return `[file: ${attrStr(node, "name") ?? ""}]`;
    case "pageLink":
      return `[subpage: @[${attrStr(node, "title") ?? ""}](page:${attrStr(node, "pageId") ?? ""})]`;
    case "embed":
      return `[embed: ${attrStr(node, "url") ?? ""}]`;
    case "discordMessage":
      return `[discord message: ${attrStr(node, "content") ?? ""}]`;
    case "schedule":
      return `[schedule: ${attrStr(node, "automationId") ?? ""}]`;
    // Layout containers: their blocks read in order.
    case "columns":
    case "column":
      return kids.map(toMarkdown).filter((s) => s !== "").join("\n\n");
    case "toggle": {
      const head = kids.length > 0 ? toMarkdown(kids[0]) : "";
      const body = kids.slice(1).map(toMarkdown);
      return body.length === 0 ? `> [!toggle] ${head}` : `> [!toggle] ${head}\n> ${body.join("\n> ")}`;
    }
    case "toc":
      return "[table of contents]";
    case "mathBlock":
      return `$$\n${attrStr(node, "latex") ?? ""}\n$$`;
    case "mermaid":
      return `\`\`\`mermaid\n${attrStr(node, "code") ?? ""}\n\`\`\``;
    case "chart": {
      const title = attrStr(node, "title");
      return `[chart: ${title !== undefined && title !== "" ? title : "from a table"}]`;
    }
    case "tabs":
      return kids.map(toMarkdown).filter((s) => s !== "").join("\n\n");
    case "tab": {
      const body = kids.map(toMarkdown).filter((s) => s !== "");
      return `### ${attrStr(node, "title") ?? "Tab"}\n\n${body.join("\n\n")}`;
    }
    case "gallery": {
      const images = attr(node, "images");
      return `[gallery: ${Array.isArray(images) ? images.length : 0} pictures]`;
    }
    case "collection": {
      const title = attrStr(node, "title");
      return `[collection: ${title !== undefined && title !== "" ? title : "pages"} (${attrStr(node, "source") ?? "children"}, ${attrStr(node, "view") ?? "table"} view)]`;
    }
    default:
      return plainText(node);
  }
}

/** `item_md`: a list item's paragraphs inline, nested blocks indented by two spaces. */
function itemMd(li: unknown): string {
  return children(li)
    .map((c) =>
      nodeType(c) === "paragraph"
        ? inlineMarkdown(children(c))
        : lines(toMarkdown(c))
            .map((l) => `  ${l}`)
            .join("\n"),
    )
    .join("\n");
}
