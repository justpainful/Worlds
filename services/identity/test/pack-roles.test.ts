import { createExecutionContext, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { hiddenDocOf } from "../src/domain/access";
import { IdentityRPC } from "../src/index";
import { api, auditActions, outbox, workspaceWithOwner } from "./helpers";

const rpc = () => new IdentityRPC(createExecutionContext(), env);

async function setup() {
  const w = await workspaceWithOwner("School");
  const admin = await w.add("admin");
  const teacher = await w.add("member", "Teacher");
  const student = await w.add("member", "Student");
  const tree = await api("PUT", `/workspaces/${w.id}/tree`, { token: w.owner.accessToken, body: { nodes: [{ id: "grade1", parentId: null }] } });
  expect(tree.status).toBe(200);
  return { ...w, admin, teacher, student };
}

const level = async (userId: string, workspaceId: string, docId: string) => (await rpc().checkAccess({ userId, workspaceId, docId })).level;

describe("pack roles", () => {
  it("names an item's hidden document by page and pack", () => {
    expect(hiddenDocOf("grade1__hidden__teacher")).toEqual({ pageId: "grade1", packId: "teacher" });
    expect(hiddenDocOf("grade1")).toBeNull();
    expect(hiddenDocOf("__hidden__teacher")).toBeNull();
    expect(hiddenDocOf("grade1__hidden__Teacher")).toBeNull();
  });

  it("keeps a restricted role out of an item's hidden fields, and lets everyone else in", async () => {
    const w = await setup();
    const hidden = "grade1__hidden__teacher";
    // Before any pack role, members open the hidden fields like the page.
    expect(await level(w.student.userId, w.id, hidden)).toBe("edit");

    const set = await api("PUT", `/workspaces/${w.id}/pack-roles`, {
      token: w.owner.accessToken,
      body: { userId: w.student.userId, packId: "teacher", roleId: "student", restricted: true },
    });
    expect(set.status).toBe(200);
    await api("PUT", `/workspaces/${w.id}/pack-roles`, {
      token: w.owner.accessToken,
      body: { userId: w.teacher.userId, packId: "teacher", roleId: "teacher", restricted: false },
    });

    expect(await level(w.student.userId, w.id, hidden)).toBe("none");
    expect(await level(w.student.userId, w.id, "grade1")).toBe("edit");
    expect(await level(w.teacher.userId, w.id, hidden)).toBe("edit");
    expect(await level(w.admin.userId, w.id, hidden)).toBe("full");
    expect(await level(w.owner.userId, w.id, hidden)).toBe("full");
    // The role is per pack: the same person is not restricted elsewhere.
    expect(await level(w.student.userId, w.id, "grade1__hidden__shop")).toBe("edit");

    // The sync service is told to check this person's open documents again.
    const events = (await outbox("access.changed")).filter((e) => e.workspaceId === w.id && e.userIds?.includes(w.student.userId));
    expect(events.length).toBeGreaterThan(0);
    expect((await auditActions({ workspaceId: w.id })).map((a) => a.action)).toContain("pack_role.set");

    // Removing the role lets them back in.
    await api("PUT", `/workspaces/${w.id}/pack-roles`, { token: w.owner.accessToken, body: { userId: w.student.userId, packId: "teacher", roleId: null } });
    expect(await level(w.student.userId, w.id, hidden)).toBe("edit");
  });

  it("lets only owners and admins give roles, and shows members only their own", async () => {
    const w = await setup();
    const byMember = await api("PUT", `/workspaces/${w.id}/pack-roles`, {
      token: w.teacher.accessToken,
      body: { userId: w.student.userId, packId: "teacher", roleId: "student", restricted: false },
    });
    expect(byMember.status).toBe(403);
    const byAdmin = await api("PUT", `/workspaces/${w.id}/pack-roles`, {
      token: w.admin.accessToken,
      body: { userId: w.student.userId, packId: "teacher", roleId: "student", restricted: true },
    });
    expect(byAdmin.status).toBe(200);
    await api("PUT", `/workspaces/${w.id}/pack-roles`, {
      token: w.admin.accessToken,
      body: { userId: w.teacher.userId, packId: "teacher", roleId: "teacher", restricted: false },
    });

    const all = await api("GET", `/workspaces/${w.id}/pack-roles`, { token: w.owner.accessToken });
    expect(all.json).toHaveLength(2);
    const mine = await api("GET", `/workspaces/${w.id}/pack-roles`, { token: w.student.accessToken });
    expect(mine.json).toEqual([expect.objectContaining({ userId: w.student.userId, packId: "teacher", roleId: "student", restricted: true })]);
  });

  it("lists the members who hold a role in a pack, for publishing to them", async () => {
    const w = await setup();
    await api("PUT", `/workspaces/${w.id}/pack-roles`, { token: w.owner.accessToken, body: { userId: w.student.userId, packId: "teacher", roleId: "student", restricted: true } });
    await api("PUT", `/workspaces/${w.id}/pack-roles`, { token: w.owner.accessToken, body: { userId: w.teacher.userId, packId: "teacher", roleId: "teacher", restricted: false } });
    expect((await rpc().packMembers({ workspaceId: w.id, packId: "teacher", roleId: "student" })).userIds).toEqual([w.student.userId]);
    expect((await rpc().packMembers({ workspaceId: w.id, packId: "teacher", roleId: "parent" })).userIds).toEqual([]);
    expect((await rpc().packMembers({ workspaceId: w.id, packId: "Bad", roleId: "student" })).userIds).toEqual([]);
  });

  it("refuses bad ids and people who are not members", async () => {
    const w = await setup();
    const put = (body: unknown) => api("PUT", `/workspaces/${w.id}/pack-roles`, { token: w.owner.accessToken, body });
    expect((await put({ userId: w.student.userId, packId: "Teacher", roleId: "student", restricted: true })).status).toBe(400);
    expect((await put({ userId: w.student.userId, packId: "teacher", roleId: "a b", restricted: true })).status).toBe(400);
    expect((await put({ userId: w.student.userId, packId: "teacher", roleId: "student" })).status).toBe(400);
    expect((await put({ userId: "nobody", packId: "teacher", roleId: "student", restricted: true })).status).toBe(404);
  });
});
