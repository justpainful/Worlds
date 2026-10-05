import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { canChangeRole, canInvite, canRemove } from "../src/domain/roles";
import { api, auditActions, outbox, signUp, workspaceWithOwner } from "./helpers";

describe("role rules (pure)", () => {
  it("decide who may invite which role", () => {
    expect(canInvite("owner", "admin")).toBe(true);
    expect(canInvite("owner", "guest")).toBe(true);
    expect(canInvite("owner", "owner")).toBe(false);
    expect(canInvite("admin", "member")).toBe(true);
    expect(canInvite("admin", "admin")).toBe(false);
    expect(canInvite("member", "guest")).toBe(false);
    expect(canInvite("guest", "guest")).toBe(false);
  });

  it("decide who may change roles", () => {
    expect(canChangeRole("owner", "member", "admin", false)).toBe(true);
    expect(canChangeRole("owner", "admin", "member", false)).toBe(true);
    expect(canChangeRole("owner", "owner", "admin", true)).toBe(false);
    expect(canChangeRole("admin", "member", "guest", false)).toBe(true);
    expect(canChangeRole("admin", "member", "admin", false)).toBe(false);
    expect(canChangeRole("admin", "admin", "member", false)).toBe(false);
    expect(canChangeRole("member", "guest", "member", false)).toBe(false);
    expect(canChangeRole("owner", "member", "owner", false)).toBe(false);
  });

  it("decide who may remove whom", () => {
    expect(canRemove("owner", "admin", false)).toBe(true);
    expect(canRemove("admin", "member", false)).toBe(true);
    expect(canRemove("admin", "admin", false)).toBe(false);
    expect(canRemove("admin", "owner", false)).toBe(false);
    expect(canRemove("member", "guest", false)).toBe(false);
  });
});

describe("workspaces", () => {
  it("creates a workspace with the creator as owner and lists it", async () => {
    const { id, owner } = await workspaceWithOwner("Studio");
    const list = await api("GET", "/workspaces", { token: owner.accessToken });
    expect(list.json).toEqual([expect.objectContaining({ id, name: "Studio", role: "owner", memberCount: 1 })]);
    const outsider = await signUp("Outsider");
    expect((await api("GET", `/workspaces/${id}`, { token: outsider.accessToken })).status).toBe(404);
    expect((await auditActions({ workspaceId: id })).map((a) => a.action)).toContain("workspace.created");
  });

  it("lets owners and admins rename it, not members", async () => {
    const { id, owner, add } = await workspaceWithOwner();
    const member = await add("member");
    const admin = await add("admin");
    expect((await api("PATCH", `/workspaces/${id}`, { token: member.accessToken, body: { name: "X" } })).status).toBe(403);
    expect((await api("PATCH", `/workspaces/${id}`, { token: admin.accessToken, body: { name: "Renamed" } })).json.name).toBe("Renamed");
    expect((await api("PATCH", `/workspaces/${id}`, { token: owner.accessToken, body: { defaultLevel: "full" } })).status).toBe(400);
  });

  it("only the owner deletes it, and the sync service hears about it", async () => {
    const { id, owner, add } = await workspaceWithOwner();
    const admin = await add("admin");
    expect((await api("DELETE", `/workspaces/${id}`, { token: admin.accessToken })).status).toBe(403);
    expect((await api("DELETE", `/workspaces/${id}`, { token: owner.accessToken })).status).toBe(200);
    expect((await api("GET", `/workspaces/${id}`, { token: owner.accessToken })).status).toBe(404);
    expect((await outbox("workspace.deleted")).some((e) => e.workspaceId === id)).toBe(true);
  });
});

describe("invites", () => {
  it("create, preview and accept", async () => {
    const { id, owner } = await workspaceWithOwner("Invite Co");
    const inv = await api("POST", `/workspaces/${id}/invites`, { token: owner.accessToken, body: { role: "member", expiresInHours: 24 } });
    expect(inv.status).toBe(201);
    expect(inv.json.url).toContain(`/join/${inv.json.token}`);
    const stored = await env.DB.prepare("SELECT token_hash FROM invites WHERE id = ?1").bind(inv.json.id).first<{ token_hash: string }>();
    expect(stored!.token_hash).not.toBe(inv.json.token);

    const preview = await api("GET", `/invites/${inv.json.token}`);
    expect(preview.json).toMatchObject({ valid: true, role: "member", workspace: { id, name: "Invite Co" } });

    const joiner = await signUp("Joiner");
    const acc = await api("POST", `/invites/${inv.json.token}/accept`, { token: joiner.accessToken });
    expect(acc.status).toBe(200);
    expect(acc.json.workspace.role).toBe("member");
    const again = await api("POST", `/invites/${inv.json.token}/accept`, { token: joiner.accessToken });
    expect(again.json.alreadyMember).toBe(true);
    const members = await api("GET", `/workspaces/${id}/members`, { token: joiner.accessToken });
    expect(members.json.map((m: { role: string }) => m.role)).toEqual(["owner", "member"]);
    expect((await auditActions({ workspaceId: id })).map((a) => a.action)).toEqual(expect.arrayContaining(["invite.created", "member.joined"]));
  });

  it("stop working when expired", async () => {
    const { id, owner } = await workspaceWithOwner();
    const inv = await api("POST", `/workspaces/${id}/invites`, { token: owner.accessToken, body: { role: "guest", expiresInHours: 1 } });
    await env.DB.prepare("UPDATE invites SET expires_at = ?1 WHERE id = ?2").bind(Date.now() - 1, inv.json.id).run();
    const joiner = await signUp("Late");
    const acc = await api("POST", `/invites/${inv.json.token}/accept`, { token: joiner.accessToken });
    expect(acc.status).toBe(410);
    expect(acc.json.error).toBe("invite_expired");
    expect((await api("GET", `/invites/${inv.json.token}`)).json).toMatchObject({ valid: false, reason: "invite_expired" });
  });

  it("stop working at once when revoked", async () => {
    const { id, owner } = await workspaceWithOwner();
    const inv = await api("POST", `/workspaces/${id}/invites`, { token: owner.accessToken, body: {} });
    expect((await api("DELETE", `/workspaces/${id}/invites/${inv.json.id}`, { token: owner.accessToken })).status).toBe(200);
    const joiner = await signUp("Revoked");
    const acc = await api("POST", `/invites/${inv.json.token}/accept`, { token: joiner.accessToken });
    expect(acc.status).toBe(410);
    expect(acc.json.error).toBe("invite_revoked");
    const list = await api("GET", `/workspaces/${id}/invites`, { token: owner.accessToken });
    expect(list.json[0]).toMatchObject({ id: inv.json.id, active: false });
    expect((await auditActions({ workspaceId: id })).map((a) => a.action)).toContain("invite.revoked");
  });

  it("honour max uses", async () => {
    const { id, owner } = await workspaceWithOwner();
    const inv = await api("POST", `/workspaces/${id}/invites`, { token: owner.accessToken, body: { role: "member", maxUses: 2 } });
    for (const name of ["One", "Two"]) {
      const u = await signUp(name);
      expect((await api("POST", `/invites/${inv.json.token}/accept`, { token: u.accessToken })).status).toBe(200);
    }
    const three = await signUp("Three");
    const r = await api("POST", `/invites/${inv.json.token}/accept`, { token: three.accessToken });
    expect(r.status).toBe(410);
    expect(r.json.error).toBe("invite_used_up");
  });

  it("are limited by role", async () => {
    const { id, owner, add } = await workspaceWithOwner();
    const admin = await add("admin");
    const member = await add("member");
    expect((await api("POST", `/workspaces/${id}/invites`, { token: member.accessToken, body: { role: "guest" } })).status).toBe(403);
    expect((await api("POST", `/workspaces/${id}/invites`, { token: admin.accessToken, body: { role: "admin" } })).status).toBe(403);
    expect((await api("POST", `/workspaces/${id}/invites`, { token: admin.accessToken, body: { role: "member" } })).status).toBe(201);
    expect((await api("POST", `/workspaces/${id}/invites`, { token: owner.accessToken, body: { role: "admin" } })).status).toBe(201);
    expect((await api("POST", `/workspaces/${id}/invites`, { token: owner.accessToken, body: { role: "owner" } })).status).toBe(403);
    expect((await api("POST", `/workspaces/${id}/invites`, { token: owner.accessToken, body: { expiresInHours: 10_000 } })).status).toBe(400);
    expect((await api("GET", `/workspaces/${id}/invites`, { token: member.accessToken })).status).toBe(403);
  });
});

describe("members", () => {
  it("role changes follow the rules and are announced", async () => {
    const { id, owner, add } = await workspaceWithOwner();
    const admin = await add("admin");
    const member = await add("member");
    const guest = await add("guest");
    // Admin can move members and guests between member and guest.
    expect((await api("PATCH", `/workspaces/${id}/members/${guest.userId}`, { token: admin.accessToken, body: { role: "member" } })).status).toBe(200);
    // Admin cannot create admins or touch the owner.
    expect((await api("PATCH", `/workspaces/${id}/members/${member.userId}`, { token: admin.accessToken, body: { role: "admin" } })).status).toBe(403);
    expect((await api("PATCH", `/workspaces/${id}/members/${owner.userId}`, { token: admin.accessToken, body: { role: "member" } })).status).toBe(403);
    // Members cannot change roles; nobody changes their own.
    expect((await api("PATCH", `/workspaces/${id}/members/${guest.userId}`, { token: member.accessToken, body: { role: "guest" } })).status).toBe(403);
    expect((await api("PATCH", `/workspaces/${id}/members/${admin.userId}`, { token: admin.accessToken, body: { role: "member" } })).status).toBe(403);
    // Owner can promote.
    expect((await api("PATCH", `/workspaces/${id}/members/${member.userId}`, { token: owner.accessToken, body: { role: "admin" } })).status).toBe(200);
    expect((await outbox("member.role_changed")).filter((e) => e.workspaceId === id).map((e) => e.role)).toEqual(["member", "admin"]);
  });

  it("removal follows the rules and the removed person loses access immediately", async () => {
    const { id, owner, add } = await workspaceWithOwner();
    const admin = await add("admin");
    const member = await add("member");
    const other = await add("member", "Other");
    expect((await api("DELETE", `/workspaces/${id}/members/${admin.userId}`, { token: member.accessToken })).status).toBe(403);
    expect((await api("DELETE", `/workspaces/${id}/members/${owner.userId}`, { token: admin.accessToken })).status).toBe(403);
    expect((await api("DELETE", `/workspaces/${id}/members/${member.userId}`, { token: admin.accessToken })).status).toBe(200);
    expect((await api("GET", `/workspaces/${id}`, { token: member.accessToken })).status).toBe(404);
    expect((await api("DELETE", `/workspaces/${id}/members/${admin.userId}`, { token: owner.accessToken })).status).toBe(200);
    expect((await outbox("member.removed")).filter((e) => e.workspaceId === id).map((e) => e.userId)).toEqual([member.userId, admin.userId]);
    void other;
  });

  it("members leave; the owner must transfer first", async () => {
    const { id, owner, add } = await workspaceWithOwner();
    const member = await add("member");
    const guest = await add("guest");
    expect((await api("POST", `/workspaces/${id}/leave`, { token: owner.accessToken })).status).toBe(403);
    expect((await api("POST", `/workspaces/${id}/leave`, { token: guest.accessToken })).status).toBe(200);
    expect((await api("POST", `/workspaces/${id}/transfer`, { token: member.accessToken, body: { userId: member.userId } })).status).toBe(403);
    expect((await api("POST", `/workspaces/${id}/transfer`, { token: owner.accessToken, body: { userId: member.userId } })).status).toBe(200);
    const ws = await api("GET", `/workspaces/${id}`, { token: member.accessToken });
    expect(ws.json).toMatchObject({ role: "owner", ownerId: member.userId });
    expect((await api("GET", `/workspaces/${id}`, { token: owner.accessToken })).json.role).toBe("admin");
    expect((await api("POST", `/workspaces/${id}/leave`, { token: owner.accessToken })).status).toBe(200);
    const actions = (await auditActions({ workspaceId: id })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["member.left", "workspace.ownership_transferred"]));
  });
});

describe("groups", () => {
  it("are managed by owners and admins, with members from the workspace only", async () => {
    const { id, owner, add } = await workspaceWithOwner();
    const member = await add("member");
    const outsider = await signUp("Outside");
    expect((await api("POST", `/workspaces/${id}/groups`, { token: member.accessToken, body: { name: "Design" } })).status).toBe(403);
    const g = await api("POST", `/workspaces/${id}/groups`, { token: owner.accessToken, body: { name: "Design" } });
    expect(g.status).toBe(201);
    expect((await api("POST", `/workspaces/${id}/groups`, { token: owner.accessToken, body: { name: "Design" } })).status).toBe(409);
    expect((await api("PUT", `/workspaces/${id}/groups/${g.json.id}/members`, { token: owner.accessToken, body: { userIds: [outsider.userId] } })).status).toBe(400);
    expect((await api("PUT", `/workspaces/${id}/groups/${g.json.id}/members`, { token: owner.accessToken, body: { userIds: [member.userId] } })).status).toBe(200);
    const list = await api("GET", `/workspaces/${id}/groups`, { token: member.accessToken });
    expect(list.json).toEqual([expect.objectContaining({ name: "Design", memberIds: [member.userId] })]);
    expect((await outbox("access.changed")).some((e) => e.workspaceId === id && e.userIds?.includes(member.userId))).toBe(true);
  });
});

describe("audit log", () => {
  it("records actor kind and device, and is readable by owners and admins only", async () => {
    const { id, owner, add } = await workspaceWithOwner();
    const member = await add("member");
    await api("POST", `/workspaces/${id}/groups`, { token: owner.accessToken, headers: { "x-worlds-actor": "ai-on-behalf-of-user" }, body: { name: "Claude made this" } });
    await api("PATCH", `/workspaces/${id}`, { token: owner.accessToken, headers: { "x-worlds-actor": "automation" }, body: { name: "Auto" } });
    const log = await api("GET", `/workspaces/${id}/audit`, { token: owner.accessToken });
    expect(log.status).toBe(200);
    const group = log.json.find((r: { action: string }) => r.action === "group.created");
    expect(group).toMatchObject({ actorUserId: owner.userId, actorKind: "ai-on-behalf-of-user", deviceId: owner.deviceId, workspaceId: id });
    expect(log.json.find((r: { action: string }) => r.action === "workspace.updated").actorKind).toBe("automation");
    expect(log.json.find((r: { action: string }) => r.action === "member.joined").actorKind).toBe("user");
    expect((await api("GET", `/workspaces/${id}/audit`, { token: member.accessToken })).status).toBe(403);
    const mine = await api("GET", "/me/audit", { token: owner.accessToken });
    expect(mine.json.map((r: { action: string }) => r.action)).toEqual(expect.arrayContaining(["auth.signed_in", "account.created", "workspace.created"]));
  });
});
