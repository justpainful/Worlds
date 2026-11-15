import { describe, expect, it } from "vitest";
import { mergeSnapshots, type Snapshot } from "./merge";

const empty = (savedAt: number): Snapshot => ({
  v: 1, savedAt, pages: {}, blocks: {}, metadata: {}, drawings: {}, drawingLibrary: {}, drawingVersions: {}, exportPolicies: {},
  settings: {}, profile: { displayName: "" }, chats: [], chatMessages: {}, fileInfo: {},
});
const page = (id: string, title: string, updatedAt: number, extra: Record<string, unknown> = {}) => ({ id, title, updatedAt, deletedAt: null, ...extra });

describe("two copies of one web workspace", () => {
  it("keeps each page's latest change, from either side", () => {
    const laptop = empty(100);
    laptop.pages.a = page("a", "Plan, laptop", 50);
    laptop.blocks.a = [{ type: "paragraph", text: "laptop" }];
    laptop.pages.b = page("b", "Notes", 10);
    const phone = empty(200);
    phone.pages.a = page("a", "Plan, phone", 40);
    phone.blocks.a = [{ type: "paragraph", text: "phone" }];
    phone.pages.c = page("c", "Groceries", 30);

    const merged = mergeSnapshots(laptop, phone);
    expect(merged.pages.a.title).toBe("Plan, laptop");
    expect(merged.blocks.a[0].text).toBe("laptop");
    expect(Object.keys(merged.pages).sort()).toEqual(["a", "b", "c"]);
    // The same result whichever copy comes first.
    expect(mergeSnapshots(phone, laptop).pages.a.title).toBe("Plan, laptop");
  });

  it("does not bring back a page deleted for good, and counts moving to Trash as a change", () => {
    const here = empty(300);
    here.purged = { gone: 290 };
    here.pages.trashed = page("trashed", "Old", 10, { deletedAt: 280 });
    const there = empty(100);
    there.pages.gone = page("gone", "Gone", 90);
    there.blocks.gone = [];
    there.pages.trashed = page("trashed", "Old", 50);
    const merged = mergeSnapshots(there, here);
    expect(merged.pages.gone).toBeUndefined();
    expect(merged.blocks.gone).toBeUndefined();
    expect(merged.pages.trashed.deletedAt).toBe(280);
  });

  it("combines conversations and files, and takes settings from the copy saved last", () => {
    const a = empty(100);
    a.settings = { "appearance.accent": "blue" };
    a.chats = [{ id: "c1" }];
    a.chatMessages = { c1: [{ id: 1 }] };
    a.fileInfo = { f1: { name: "a.png", mime: "image/png", size: 1, kind: "image", pageId: null, createdAt: 1 } };
    const b = empty(200);
    b.settings = { "appearance.accent": "green" };
    b.chats = [{ id: "c2" }];
    b.chatMessages = { c1: [{ id: 1 }, { id: 2 }] };
    b.fileInfo = { f2: { name: "b.pdf", mime: "application/pdf", size: 2, kind: "file", pageId: null, createdAt: 2 } };
    const merged = mergeSnapshots(a, b);
    expect(merged.settings["appearance.accent"]).toBe("green");
    expect(merged.chats.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
    expect(merged.chatMessages.c1).toHaveLength(2);
    expect(Object.keys(merged.fileInfo).sort()).toEqual(["f1", "f2"]);
  });
});
