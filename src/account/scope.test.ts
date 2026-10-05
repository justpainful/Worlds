import { describe, expect, it } from "vitest";
import { atLeast, inviteToken, scopePages, workspaceOf } from "./scope";
import { canChangeRole, canInvite, canRemove } from "./roles";

const page = (id: string, parentId: string | null = null, createdAt = 1) => ({ id, parentId, createdAt });

describe("workspace scoping", () => {
  const pages = {
    diary: page("diary"),
    team: page("team"),
    teamChild: page("teamChild", "team"),
    fresh: page("fresh", null, 500),
    freshChild: page("freshChild", "fresh", 500),
  };
  const pageWs = { team: "ws-1", teamChild: "ws-1" };

  it("reads the workspace from the database map and follows parents", () => {
    expect(workspaceOf(pages, pageWs, 100, null, "teamChild")).toBe("ws-1");
    expect(workspaceOf(pages, pageWs, 100, null, "diary")).toBeNull();
  });

  it("puts pages created after the last lookup in the active workspace", () => {
    expect(workspaceOf(pages, pageWs, 100, "ws-1", "fresh")).toBe("ws-1");
    expect(workspaceOf(pages, pageWs, 100, "ws-1", "freshChild")).toBe("ws-1");
    expect(workspaceOf(pages, pageWs, 100, null, "fresh")).toBeNull();
    expect(workspaceOf(pages, pageWs, 1000, "ws-1", "fresh")).toBeNull();
  });

  it("shows only the active workspace", () => {
    expect(Object.keys(scopePages(pages, pageWs, 1000, null)).sort()).toEqual(["diary", "fresh", "freshChild"]);
    expect(Object.keys(scopePages(pages, pageWs, 1000, "ws-1")).sort()).toEqual(["team", "teamChild"]);
    // Nothing shared anywhere: every page, untouched.
    expect(scopePages(pages, {}, 1000, null)).toBe(pages);
  });
});

describe("client role rules mirror the service", () => {
  it("invites, role changes and removal", () => {
    expect(canInvite("admin", "member")).toBe(true);
    expect(canInvite("admin", "admin")).toBe(false);
    expect(canInvite("member", "guest")).toBe(false);
    expect(canChangeRole("owner", "member", "admin", false)).toBe(true);
    expect(canChangeRole("admin", "member", "admin", false)).toBe(false);
    expect(canRemove("admin", "owner", false)).toBe(false);
    expect(canRemove("owner", "admin", false)).toBe(true);
  });

  it("orders levels", () => {
    expect(atLeast("full", "edit")).toBe(true);
    expect(atLeast("comment", "edit")).toBe(false);
    expect(atLeast("none", "view")).toBe(false);
  });
});

describe("invite links", () => {
  it("accepts a link or a bare token", () => {
    expect(inviteToken("https://id.example.com/join/wi_abcdefghijk")).toBe("wi_abcdefghijk");
    expect(inviteToken("wi_abcdefghijk")).toBe("wi_abcdefghijk");
    expect(inviteToken("https://example.com/join/nope")).toBeNull();
  });
});
