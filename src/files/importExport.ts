/**
 * Getting pages into and out of Worlds.
 *
 * Import: Markdown and text files, an Obsidian vault (a folder), a Notion
 * export (.zip of Markdown and CSV), Word (.docx) and HTML.
 * Export: a page as Word (.docx) or PDF (print), a page and its subpages as a
 * book (EPUB), and the whole workspace as one .zip of Markdown and files.
 */
import type { JSONContent } from "@tiptap/core";
import { api, errorMessage, fileUrl } from "../lib/api";
import type { PageMeta } from "../lib/types";
import { useStore, pageTitle, childrenOf } from "../state/store";
import { tr, uiLanguage } from "../i18n/ui";
import { download, readZip, writeZip, type ZipEntry } from "./zip";

const toast = (message: string, tone?: "error" | "success") => useStore.getState().toast({ message, tone });
const dec = new TextDecoder();
const isArabic = (s: string) => /[؀-ۿ]/.test(s);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const safeName = (s: string) => (s || "page").replace(/[\\/:*?"<>|#%]+/g, "-").slice(0, 80);

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/** Notion adds a 32-character id to every file and folder name. */
const cleanName = (name: string) =>
  name
    .replace(/\.(md|markdown|txt|csv|html?|docx)$/i, "")
    .replace(/\s+[0-9a-f]{32}$/i, "")
    .trim();

function csvToMarkdown(csv: string): string {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (quoted) {
      if (c === '"' && csv[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && csv[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  if (!rows.length) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => (r[i] ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ")} |`;
  return [line(rows[0]), `| ${Array(width).fill("---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n");
}

/** Word's document.xml as Markdown: headings, lists, bold, italic and tables. */
export function docxToMarkdown(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const out: string[] = [];
  const runText = (p: Element) =>
    [...p.getElementsByTagNameNS(W, "r")]
      .map((r) => {
        const t = [...r.getElementsByTagNameNS(W, "t")].map((x) => x.textContent ?? "").join("") + (r.getElementsByTagNameNS(W, "tab").length ? "\t" : "");
        if (!t.trim()) return t;
        const pr = r.getElementsByTagNameNS(W, "rPr")[0];
        const b = !!pr?.getElementsByTagNameNS(W, "b").length;
        const i = !!pr?.getElementsByTagNameNS(W, "i").length;
        return b && i ? `***${t}***` : b ? `**${t}**` : i ? `*${t}*` : t;
      })
      .join("");
  const body = doc.getElementsByTagNameNS(W, "body")[0];
  if (!body) return "";
  for (const el of [...body.children]) {
    if (el.localName === "p") {
      const style = el.getElementsByTagNameNS(W, "pStyle")[0]?.getAttributeNS(W, "val") ?? el.getElementsByTagNameNS(W, "pStyle")[0]?.getAttribute("w:val") ?? "";
      const list = el.getElementsByTagNameNS(W, "numPr").length > 0;
      const text = runText(el);
      const m = /^(Heading|heading)\s*([1-6])$/.exec(style) ?? (/^Title$/i.test(style) ? [, , "1"] : null);
      if (m) out.push(`${"#".repeat(Math.min(3, Number(m[2])))} ${text.replace(/\*+/g, "")}`);
      else if (list) out.push(`- ${text}`);
      else out.push(text);
    } else if (el.localName === "tbl") {
      const rows = [...el.getElementsByTagNameNS(W, "tr")].map((tr) => [...tr.getElementsByTagNameNS(W, "tc")].map((tc) => [...tc.getElementsByTagNameNS(W, "p")].map(runText).join(" ")));
      if (rows.length) {
        const width = Math.max(...rows.map((r) => r.length));
        const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => (r[i] ?? "").replace(/\|/g, "\\|")).join(" | ")} |`;
        out.push([line(rows[0]), `| ${Array(width).fill("---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n"));
      }
    }
  }
  // Paragraphs become blocks; consecutive list items stay together.
  return out.reduce((acc, line, i) => acc + (i === 0 ? "" : line.startsWith("- ") && out[i - 1].startsWith("- ") ? "\n" : "\n\n") + line, "");
}

function htmlToMarkdown(html: string): { title: string; md: string } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, nav, footer, header aside").forEach((e) => e.remove());
  const out: string[] = [];
  const walk = (el: Element) => {
    for (const c of [...el.children]) {
      const tag = c.tagName.toLowerCase();
      const text = (c.textContent ?? "").replace(/\s+/g, " ").trim();
      if (/^h[1-6]$/.test(tag)) out.push(`${"#".repeat(Math.min(3, Number(tag[1])))} ${text}`);
      else if (tag === "p" || tag === "blockquote") text && out.push(tag === "blockquote" ? `> ${text}` : text);
      else if (tag === "li") text && out.push(`- ${text}`);
      else if (tag === "pre") out.push("```\n" + (c.textContent ?? "") + "\n```");
      else walk(c);
    }
  };
  walk(doc.body);
  return { title: doc.title || doc.querySelector("h1")?.textContent?.trim() || "", md: out.join("\n\n") };
}

async function createFromMarkdown(title: string, markdown: string, parentId: string | null) {
  // Obsidian links [[Page]] and [[Page|label]] read as plain text until the page exists.
  const md = markdown.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2").replace(/\[\[([^\]]+)\]\]/g, "$1");
  return api.createPage({ title: title || tr("Imported page"), parentId, markdown: md } as never);
}

/** Import files the person picks (Markdown, text, HTML, Word, a Notion .zip). */
export function importFiles(parentId: string | null = null): Promise<number> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".md,.markdown,.txt,.html,.htm,.docx,.zip,.csv";
    input.onchange = async () => {
      const files = [...(input.files ?? [])];
      resolve(await importFileList(files.map((f) => ({ path: f.name, file: f })), parentId));
    };
    input.click();
  });
}

/** Import an Obsidian vault or any folder of Markdown; folders become parent pages. */
export function importFolder(parentId: string | null = null): Promise<number> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
    input.onchange = async () => {
      const files = [...(input.files ?? [])].filter((f) => !/(^|\/)\.(obsidian|git|trash)\//.test((f as File & { webkitRelativePath: string }).webkitRelativePath));
      resolve(await importFileList(files.map((f) => ({ path: (f as File & { webkitRelativePath: string }).webkitRelativePath || f.name, file: f })), parentId));
    };
    input.click();
  });
}

type Source = { path: string; file?: File; bytes?: Uint8Array };

async function importFileList(items: Source[], parentId: string | null): Promise<number> {
  const s = useStore.getState();
  let count = 0;
  const folders = new Map<string, string>();
  const folderPage = async (dir: string): Promise<string | null> => {
    if (!dir) return parentId;
    if (folders.has(dir)) return folders.get(dir)!;
    const parent = await folderPage(dir.split("/").slice(0, -1).join("/"));
    const meta = await api.createPage({ title: cleanName(dir.split("/").pop() ?? dir), parentId: parent } as never);
    folders.set(dir, meta.id);
    return meta.id;
  };
  if (items.length) toast(`${tr("Importing")} ${items.length} ${tr("files")}`);
  for (const it of items) {
    try {
      const bytes = it.bytes ?? new Uint8Array(await it.file!.arrayBuffer());
      const name = it.path.split("/").pop() ?? it.path;
      const dir = it.path.split("/").slice(0, -1).join("/");
      const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
      if (ext === "zip") {
        const inner = readZip(bytes);
        const list: Source[] = [...inner.entries()].filter(([p]) => /\.(md|markdown|txt|csv|html?|docx)$/i.test(p)).map(([path, b]) => ({ path, bytes: b }));
        count += await importFileList(list, await folderPage(dir));
        continue;
      }
      const parent = await folderPage(dir);
      if (ext === "md" || ext === "markdown" || ext === "txt") {
        const text = dec.decode(bytes);
        const h1 = /^#\s+(.+)$/m.exec(text);
        const title = cleanName(name);
        const body = h1 && h1[1].trim() === title ? text.replace(h1[0], "").trimStart() : text;
        await createFromMarkdown(title, body, parent);
      } else if (ext === "csv") {
        await createFromMarkdown(cleanName(name), csvToMarkdown(dec.decode(bytes)), parent);
      } else if (ext === "html" || ext === "htm") {
        const { title, md } = htmlToMarkdown(dec.decode(bytes));
        await createFromMarkdown(title || cleanName(name), md, parent);
      } else if (ext === "docx") {
        const zip = readZip(bytes);
        const xml = zip.get("word/document.xml");
        if (!xml) throw new Error(tr("This Word file has no document inside."));
        await createFromMarkdown(cleanName(name), docxToMarkdown(dec.decode(xml)), parent);
      } else continue;
      count++;
    } catch (e) {
      toast(`${it.path}: ${errorMessage(e)}`, "error");
    }
  }
  await s.refreshPages();
  if (count) toast(`${count} ${tr("pages imported")}`, "success");
  return count;
}

// ---------------------------------------------------------------------------
// Blocks as HTML (EPUB) and Word XML
// ---------------------------------------------------------------------------

function inlineHtml(n: JSONContent): string {
  if (n.type === "text") {
    let t = esc(n.text ?? "");
    for (const m of n.marks ?? []) {
      if (m.type === "bold") t = `<strong>${t}</strong>`;
      else if (m.type === "italic") t = `<em>${t}</em>`;
      else if (m.type === "underline") t = `<u>${t}</u>`;
      else if (m.type === "strike") t = `<s>${t}</s>`;
      else if (m.type === "code") t = `<code>${t}</code>`;
      else if (m.type === "link" && typeof m.attrs?.href === "string" && /^https?:/.test(m.attrs.href)) t = `<a href="${esc(m.attrs.href)}">${t}</a>`;
    }
    return t;
  }
  if (n.type === "hardBreak") return "<br/>";
  if (n.type === "pageMention") return esc(`@${n.attrs?.label ?? ""}`);
  if (n.type === "footnote") return `<sup>${esc(String(n.attrs?.text ?? "")) ? "*" : ""}</sup>`;
  return (n.content ?? []).map(inlineHtml).join("");
}

export function blocksToHtml(blocks: JSONContent[]): string {
  const block = (n: JSONContent): string => {
    const kids = (n.content ?? []).map(block).join("");
    const inline = (n.content ?? []).map(inlineHtml).join("");
    const text = (n.content ?? []).map(inlineHtml).join("");
    const dir = isArabic(text) ? ' dir="rtl"' : "";
    switch (n.type) {
      case "paragraph":
        return `<p${dir}>${inline}</p>`;
      case "heading":
        return `<h${Math.min(3, Number(n.attrs?.level ?? 2))}${dir}>${inline}</h${Math.min(3, Number(n.attrs?.level ?? 2))}>`;
      case "bulletList":
      case "taskList":
        return `<ul>${kids}</ul>`;
      case "orderedList":
        return `<ol>${kids}</ol>`;
      case "listItem":
      case "taskItem":
        return `<li>${kids}</li>`;
      case "blockquote":
        return `<blockquote>${kids}</blockquote>`;
      case "codeBlock":
        return `<pre><code>${esc((n.content ?? []).map((c) => c.text ?? "").join(""))}</code></pre>`;
      case "horizontalRule":
        return "<hr/>";
      case "table":
        return `<table>${(n.content ?? []).map((r) => `<tr>${(r.content ?? []).map((c) => `<td>${(c.content ?? []).map(block).join("")}</td>`).join("")}</tr>`).join("")}</table>`;
      case "callout":
      case "toggle":
      case "synced":
      case "column":
        return `<div>${kids}</div>`;
      case "columns":
        return kids;
      default:
        return kids;
    }
  };
  return blocks.map(block).join("\n");
}

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function wordRuns(n: JSONContent): string {
  if (n.type === "text") {
    const marks = new Set((n.marks ?? []).map((m) => m.type));
    const rtl = isArabic(n.text ?? "");
    const pr = `${marks.has("bold") ? "<w:b/><w:bCs/>" : ""}${marks.has("italic") ? "<w:i/><w:iCs/>" : ""}${marks.has("underline") ? '<w:u w:val="single"/>' : ""}${marks.has("strike") ? "<w:strike/>" : ""}${rtl ? "<w:rtl/>" : ""}`;
    return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(n.text ?? "")}</w:t></w:r>`;
  }
  if (n.type === "hardBreak") return "<w:r><w:br/></w:r>";
  if (n.type === "pageMention") return `<w:r><w:t xml:space="preserve">${esc(`@${n.attrs?.label ?? ""}`)}</w:t></w:r>`;
  return (n.content ?? []).map(wordRuns).join("");
}

function wordPara(runs: string, style: string | null, text: string, prefix = "") {
  const rtl = isArabic(text);
  const pPr = `${style ? `<w:pStyle w:val="${style}"/>` : ""}${rtl ? '<w:bidi/><w:jc w:val="right"/>' : ""}`;
  const pre = prefix ? `<w:r><w:t xml:space="preserve">${esc(prefix)}</w:t></w:r>` : "";
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${pre}${runs}</w:p>`;
}

function plain(n: JSONContent): string {
  return n.type === "text" ? n.text ?? "" : (n.content ?? []).map(plain).join("");
}

export function blocksToWordXml(blocks: JSONContent[]): string {
  const body: string[] = [];
  const emit = (n: JSONContent, depth = 0) => {
    const txt = plain(n);
    switch (n.type) {
      case "paragraph":
        body.push(wordPara(wordRuns(n), null, txt));
        break;
      case "heading":
        body.push(wordPara(wordRuns(n), `Heading${Math.min(3, Number(n.attrs?.level ?? 2))}`, txt));
        break;
      case "bulletList":
      case "orderedList":
      case "taskList":
        (n.content ?? []).forEach((li, i) => {
          const mark = n.type === "orderedList" ? `${i + 1}. ` : n.type === "taskList" ? (li.attrs?.checked ? "[x] " : "[ ] ") : "• ";
          (li.content ?? []).forEach((c, j) => {
            if (c.type === "paragraph") body.push(wordPara(wordRuns(c), null, plain(c), j === 0 ? `${"    ".repeat(depth)}${mark}` : "    ".repeat(depth + 1)));
            else emit(c, depth + 1);
          });
        });
        break;
      case "blockquote":
      case "callout":
      case "toggle":
      case "synced":
      case "columns":
      case "column":
        (n.content ?? []).forEach((c) => emit(c, depth));
        break;
      case "codeBlock":
        txt.split("\n").forEach((line) => body.push(`<w:p><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/></w:rPr><w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`));
        break;
      case "table":
        body.push(
          `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>${(n.content ?? [])
            .map((r) => `<w:tr>${(r.content ?? []).map((c) => `<w:tc>${(c.content ?? []).map((p) => wordPara(wordRuns(p), null, plain(p))).join("") || "<w:p/>"}</w:tc>`).join("")}</w:tr>`)
            .join("")}</w:tbl>`,
        );
        break;
      case "horizontalRule":
        body.push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1"/></w:pBdr></w:pPr></w:p>');
        break;
      default:
        if (txt.trim()) body.push(wordPara(`<w:r><w:t xml:space="preserve">${esc(txt)}</w:t></w:r>`, null, txt));
    }
  };
  blocks.forEach((b) => emit(b));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W_NS}><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
}

const DOCX_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W_NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Arial"/><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="48"/><w:szCs w:val="48"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:spacing w:before="360" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:spacing w:before="280" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:pPr><w:spacing w:before="240" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style></w:styles>`;

/** A page as a Word document. */
export async function exportDocx(pageId: string) {
  try {
    const page = await api.page(pageId);
    if (!page) throw new Error(tr("Page not found"));
    const title = pageTitle(page);
    const blocks = [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] } as JSONContent, ...page.blocks.map((b) => b.content)];
    const xml = blocksToWordXml(blocks).replace('<w:pStyle w:val="Heading1"/>', '<w:pStyle w:val="Title"/>');
    const zip = writeZip([
      { path: "[Content_Types].xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>' },
      { path: "_rels/.rels", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
      { path: "word/_rels/document.xml.rels", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { path: "word/document.xml", data: xml },
      { path: "word/styles.xml", data: DOCX_STYLES },
    ]);
    download(`${safeName(title)}.docx`, zip, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  } catch (e) {
    toast(errorMessage(e), "error");
  }
}

// ---------------------------------------------------------------------------
// Book (EPUB)
// ---------------------------------------------------------------------------

/** A page and its subpages, in order, as an EPUB book: the page is the cover and introduction, each subpage a chapter. */
export async function exportBook(pageId: string) {
  try {
    const s = useStore.getState();
    const root = await api.page(pageId);
    if (!root) throw new Error(tr("Page not found"));
    const chapters: { title: string; html: string }[] = [];
    const intro = blocksToHtml(root.blocks.map((b) => b.content));
    if (intro.trim()) chapters.push({ title: tr("Introduction"), html: intro });
    const walk = async (parent: string, depth: number) => {
      for (const child of childrenOf(s.pages, parent, { archived: false })) {
        const p = await api.page(child.id);
        if (!p) continue;
        chapters.push({ title: pageTitle(p), html: `${depth ? "" : ""}${blocksToHtml(p.blocks.map((b) => b.content))}` });
        if (depth < 2) await walk(child.id, depth + 1);
      }
    };
    await walk(pageId, 0);
    const title = pageTitle(root);
    const author = s.profile?.displayName ?? "";
    const ar = isArabic(title + intro) || uiLanguage() === "ar";
    const lang = ar ? "ar" : "en";
    const id = `urn:uuid:${crypto.randomUUID()}`;
    const xhtml = (t: string, body: string) =>
      `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}" xml:lang="${lang}"${ar ? ' dir="rtl"' : ""}><head><meta charset="UTF-8"/><title>${esc(t)}</title><link rel="stylesheet" href="book.css"/></head><body>${body}</body></html>`;
    const entries: ZipEntry[] = [
      { path: "mimetype", data: "application/epub+zip" },
      { path: "META-INF/container.xml", data: '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
      { path: "OEBPS/book.css", data: `body{font-family:serif;line-height:1.7;margin:5%}h1{font-size:1.8em;margin:1.2em 0 .6em}h2{font-size:1.4em}h3{font-size:1.15em}blockquote{margin:1em 2em;color:#555}table{border-collapse:collapse}td{border:1px solid #999;padding:.3em .5em}pre{white-space:pre-wrap;font-family:monospace;font-size:.9em}.cover{text-align:center;margin-top:30%}.cover h1{font-size:2.4em}` },
      { path: "OEBPS/cover.xhtml", data: xhtml(title, `<div class="cover"><h1>${esc(title)}</h1><p>${esc(author)}</p></div>`) },
    ];
    chapters.forEach((c, i) => entries.push({ path: `OEBPS/ch${i + 1}.xhtml`, data: xhtml(c.title, `<h1>${esc(c.title)}</h1>${c.html}`) }));
    entries.push({
      path: "OEBPS/nav.xhtml",
      data: xhtml(tr("Contents"), `<nav epub:type="toc"><h1>${esc(tr("Contents"))}</h1><ol>${chapters.map((c, i) => `<li><a href="ch${i + 1}.xhtml">${esc(c.title)}</a></li>`).join("")}</ol></nav>`),
    });
    entries.push({
      path: "OEBPS/content.opf",
      data: `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${lang}"${ar ? ' dir="rtl"' : ""}><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">${id}</dc:identifier><dc:title>${esc(title)}</dc:title><dc:creator>${esc(author)}</dc:creator><dc:language>${lang}</dc:language><meta property="dcterms:modified">${new Date().toISOString().slice(0, 19)}Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="book.css" media-type="text/css"/><item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>${chapters.map((_, i) => `<item id="ch${i + 1}" href="ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join("")}</manifest><spine${ar ? ' page-progression-direction="rtl"' : ""}><itemref idref="cover"/><itemref idref="nav"/>${chapters.map((_, i) => `<itemref idref="ch${i + 1}"/>`).join("")}</spine></package>`,
    });
    download(`${safeName(title)}.epub`, writeZip(entries), "application/epub+zip");
    toast(`${tr("Book saved with")} ${chapters.length} ${tr("chapters")}`, "success");
  } catch (e) {
    toast(errorMessage(e), "error");
  }
}

// ---------------------------------------------------------------------------
// Export everything
// ---------------------------------------------------------------------------

/** Every page as Markdown in folders that follow the page tree, with the files they hold. */
export async function exportEverything() {
  const s = useStore.getState();
  const pages = Object.values(s.pages).filter((p) => !p.deletedAt && p.kind !== "template");
  toast(`${tr("Preparing")} ${pages.length} ${tr("pages")}`);
  const pathOf = new Map<string, string>();
  const used = new Set<string>();
  const folder = (p: PageMeta): string => {
    if (pathOf.has(p.id)) return pathOf.get(p.id)!;
    const parent = p.parentId && s.pages[p.parentId] ? folder(s.pages[p.parentId]) : "";
    let name = `${parent ? `${parent}/` : ""}${safeName(pageTitle(p))}`;
    for (let n = 2; used.has(name); n++) name = `${parent ? `${parent}/` : ""}${safeName(pageTitle(p))} ${n}`;
    used.add(name);
    pathOf.set(p.id, name);
    return name;
  };
  const entries: ZipEntry[] = [];
  const seenFiles = new Set<string>();
  let done = 0;
  for (const p of pages) {
    try {
      const base = folder(p);
      entries.push({ path: `Worlds/${base}.md`, data: `# ${pageTitle(p)}\n\n${await api.pageMarkdown(p.id)}` });
      const full = await api.page(p.id);
      for (const a of full?.attachments ?? []) {
        if (seenFiles.has(a.id)) continue;
        seenFiles.add(a.id);
        try {
          const res = await fetch(fileUrl(a.id));
          if (res.ok) entries.push({ path: `Worlds/files/${a.id.slice(0, 8)}-${safeName(a.fileName ?? "file")}`, data: new Uint8Array(await res.arrayBuffer()) });
        } catch {
          /* a file that cannot be read is skipped */
        }
      }
    } catch {
      /* keep going */
    }
    done++;
  }
  entries.push({ path: "Worlds/README.txt", data: `Exported from Worlds on ${new Date().toISOString()}.\nEach page is a Markdown file; subpages sit in a folder named after their page. Files are in files/.\n` });
  download(`Worlds export ${new Date().toISOString().slice(0, 10)}.zip`, writeZip(entries), "application/zip");
  toast(`${done} ${tr("pages exported")}`, "success");
}
