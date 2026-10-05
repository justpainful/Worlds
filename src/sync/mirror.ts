/**
 * Block mirror: the bridge between a shared page's Yjs document and its
 * block rows (the form search, history, MCP and Claude read and write).
 *
 * - `blocksFromY` reads the document as the editor's top-level nodes.
 * - `seedY` fills an empty document from block rows (first share).
 * - `foldIntoY` applies a change someone made to the rows directly (Claude
 *   through MCP, an automation) as a real CRDT edit: it replays the change
 *   on a copy of the document as it was when the rows were last mirrored,
 *   then merges that edit into the live document. Concurrent typing by
 *   collaborators is kept, character by character.
 *
 * The Yjs layout is the one Tiptap's Collaboration extension uses
 * (y-prosemirror): fragment "default", one XmlElement per node named by its
 * type, attributes as element attributes, text as XmlText with marks as
 * formatting attributes.
 */
import type { JSONContent } from "@tiptap/core";
import { Schema, type MarkSpec, type NodeSpec } from "@tiptap/pm/model";
import { updateYFragment, yXmlFragmentToProsemirrorJSON } from "@tiptap/y-tiptap";
import * as Y from "yjs";

export const FRAGMENT = "default";
/** Origin for edits folded in from the block rows (still local: they sync). */
export const ORIGIN_FOLD = "worlds-fold";

export function fragmentOf(doc: Y.Doc): Y.XmlFragment {
  return doc.getXmlFragment(FRAGMENT);
}

/** Top-level nodes of the document, as Tiptap JSON. */
export function blocksFromY(doc: Y.Doc): JSONContent[] {
  const json = yXmlFragmentToProsemirrorJSON(fragmentOf(doc)) as JSONContent;
  return json.content ?? [];
}

export function isEmptyY(doc: Y.Doc): boolean {
  return fragmentOf(doc).length === 0;
}

// ---------------------------------------------------------------------------
// A schema just wide enough for the JSON at hand
// ---------------------------------------------------------------------------

const KNOWN_INLINE = new Set(["text", "hardBreak", "pageMention", "mention", "emoji", "wikiLink"]);

interface Seen {
  nodes: Map<string, Set<string>>;
  marks: Map<string, Set<string>>;
  inline: Set<string>;
  parentsOfInline: Set<string>;
}

function walk(n: JSONContent, seen: Seen) {
  const type = n.type ?? "paragraph";
  const attrs = seen.nodes.get(type) ?? new Set<string>();
  for (const k of Object.keys(n.attrs ?? {})) attrs.add(k);
  seen.nodes.set(type, attrs);
  for (const m of n.marks ?? []) {
    const ma = seen.marks.get(m.type) ?? new Set<string>();
    for (const k of Object.keys(m.attrs ?? {})) ma.add(k);
    seen.marks.set(m.type, ma);
  }
  const kids = n.content ?? [];
  if (kids.some((c) => c.type === "text")) {
    for (const c of kids) seen.inline.add(c.type ?? "text");
  }
  for (const c of kids) walk(c, seen);
}

/**
 * Build a permissive ProseMirror schema covering every node, mark and
 * attribute in `docs`, so documents can be diffed without the editor.
 */
export function looseSchema(...docs: JSONContent[]): Schema {
  const seen: Seen = { nodes: new Map(), marks: new Map(), inline: new Set(KNOWN_INLINE), parentsOfInline: new Set() };
  for (const d of docs) walk(d, seen);
  seen.nodes.delete("text");
  seen.nodes.delete("doc");
  const attrSpec = (names: Set<string> | undefined) => Object.fromEntries([...(names ?? [])].map((k) => [k, { default: null }]));
  // Which nodes hold inline content: any node with an inline child somewhere.
  const holdsInline = new Set<string>();
  const mark = (n: JSONContent) => {
    for (const c of n.content ?? []) {
      if (seen.inline.has(c.type ?? "")) holdsInline.add(n.type ?? "");
      mark(c);
    }
  };
  for (const d of docs) mark(d);
  const nodes: Record<string, NodeSpec> = {
    doc: { content: "block*" },
    text: { group: "inline", inline: true },
  };
  for (const [name, attrs] of seen.nodes) {
    const inline = seen.inline.has(name);
    nodes[name] = {
      group: inline ? "inline" : "block",
      inline,
      content: holdsInline.has(name) ? "inline*" : inline ? "" : "block*",
      attrs: attrSpec(attrs),
      marks: "_",
    };
  }
  const marks: Record<string, MarkSpec> = {};
  for (const [name, attrs] of seen.marks) marks[name] = { attrs: attrSpec(attrs) };
  return new Schema({ nodes, marks });
}

function docNode(schema: Schema, blocks: JSONContent[]) {
  return schema.nodeFromJSON({ type: "doc", content: blocks });
}

const meta = () => ({ mapping: new Map(), isOMark: new Map() });

/** Make the fragment hold exactly `blocks` with minimal changes. */
export function writeBlocks(doc: Y.Doc, blocks: JSONContent[], origin: unknown = ORIGIN_FOLD) {
  const current = blocksFromY(doc);
  const schema = looseSchema({ type: "doc", content: current }, { type: "doc", content: blocks });
  doc.transact(() => {
    updateYFragment(doc, fragmentOf(doc), docNode(schema, blocks), meta() as never);
  }, origin);
}

/** Fill an empty document from block rows. */
export function seedY(doc: Y.Doc, blocks: JSONContent[], origin: unknown = ORIGIN_FOLD) {
  if (!isEmptyY(doc)) throw new Error("seedY needs an empty document");
  writeBlocks(doc, blocks, origin);
}

/**
 * Fold a direct change of the block rows into the live document.
 *
 * `baseState` is the Yjs state the rows were last mirrored from, and
 * `rows` is what the rows hold now. The edit base -> rows is computed on a
 * private copy of the base and merged into `live`, so it composes with
 * whatever collaborators did since. Returns whether anything changed.
 */
export function foldIntoY(live: Y.Doc, baseState: Uint8Array, rows: JSONContent[], origin: unknown = ORIGIN_FOLD): boolean {
  const base = new Y.Doc({ gc: false });
  Y.applyUpdate(base, baseState);
  let edit: Uint8Array | null = null;
  base.on("update", (u: Uint8Array) => (edit = edit ? Y.mergeUpdates([edit, u]) : u));
  writeBlocks(base, rows, origin);
  if (!edit) return false;
  let applied = false;
  const mark = () => (applied = true);
  live.on("update", mark);
  try {
    Y.applyUpdate(live, edit, origin);
  } finally {
    live.off("update", mark);
  }
  return applied;
}

/** Give every top-level element a block id (the rows key blocks by it). */
export function ensureBlockIds(doc: Y.Doc, newId: () => string, origin: unknown = ORIGIN_FOLD): number {
  const frag = fragmentOf(doc);
  const seen = new Set<string>();
  const fix: Y.XmlElement[] = [];
  for (const el of frag.toArray()) {
    if (!(el instanceof Y.XmlElement)) continue;
    const id = el.getAttribute("bid") as string | undefined;
    if (!id || seen.has(id)) fix.push(el);
    else seen.add(id);
  }
  if (fix.length) doc.transact(() => fix.forEach((el) => el.setAttribute("bid", newId())), origin);
  return fix.length;
}

/** Apply block id changes the store made (duplicate or foreign ids). */
export function applyRemaps(doc: Y.Doc, remaps: [string, string][], origin: unknown = ORIGIN_FOLD) {
  if (!remaps.length) return;
  const map = new Map(remaps);
  doc.transact(() => {
    for (const el of fragmentOf(doc).toArray()) {
      if (!(el instanceof Y.XmlElement)) continue;
      const next = map.get(el.getAttribute("bid") as string);
      if (next) el.setAttribute("bid", next);
    }
  }, origin);
}
