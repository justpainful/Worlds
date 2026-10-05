import { describe, expect, it } from "vitest";
import * as server from "../../services/sync/src/protocol";
import * as desktop from "./protocol";

describe("wire protocol copy", () => {
  it("matches the sync service exactly", () => {
    const keys = Object.keys(server).sort();
    expect(Object.keys(desktop).sort()).toEqual(keys);
    for (const k of keys) {
      const a = (server as Record<string, unknown>)[k];
      const b = (desktop as Record<string, unknown>)[k];
      if (typeof a === "function") expect(String(b)).toBe(String(a));
      else expect(b).toEqual(a);
    }
  });

  it("round-trips awareness updates", () => {
    const entries = [
      { clientID: 7, clock: 3, state: JSON.stringify({ user: { id: "u" } }) },
      { clientID: 9, clock: 1, state: "null" },
    ];
    expect(desktop.decodeAwarenessUpdate(desktop.encodeAwarenessUpdate(entries))).toEqual(entries);
  });
});
