import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { mergeBlocks } from "./merge";

const p = (bid: string, text: string): JSONContent => ({ type: "paragraph", attrs: { bid }, content: [{ type: "text", text }] });
const base = (blocks: JSONContent[]) => new Map(blocks.map((b) => [b.attrs!.bid as string, JSON.stringify(b)]));
const texts = (blocks: JSONContent[]) => blocks.map((b) => b.content?.[0]?.text);

describe("mergeBlocks", () => {
  const a = p("a", "one");
  const b = p("b", "two");
  const c = p("c", "three");

  it("keeps my edit and takes theirs on other blocks", () => {
    const local = [p("a", "one (mine)"), b, c];
    const server = [a, p("b", "two (claude)"), c];
    const { merged, dirty } = mergeBlocks(base([a, b, c]), local, server);
    expect(texts(merged)).toEqual(["one (mine)", "two (claude)", "three"]);
    expect(dirty).toBe(true);
  });

  it("places my new block after its neighbour, once", () => {
    const local = [a, p("n", "new"), b, c];
    const server = [a, b, c, p("s", "from server")];
    const { merged } = mergeBlocks(base([a, b, c]), local, server);
    expect(texts(merged)).toEqual(["one", "new", "two", "three", "from server"]);
    expect(new Set(merged.map((m) => m.attrs!.bid)).size).toBe(merged.length);
  });

  it("keeps a block I deleted deleted, unless the server changed it", () => {
    expect(texts(mergeBlocks(base([a, b, c]), [a, c], [a, b, c]).merged)).toEqual(["one", "three"]);
    expect(texts(mergeBlocks(base([a, b, c]), [a, c], [a, p("b", "edited"), c]).merged)).toEqual(["one", "edited", "three"]);
  });

  it("is a no-op when nothing changed", () => {
    const { merged, dirty } = mergeBlocks(base([a, b]), [a, b], [a, b]);
    expect(texts(merged)).toEqual(["one", "two"]);
    expect(dirty).toBe(false);
  });
});
