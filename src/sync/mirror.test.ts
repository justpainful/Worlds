import type { JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { applyRemaps, blocksFromY, ensureBlockIds, foldIntoY, fragmentOf, seedY } from "./mirror";

const p = (bid: string, text: string, extra: Partial<JSONContent> = {}): JSONContent => ({
  type: "paragraph",
  attrs: { bid },
  content: [{ type: "text", text }],
  ...extra,
});

const rich: JSONContent[] = [
  { type: "heading", attrs: { bid: "h", level: 2, dir: "rtl" }, content: [{ type: "text", text: "Title" }] },
  {
    type: "paragraph",
    attrs: { bid: "p1" },
    content: [
      { type: "text", text: "Bold", marks: [{ type: "bold" }] },
      { type: "text", text: " and " },
      { type: "text", text: "link", marks: [{ type: "link", attrs: { href: "https://example.com", rel: "noopener" } }] },
      { type: "hardBreak" },
      { type: "pageMention", attrs: { id: "page-2", label: "Other" } },
    ],
  },
  {
    type: "bulletList",
    attrs: { bid: "l" },
    content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "item" }] }] }],
  },
  { type: "callout", attrs: { bid: "c", tone: "note" }, content: [{ type: "paragraph", content: [{ type: "text", text: "inside" }] }] },
  { type: "image", attrs: { bid: "i", attachmentId: "att1", width: 320 } },
];

/** Compare documents ignoring empty attrs objects. */
const norm = (v: unknown): unknown =>
  JSON.parse(JSON.stringify(v, (_k, val) => (val && typeof val === "object" && !Array.isArray(val) && Object.keys(val).length === 0 ? undefined : val)));

function replica(from: Y.Doc): Y.Doc {
  const d = new Y.Doc();
  Y.applyUpdate(d, Y.encodeStateAsUpdate(from));
  return d;
}

function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
}

const text = (doc: Y.Doc) => blocksFromY(doc).map((b) => JSON.stringify(b.content ?? []));

describe("block mirror", () => {
  it("seeds a document from block rows and reads the same blocks back", () => {
    const doc = new Y.Doc();
    seedY(doc, rich);
    expect(norm(blocksFromY(doc))).toEqual(norm(rich));
    expect(fragmentOf(doc).length).toBe(rich.length);
    expect(() => seedY(doc, rich)).toThrow();
  });

  it("folds Claude's block edits into the live document without losing concurrent typing", () => {
    const live = new Y.Doc();
    seedY(live, [p("a", "alpha"), p("b", "beta"), p("d", "delta")]);
    const mirrored = Y.encodeStateAsUpdate(live); // rows were written from this state

    // A collaborator types in block a meanwhile (not yet mirrored).
    const peer = replica(live);
    const aText = (fragmentOf(peer).get(0) as Y.XmlElement).get(0) as Y.XmlText;
    aText.insert(5, " (edited by peer)");
    sync(live, peer);

    // Claude rewrites block b, removes d and adds e, through the rows.
    const rows = [p("a", "alpha"), p("b", "beta, rewritten by Claude"), p("e", "epsilon")];
    expect(foldIntoY(live, mirrored, rows)).toBe(true);

    const out = blocksFromY(live);
    expect(out.map((b) => b.attrs?.bid)).toEqual(["a", "b", "e"]);
    expect(out[0].content?.[0].text).toBe("alpha (edited by peer)");
    expect(out[1].content?.[0].text).toBe("beta, rewritten by Claude");
    expect(out[2].content?.[0].text).toBe("epsilon");
  });

  it("merges edits to the same block character by character", () => {
    const live = new Y.Doc();
    seedY(live, [p("a", "The quick fox")]);
    const mirrored = Y.encodeStateAsUpdate(live);
    const peer = replica(live);
    ((fragmentOf(peer).get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(0, ">> ");
    sync(live, peer);
    foldIntoY(live, mirrored, [p("a", "The quick brown fox")]);
    expect(blocksFromY(live)[0].content?.[0].text).toBe(">> The quick brown fox");
    // The folded edit is an ordinary update: the peer converges too.
    sync(live, peer);
    expect(text(peer)).toEqual(text(live));
  });

  it("reports when there is nothing to fold", () => {
    const live = new Y.Doc();
    seedY(live, [p("a", "same")]);
    expect(foldIntoY(live, Y.encodeStateAsUpdate(live), [p("a", "same")])).toBe(false);
  });

  it("keeps marks and attributes when folding", () => {
    const live = new Y.Doc();
    seedY(live, rich);
    const mirrored = Y.encodeStateAsUpdate(live);
    const rows = structuredClone(rich);
    rows[0].attrs!.level = 3;
    rows[1].content![0].marks = [{ type: "italic" }];
    foldIntoY(live, mirrored, rows);
    expect(norm(blocksFromY(live))).toEqual(norm(rows));
  });

  it("gives blocks ids and applies store remaps", () => {
    const doc = new Y.Doc();
    seedY(doc, [{ type: "paragraph", content: [{ type: "text", text: "x" }] }, p("dup", "1"), p("dup", "2")]);
    let n = 0;
    expect(ensureBlockIds(doc, () => `new${++n}`)).toBe(2);
    expect(blocksFromY(doc).map((b) => b.attrs?.bid)).toEqual(["new1", "dup", "new2"]);
    applyRemaps(doc, [["dup", "moved"]]);
    expect(blocksFromY(doc).map((b) => b.attrs?.bid)).toEqual(["new1", "moved", "new2"]);
  });
});
