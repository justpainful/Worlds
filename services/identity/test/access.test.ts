import { createExecutionContext, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { IdentityRPC } from "../src/index";
import { resolve, type Entry, type Subject, type WorkspaceAcl } from "../src/domain/access";
import { api, outbox, signUp, workspaceWithOwner } from "./helpers";

function acl(tree: [string, string | null, boolean?][], entries: [string, Entry][] = []): WorkspaceAcl {
  const t = new Map(tree.map(([id, parentId, inherit]) => [id, { parentId, inherit: inherit ?? true }]));
  const e = new Map<string, Entry[]>();
  for (const [page, entry] of entries) e.set(page, [...(e.get(page) ?? []), entry]);
  return { tree: t, entries: e };
}

const subject = (role: Subject["role"], groups: string[] = [], userId = "u1", defaultLevel: Subject["defaultLevel"] = "edit"): Subject => ({
  userId,
  role,
  groupIds: new Set(groups),
  defaultLevel,
});

describe("permission resolution (pure)", () => {
  // root
  //  ├─ a
  //  │   └─ a1
  //  │       └─ a2
  //  └─ b (restricted)
  //      └─ b1
  const tree: [string, string | null, boolean?][] = [
    ["root", null],
    ["a", "root"],
    ["a1", "a"],
    ["a2", "a1"],
    ["b", "root", false],
    ["b1", "b"],
  ];

  it("gives owners and admins full access, non-members none", () => {
    const x = acl(tree);
    expect(resolve(x, subject("owner"), "a2")).toBe("full");
    expect(resolve(x, subject("admin"), "b1")).toBe("full");
    expect(resolve(x, subject(null), "a")).toBe("none");
  });

  it("gives members the workspace default on unrestricted pages, guests nothing", () => {
    const x = acl(tree);
    expect(resolve(x, subject("member"), "a2")).toBe("edit");
    expect(resolve(x, subject("member", [], "u1", "view"), "a")).toBe("view");
    expect(resolve(x, subject("guest"), "a")).toBe("none");
    // Unknown pages behave as top-level pages.
    expect(resolve(x, subject("member"), "not-mirrored")).toBe("edit");
  });

  it("inherits entries down the tree, nearest wins per principal", () => {
    const x = acl(tree, [
      ["a", { principalType: "user", principalId: "u1", level: "comment" }],
      ["a2", { principalType: "user", principalId: "u1", level: "full" }],
    ]);
    expect(resolve(x, subject("member"), "a")).toBe("comment");
    expect(resolve(x, subject("member"), "a1")).toBe("comment");
    expect(resolve(x, subject("member"), "a2")).toBe("full");
    expect(resolve(x, subject("member"), "root")).toBe("edit");
  });

  it("lets a per-user override lower access below the default", () => {
    const x = acl(tree, [["a1", { principalType: "user", principalId: "u1", level: "view" }]]);
    expect(resolve(x, subject("member"), "a2")).toBe("view");
    expect(resolve(x, subject("member", [], "u2"), "a2")).toBe("edit");
  });

  it("takes the highest of group entries and the workspace entry", () => {
    const x = acl(tree, [
      ["root", { principalType: "workspace", principalId: "*", level: "view" }],
      ["a", { principalType: "group", principalId: "design", level: "edit" }],
      ["a1", { principalType: "group", principalId: "writers", level: "comment" }],
    ]);
    expect(resolve(x, subject("member"), "a1")).toBe("view");
    expect(resolve(x, subject("member", ["writers"]), "a1")).toBe("comment");
    expect(resolve(x, subject("member", ["design", "writers"]), "a2")).toBe("edit");
    // Guests get group shares but never the workspace-wide entry.
    expect(resolve(x, subject("guest", ["design"]), "a2")).toBe("edit");
    expect(resolve(x, subject("guest"), "root")).toBe("none");
  });

  it("stops inheritance at a restricted page", () => {
    const x = acl(tree, [
      ["root", { principalType: "group", principalId: "design", level: "full" }],
      ["b", { principalType: "user", principalId: "u2", level: "edit" }],
    ]);
    expect(resolve(x, subject("member", ["design"]), "b1")).toBe("none");
    expect(resolve(x, subject("member", [], "u2"), "b1")).toBe("edit");
    expect(resolve(x, subject("member", ["design"]), "a2")).toBe("full");
  });

  it("fails closed on a cycle in a corrupted tree", () => {
    const x = acl([
      ["p", "q"],
      ["q", "p"],
    ]);
    expect(resolve(x, subject("member"), "p")).toBe("none");
    expect(resolve(x, subject("owner"), "p")).toBe("full");
  });
});

async function setup() {
  const w = await workspaceWithOwner("Docs");
  const member = await w.add("member");
  const guest = await w.add("guest");
  const tree = await api("PUT", `/workspaces/${w.id}/tree`, {
    token: w.owner.accessToken,
    body: {
      nodes: [
        { id: "handbook", parentId: null },
        { id: "policies", parentId: "handbook" },
        { id: "salaries", parentId: "policies" },
        { id: "roadmap", parentId: null },
      ],
    },
  });
  expect(tree.status).toBe(200);
  expect(tree.json.rejected).toEqual([]);
  return { ...w, member, guest };
}

const rpc = () => new IdentityRPC(createExecutionContext(), env);

describe("page tree mirror", () => {
  it("checks every change against the caller's rights", async () => {
    const w = await setup();
    // Guests cannot add top-level pages or anything under pages they cannot edit.
    const g = await api("PUT", `/workspaces/${w.id}/tree`, { token: w.guest.accessToken, body: { nodes: [{ id: "g1", parentId: null }, { id: "g2", parentId: "roadmap" }] } });
    expect(g.json.rejected.map((r: { id: string }) => r.id).sort()).toEqual(["g1", "g2"]);
    // A member restricted on a page cannot move it.
    await api("PUT", `/workspaces/${w.id}/pages/policies/permissions`, { token: w.owner.accessToken, body: { principalType: "user", principalId: w.member.userId, level: "view" } });
    const mv = await api("PUT", `/workspaces/${w.id}/tree`, { token: w.member.accessToken, body: { nodes: [{ id: "policies", parentId: "roadmap" }] } });
    expect(mv.json.rejected).toEqual([{ id: "policies", reason: "no_edit" }]);
    // Cycles are refused.
    const cyc = await api("PUT", `/workspaces/${w.id}/tree`, { token: w.owner.accessToken, body: { nodes: [{ id: "handbook", parentId: "salaries" }] } });
    expect(cyc.json.rejected).toEqual([{ id: "handbook", reason: "cycle" }]);
    // Members cannot remove pages for good; the owner can, with the subtree.
    expect((await api("PUT", `/workspaces/${w.id}/tree`, { token: w.member.accessToken, body: { nodes: [], removed: ["roadmap"] } })).json.rejected).toEqual([
      { id: "roadmap", reason: "no_full_access" },
    ]);
    await api("PUT", `/workspaces/${w.id}/tree`, { token: w.owner.accessToken, body: { nodes: [], removed: ["handbook"] } });
    expect((await rpc().listDocs({ userId: w.owner.userId, workspaceId: w.id })).map((d) => d.docId)).toEqual(["roadmap"]);
  });

  it("moving a page announces an access change for its subtree", async () => {
    const w = await setup();
    await api("PUT", `/workspaces/${w.id}/tree`, { token: w.member.accessToken, body: { nodes: [{ id: "policies", parentId: "roadmap" }] } });
    const ev = (await outbox("access.changed")).filter((e) => e.workspaceId === w.id).at(-1);
    expect(ev.docIds.sort()).toEqual(["policies", "salaries"]);
  });
});

describe("sharing pages", () => {
  it("needs full access, accepts users, groups and the workspace, and limits guests", async () => {
    const w = await setup();
    const url = `/workspaces/${w.id}/pages/handbook/permissions`;
    expect((await api("PUT", url, { token: w.member.accessToken, body: { principalType: "user", principalId: w.guest.userId, level: "view" } })).status).toBe(403);
    expect((await api("PUT", url, { token: w.owner.accessToken, body: { principalType: "user", principalId: w.guest.userId, level: "full" } })).status).toBe(400);
    const outsider = await signUp("Outsider");
    expect((await api("PUT", url, { token: w.owner.accessToken, body: { principalType: "user", principalId: outsider.userId, level: "view" } })).json.error).toBe("not_a_member");
    expect((await api("PUT", url, { token: w.owner.accessToken, body: { principalType: "user", principalId: w.member.userId, level: "full" } })).status).toBe(200);
    // Now the member has full access and can share onward.
    expect((await api("PUT", url, { token: w.member.accessToken, body: { principalType: "user", principalId: w.guest.userId, level: "comment" } })).status).toBe(200);
    const view = await api("GET", `/workspaces/${w.id}/pages/salaries/permissions`, { token: w.guest.accessToken });
    expect(view.json.myLevel).toBe("comment");
    expect(view.json.entries).toEqual(expect.arrayContaining([expect.objectContaining({ principalId: w.guest.userId, level: "comment", pageId: "handbook", inherited: true })]));
    // The guest cannot see pages not shared with them.
    expect((await api("GET", `/workspaces/${w.id}/pages/roadmap/permissions`, { token: w.guest.accessToken })).status).toBe(404);
  });

  it("restricting a page keeps the person who restricted it in", async () => {
    const w = await setup();
    await api("PUT", `/workspaces/${w.id}/pages/salaries/permissions`, { token: w.owner.accessToken, body: { principalType: "user", principalId: w.member.userId, level: "full" } });
    const r = await api("PATCH", `/workspaces/${w.id}/pages/salaries`, { token: w.member.accessToken, body: { inherit: false } });
    expect(r.status).toBe(200);
    expect((await rpc().checkAccess({ userId: w.member.userId, workspaceId: w.id, docId: "salaries" })).level).toBe("full");
    const other = await w.add("member", "Other");
    expect((await rpc().checkAccess({ userId: other.userId, workspaceId: w.id, docId: "salaries" })).level).toBe("none");
    expect((await rpc().checkAccess({ userId: other.userId, workspaceId: w.id, docId: "policies" })).level).toBe("edit");
  });

  it("removing an entry restores inherited access and announces it", async () => {
    const w = await setup();
    await api("PUT", `/workspaces/${w.id}/pages/policies/permissions`, { token: w.owner.accessToken, body: { principalType: "workspace", principalId: "*", level: "view" } });
    expect((await rpc().checkAccess({ userId: w.member.userId, workspaceId: w.id, docId: "salaries" })).level).toBe("view");
    const del = await api("DELETE", `/workspaces/${w.id}/pages/policies/permissions/workspace/*`, { token: w.owner.accessToken });
    expect(del.status).toBe(200);
    expect((await rpc().checkAccess({ userId: w.member.userId, workspaceId: w.id, docId: "salaries" })).level).toBe("edit");
    const events = (await outbox("access.changed")).filter((e) => e.workspaceId === w.id);
    expect(events.at(-1)).toMatchObject({ docIds: ["policies", "salaries"], userIds: null });
  });
});

describe("Service Binding contract", () => {
  it("checkAccess returns the effective level for users, groups and overrides", async () => {
    const w = await setup();
    const g = await api("POST", `/workspaces/${w.id}/groups`, { token: w.owner.accessToken, body: { name: "Finance" } });
    await api("PUT", `/workspaces/${w.id}/groups/${g.json.id}/members`, { token: w.owner.accessToken, body: { userIds: [w.guest.userId] } });
    await api("PUT", `/workspaces/${w.id}/pages/policies/permissions`, { token: w.owner.accessToken, body: { principalType: "group", principalId: g.json.id, level: "edit" } });
    await api("PUT", `/workspaces/${w.id}/pages/salaries/permissions`, { token: w.owner.accessToken, body: { principalType: "user", principalId: w.member.userId, level: "view" } });

    const check = (userId: string, docId: string) => rpc().checkAccess({ userId, workspaceId: w.id, docId });
    expect(await check(w.owner.userId, "salaries")).toEqual({ level: "full" });
    expect(await check(w.member.userId, "policies")).toEqual({ level: "edit" });
    expect(await check(w.member.userId, "salaries")).toEqual({ level: "view" });
    expect(await check(w.guest.userId, "salaries")).toEqual({ level: "edit" });
    expect(await check(w.guest.userId, "roadmap")).toEqual({ level: "none" });
    const stranger = await signUp("Stranger");
    expect(await check(stranger.userId, "roadmap")).toEqual({ level: "none" });
    expect(await rpc().checkAccess({ userId: 1 as unknown as string, workspaceId: w.id, docId: "x" })).toEqual({ level: "none" });
  });

  it("listDocs returns every page the user can reach with its level", async () => {
    const w = await setup();
    await api("PUT", `/workspaces/${w.id}/pages/handbook/permissions`, { token: w.owner.accessToken, body: { principalType: "user", principalId: w.guest.userId, level: "view" } });
    const docs = await rpc().listDocs({ userId: w.guest.userId, workspaceId: w.id });
    expect(docs.sort((a, b) => a.docId.localeCompare(b.docId))).toEqual([
      { docId: "handbook", level: "view" },
      { docId: "policies", level: "view" },
      { docId: "salaries", level: "view" },
    ]);
    expect(await rpc().listDocs({ userId: w.owner.userId, workspaceId: w.id })).toHaveLength(4);
    const access = await api("GET", `/workspaces/${w.id}/access`, { token: w.guest.accessToken });
    expect(access.json).toMatchObject({ role: "guest", defaultLevel: "edit" });
    expect(access.json.docs).toHaveLength(3);
  });

  it("access drops to none the moment a member is removed, and an event is queued", async () => {
    const w = await setup();
    expect((await rpc().checkAccess({ userId: w.member.userId, workspaceId: w.id, docId: "roadmap" })).level).toBe("edit");
    await api("DELETE", `/workspaces/${w.id}/members/${w.member.userId}`, { token: w.owner.accessToken });
    expect((await rpc().checkAccess({ userId: w.member.userId, workspaceId: w.id, docId: "roadmap" })).level).toBe("none");
    expect(await rpc().listDocs({ userId: w.member.userId, workspaceId: w.id })).toEqual([]);
    const ev = (await outbox("member.removed")).find((e) => e.userId === w.member.userId);
    expect(ev).toMatchObject({ type: "member.removed", workspaceId: w.id });
    expect(typeof ev.id).toBe("string");
    expect(typeof ev.at).toBe("number");
  });
});
