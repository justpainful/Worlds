import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { blocksFromY, fragmentOf, seedY } from "./mirror";
import { restoreInto } from "./versions";

const p = (bid: string, text: string) => ({ type: "paragraph", attrs: { bid }, content: [{ type: "text", text }] });

describe("restoring a shared version", () => {
  it("brings back old content as a new edit that peers merge", () => {
    const live = new Y.Doc();
    seedY(live, [p("a", "first"), p("b", "second")]);
    const old = Y.encodeStateAsUpdate(live);
    const peer = new Y.Doc();
    Y.applyUpdate(peer, old);
    // Later: a block removed and another rewritten.
    fragmentOf(live).delete(1, 1);
    ((fragmentOf(live).get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(0, "changed ");
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(live, Y.encodeStateVector(peer)));
    restoreInto(live, old);
    expect(blocksFromY(live).map((b) => b.content?.[0]?.text)).toEqual(["first", "second"]);
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(live, Y.encodeStateVector(peer)));
    expect(blocksFromY(peer)).toEqual(blocksFromY(live));
  });
});
