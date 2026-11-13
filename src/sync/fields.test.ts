import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { fieldsDiff, pushFields, readFields, watchFields } from "./fields";

/** Two replicas that exchange every update, as the server relays them. */
function pair() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.on("update", (u: Uint8Array, origin: unknown) => origin !== "remote" && Y.applyUpdate(b, u, "remote"));
  b.on("update", (u: Uint8Array, origin: unknown) => origin !== "remote" && Y.applyUpdate(a, u, "remote"));
  return { a, b };
}

describe("item fields in team sync", () => {
  it("finds only what differs", () => {
    expect(fieldsDiff({ a: 1, b: "x", c: true }, { a: 1, b: "y", d: [1] })).toEqual({ set: { b: "y", d: [1] }, remove: ["c"] });
    expect(fieldsDiff({ a: { n: 1 } }, { a: { n: 1 } })).toEqual({ set: {}, remove: [] });
  });

  it("carries one device's fields to the other and says so only for the other", () => {
    const { a, b } = pair();
    const seenOnA: unknown[] = [];
    const seenOnB: unknown[] = [];
    watchFields(a, (f) => seenOnA.push(f));
    watchFields(b, (f) => seenOnB.push(f));
    expect(pushFields(a, { status: "sent", total: 1150 })).toBe(true);
    expect(readFields(b)).toEqual({ status: "sent", total: 1150 });
    expect(seenOnA).toEqual([]);
    expect(seenOnB).toEqual([{ status: "sent", total: 1150 }]);
    // Pushing the same fields again changes nothing.
    expect(pushFields(a, { status: "sent", total: 1150 })).toBe(false);
  });

  it("keeps both people's changes when they edit different fields at once", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    pushFields(a, { status: "draft", total: 100 });
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    // Offline at the same time: one marks it sent, the other fixes the total.
    pushFields(a, { status: "sent", total: 100 });
    pushFields(b, { status: "draft", total: 230 });
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(readFields(a)).toEqual({ status: "sent", total: 230 });
    expect(readFields(b)).toEqual(readFields(a));
  });

  it("removes a field that was cleared", () => {
    const { a, b } = pair();
    pushFields(a, { due: "2026-12-01", note: "call first" });
    pushFields(a, { due: "2026-12-01" });
    expect(readFields(b)).toEqual({ due: "2026-12-01" });
  });
});
