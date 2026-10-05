import { describe, expect, it } from "vitest";
import { FakeAccess } from "../src/access";
import { addedComments, type CommentsJSON, validateCommentsChange } from "../src/comments";

const base = (): CommentsJSON => ({
  threads: {
    t1: {
      id: "t1",
      createdBy: "ann",
      createdAt: 1,
      anchor: { start: 1, end: 2 },
      comments: [{ id: "c1", author: "ann", body: "first", createdAt: 1 }],
    },
  },
  people: { ann: { name: "Ann" } },
  roots: ["threads", "people"],
});

describe("comment rules", () => {
  it("lets anyone reply, resolve and reopen as themselves", () => {
    const after = base();
    after.threads.t1.comments!.push({ id: "c2", author: "ben", body: "reply @ann", mentions: ["ann"], createdAt: 2 });
    after.threads.t1.resolved = true;
    after.threads.t1.resolvedBy = "ben";
    expect(validateCommentsChange(base(), after, "ben", "comment")).toBeNull();
    expect(addedComments(base(), after)).toEqual([
      { threadId: "t1", comment: { id: "c2", author: "ben", body: "reply @ann", mentions: ["ann"], createdAt: 2 }, participants: ["ann"] },
    ]);
  });

  it("refuses impersonation and edits of other people's words", () => {
    const forged = base();
    forged.threads.t1.comments!.push({ id: "c2", author: "ann", body: "not me", createdAt: 2 });
    expect(validateCommentsChange(base(), forged, "ben", "edit")).toMatch(/author/);
    const edited = base();
    edited.threads.t1.comments![0].body = "changed";
    expect(validateCommentsChange(base(), edited, "ben", "edit")).toMatch(/author/);
    const moved = base();
    moved.threads.t1.anchor = { start: 5, end: 6 };
    expect(validateCommentsChange(base(), moved, "ben", "comment")).toMatch(/thread author/);
    const resolvedAs = base();
    resolvedAs.threads.t1.resolved = true;
    resolvedAs.threads.t1.resolvedBy = "ann";
    expect(validateCommentsChange(base(), resolvedAs, "ben", "comment")).toMatch(/resolver/);
  });

  it("lets only the author or full access delete", () => {
    const gone = base();
    delete gone.threads.t1;
    expect(validateCommentsChange(base(), gone, "ben", "edit")).toMatch(/delete/);
    expect(validateCommentsChange(base(), gone, "ben", "full")).toBeNull();
    expect(validateCommentsChange(base(), gone, "ann", "comment")).toBeNull();
  });

  it("keeps people entries and roots in bounds", () => {
    const people = base();
    people.people.ann = { name: "Someone else" };
    expect(validateCommentsChange(base(), people, "ben", "comment")).toMatch(/owner/);
    people.people = { ...base().people, ben: { name: "Ben" } };
    expect(validateCommentsChange(base(), people, "ben", "comment")).toBeNull();
    const roots = base();
    roots.roots.push("content");
    expect(validateCommentsChange(base(), roots, "ben", "full")).toMatch(/unknown root/);
  });
});

describe("fake access checker", () => {
  it("answers per document with a workspace fallback", async () => {
    const a = new FakeAccess();
    a.set("u", "w", "*", "view");
    a.set("u", "w", "d2", "edit");
    expect((await a.checkAccess({ userId: "u", workspaceId: "w", docId: "d1" })).level).toBe("view");
    expect((await a.checkAccess({ userId: "u", workspaceId: "w", docId: "d2" })).level).toBe("edit");
    expect((await a.checkAccess({ userId: "x", workspaceId: "w", docId: "d1" })).level).toBe("none");
  });
});
