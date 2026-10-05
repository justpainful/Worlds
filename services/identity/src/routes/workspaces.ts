import { Hono, type Context } from "hono";
import type { AppEnv, Caller } from "../env";
import { atLeast, canChangeRole, canInvite, canLeave, canManageGroups, canManageInvites, canManageWorkspace, canReadAudit, canRemove, isLevel, isRole, type Level, type Role } from "../domain/roles";
import { chainOf, descendants, loadAcl, loadSubject, resolve, type WorkspaceAcl } from "../domain/access";
import { auditStmt, listAudit, type AuditEntry } from "../lib/audit";
import { emit, requireAuth } from "../lib/auth";
import { newId, now, randomToken, sha256Hex } from "../lib/crypto";
import { eventStmt, type AccessEvent, type EventEnvelope } from "../lib/events";
import { ApiError, bad, body, conflict, forbidden, notFound, optStr, str } from "../lib/http";
import { clientIp, rateLimit } from "../lib/ratelimit";

export const workspaces = new Hono<AppEnv>();
export const invites = new Hono<AppEnv>();

type C = Context<AppEnv>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The caller's role, or 404 (non-members cannot tell a workspace exists). */
async function roleIn(c: C, workspaceId: string): Promise<Role> {
  const row = await c.env.DB.prepare("SELECT role FROM members WHERE workspace_id = ?1 AND user_id = ?2")
    .bind(workspaceId, c.get("caller").userId)
    .first<{ role: Role }>();
  if (!row) throw notFound("workspace_not_found", "Workspace not found.");
  return row.role;
}

function auditOf(caller: Caller, workspaceId: string | null, e: Omit<AuditEntry, "actorUserId" | "actorKind" | "deviceId" | "workspaceId">): AuditEntry {
  return { ...e, workspaceId, actorUserId: caller.userId, actorKind: caller.actor, deviceId: caller.deviceId };
}

/** Run statements atomically together with their audit rows and events, then deliver the events. */
async function commit(c: C, stmts: D1PreparedStatement[], audits: AuditEntry[], events: AccessEvent[]): Promise<D1Result[]> {
  const evs = events.map((e) => eventStmt(c.env.DB, e));
  const res = await c.env.DB.batch([...stmts, ...audits.map((a) => auditStmt(c.env.DB, a)), ...evs.map((e) => e.stmt)]);
  emit(c, evs.map((e) => e.envelope) as EventEnvelope[]);
  return res;
}

async function workspaceView(db: D1Database, workspaceId: string, role: Role) {
  const w = await db
    .prepare("SELECT id, name, owner_id, default_level, created_at, (SELECT COUNT(*) FROM members m WHERE m.workspace_id = w.id) AS member_count FROM workspaces w WHERE id = ?1")
    .bind(workspaceId)
    .first<{ id: string; name: string; owner_id: string; default_level: string; created_at: number; member_count: number }>();
  if (!w) throw notFound("workspace_not_found", "Workspace not found.");
  return { id: w.id, name: w.name, ownerId: w.owner_id, defaultLevel: w.default_level, createdAt: w.created_at, memberCount: w.member_count, role };
}

async function myLevel(c: C, workspaceId: string, pageId: string, acl?: WorkspaceAcl): Promise<Level> {
  const subject = await loadSubject(c.env.DB, workspaceId, c.get("caller").userId);
  return resolve(acl ?? (await loadAcl(c.env.DB, workspaceId)), subject, pageId);
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

workspaces.use("*", requireAuth);

workspaces.post("/", async (c) => {
  const caller = c.get("caller");
  const b = await body(c.req);
  const name = str(b.name, "name", 80);
  await rateLimit(c.env.DB, `ws-create:${caller.userId}`, 20, 3_600_000);
  const id = newId();
  const t = now();
  await commit(
    c,
    [
      c.env.DB.prepare("INSERT INTO workspaces (id, name, owner_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)").bind(id, name, caller.userId, t),
      c.env.DB.prepare("INSERT INTO members (workspace_id, user_id, role, joined_at) VALUES (?1, ?2, 'owner', ?3)").bind(id, caller.userId, t),
    ],
    [auditOf(caller, id, { action: "workspace.created", targetType: "workspace", targetId: id, meta: { name } })],
    [],
  );
  return c.json(await workspaceView(c.env.DB, id, "owner"), 201);
});

workspaces.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT w.id, w.name, w.owner_id, w.default_level, w.created_at, m.role,
            (SELECT COUNT(*) FROM members x WHERE x.workspace_id = w.id) AS member_count
     FROM members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ?1 ORDER BY w.name COLLATE NOCASE`,
  )
    .bind(c.get("caller").userId)
    .all<{ id: string; name: string; owner_id: string; default_level: string; created_at: number; role: Role; member_count: number }>();
  return c.json(
    results.map((w) => ({ id: w.id, name: w.name, ownerId: w.owner_id, defaultLevel: w.default_level, createdAt: w.created_at, memberCount: w.member_count, role: w.role })),
  );
});

workspaces.get("/:id", async (c) => {
  const id = c.req.param("id");
  return c.json(await workspaceView(c.env.DB, id, await roleIn(c, id)));
});

workspaces.patch("/:id", async (c) => {
  const caller = c.get("caller");
  const id = c.req.param("id");
  const role = await roleIn(c, id);
  if (!canManageWorkspace(role)) throw forbidden("forbidden", "Only owners and admins can change workspace settings.");
  const b = await body(c.req);
  const name = optStr(b.name, "name", 80);
  const def = b.defaultLevel;
  if (def !== undefined && (!isLevel(def) || def === "full")) throw bad("invalid_level", "defaultLevel must be edit, comment, view or none");
  await commit(
    c,
    [c.env.DB.prepare("UPDATE workspaces SET name = COALESCE(?1, name), default_level = COALESCE(?2, default_level), updated_at = ?3 WHERE id = ?4").bind(name ?? null, def ?? null, now(), id)],
    [auditOf(caller, id, { action: "workspace.updated", targetType: "workspace", targetId: id, meta: { name, defaultLevel: def } })],
    def !== undefined ? [{ type: "access.changed", workspaceId: id, docIds: null, userIds: null }] : [],
  );
  return c.json(await workspaceView(c.env.DB, id, role));
});

workspaces.delete("/:id", async (c) => {
  const caller = c.get("caller");
  const id = c.req.param("id");
  if ((await roleIn(c, id)) !== "owner") throw forbidden("forbidden", "Only the owner can delete a workspace.");
  await commit(
    c,
    [c.env.DB.prepare("DELETE FROM workspaces WHERE id = ?1").bind(id)],
    [auditOf(caller, id, { action: "workspace.deleted", targetType: "workspace", targetId: id })],
    [{ type: "workspace.deleted", workspaceId: id }],
  );
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Members and roles
// ---------------------------------------------------------------------------

workspaces.get("/:id/members", async (c) => {
  const id = c.req.param("id");
  await roleIn(c, id);
  const { results } = await c.env.DB.prepare(
    `SELECT m.user_id, m.role, m.joined_at, u.display_name, u.email, u.avatar_url
     FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ?1
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, u.display_name COLLATE NOCASE`,
  )
    .bind(id)
    .all<{ user_id: string; role: Role; joined_at: number; display_name: string; email: string; avatar_url: string | null }>();
  return c.json(results.map((m) => ({ userId: m.user_id, role: m.role, joinedAt: m.joined_at, displayName: m.display_name, email: m.email, avatarUrl: m.avatar_url })));
});

workspaces.patch("/:id/members/:userId", async (c) => {
  const caller = c.get("caller");
  const id = c.req.param("id");
  const target = c.req.param("userId");
  const actorRole = await roleIn(c, id);
  const next = (await body(c.req)).role;
  if (!isRole(next)) throw bad("invalid_role", "role must be admin, member or guest");
  const row = await c.env.DB.prepare("SELECT role FROM members WHERE workspace_id = ?1 AND user_id = ?2").bind(id, target).first<{ role: Role }>();
  if (!row) throw notFound("member_not_found", "That person is not in this workspace.");
  if (!canChangeRole(actorRole, row.role, next, target === caller.userId)) throw forbidden("forbidden", "You cannot change this person's role.");
  if (row.role === next) return c.json({ userId: target, role: next });
  await commit(
    c,
    [c.env.DB.prepare("UPDATE members SET role = ?1 WHERE workspace_id = ?2 AND user_id = ?3").bind(next, id, target)],
    [auditOf(caller, id, { action: "member.role_changed", targetType: "user", targetId: target, meta: { from: row.role, to: next } })],
    [{ type: "member.role_changed", workspaceId: id, userId: target, role: next }],
  );
  return c.json({ userId: target, role: next });
});

async function removeMember(c: C, id: string, target: string, action: "member.removed" | "member.left") {
  const caller = c.get("caller");
  await commit(
    c,
    [
      c.env.DB.prepare("DELETE FROM members WHERE workspace_id = ?1 AND user_id = ?2").bind(id, target),
      c.env.DB.prepare("DELETE FROM group_members WHERE user_id = ?1 AND group_id IN (SELECT id FROM groups WHERE workspace_id = ?2)").bind(target, id),
      c.env.DB.prepare("DELETE FROM page_permissions WHERE workspace_id = ?1 AND principal_type = 'user' AND principal_id = ?2").bind(id, target),
    ],
    [auditOf(caller, id, { action, targetType: "user", targetId: target })],
    [{ type: "member.removed", workspaceId: id, userId: target }],
  );
}

workspaces.delete("/:id/members/:userId", async (c) => {
  const caller = c.get("caller");
  const id = c.req.param("id");
  const target = c.req.param("userId");
  const actorRole = await roleIn(c, id);
  if (target === caller.userId) {
    if (!canLeave(actorRole)) throw forbidden("owner_cannot_leave", "Transfer ownership before leaving.");
    await removeMember(c, id, target, "member.left");
    return c.json({ ok: true });
  }
  const row = await c.env.DB.prepare("SELECT role FROM members WHERE workspace_id = ?1 AND user_id = ?2").bind(id, target).first<{ role: Role }>();
  if (!row) throw notFound("member_not_found", "That person is not in this workspace.");
  if (!canRemove(actorRole, row.role, false)) throw forbidden("forbidden", "You cannot remove this person.");
  await removeMember(c, id, target, "member.removed");
  return c.json({ ok: true });
});

workspaces.post("/:id/leave", async (c) => {
  const id = c.req.param("id");
  if (!canLeave(await roleIn(c, id))) throw forbidden("owner_cannot_leave", "Transfer ownership before leaving.");
  await removeMember(c, id, c.get("caller").userId, "member.left");
  return c.json({ ok: true });
});

workspaces.post("/:id/transfer", async (c) => {
  const caller = c.get("caller");
  const id = c.req.param("id");
  if ((await roleIn(c, id)) !== "owner") throw forbidden("forbidden", "Only the owner can transfer ownership.");
  const target = str((await body(c.req)).userId, "userId", 64);
  if (target === caller.userId) throw bad("invalid_request", "You already own this workspace.");
  const row = await c.env.DB.prepare("SELECT role FROM members WHERE workspace_id = ?1 AND user_id = ?2").bind(id, target).first<{ role: Role }>();
  if (!row) throw notFound("member_not_found", "That person is not in this workspace.");
  if (row.role === "guest") throw bad("invalid_request", "Make the guest a member before transferring ownership.");
  await commit(
    c,
    [
      c.env.DB.prepare("UPDATE members SET role = 'admin' WHERE workspace_id = ?1 AND user_id = ?2").bind(id, caller.userId),
      c.env.DB.prepare("UPDATE members SET role = 'owner' WHERE workspace_id = ?1 AND user_id = ?2").bind(id, target),
      c.env.DB.prepare("UPDATE workspaces SET owner_id = ?1, updated_at = ?2 WHERE id = ?3").bind(target, now(), id),
    ],
    [auditOf(caller, id, { action: "workspace.ownership_transferred", targetType: "user", targetId: target, meta: { from: caller.userId } })],
    [
      { type: "member.role_changed", workspaceId: id, userId: caller.userId, role: "admin" },
      { type: "member.role_changed", workspaceId: id, userId: target, role: "owner" },
    ],
  );
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

workspaces.get("/:id/groups", async (c) => {
  const id = c.req.param("id");
  await roleIn(c, id);
  const [groups, gm] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT id, name, created_at FROM groups WHERE workspace_id = ?1 ORDER BY name COLLATE NOCASE").bind(id),
    c.env.DB.prepare("SELECT gm.group_id, gm.user_id FROM group_members gm JOIN groups g ON g.id = gm.group_id WHERE g.workspace_id = ?1").bind(id),
  ]);
  const members = new Map<string, string[]>();
  for (const r of gm.results as { group_id: string; user_id: string }[]) members.set(r.group_id, [...(members.get(r.group_id) ?? []), r.user_id]);
  return c.json((groups.results as { id: string; name: string; created_at: number }[]).map((g) => ({ id: g.id, name: g.name, createdAt: g.created_at, memberIds: members.get(g.id) ?? [] })));
});

workspaces.post("/:id/groups", async (c) => {
  const caller = c.get("caller");
  const id = c.req.param("id");
  if (!canManageGroups(await roleIn(c, id))) throw forbidden("forbidden", "Only owners and admins can manage groups.");
  const name = str((await body(c.req)).name, "name", 60);
  const gid = newId();
  try {
    await commit(
      c,
      [c.env.DB.prepare("INSERT INTO groups (id, workspace_id, name, created_at) VALUES (?1, ?2, ?3, ?4)").bind(gid, id, name, now())],
      [auditOf(caller, id, { action: "group.created", targetType: "group", targetId: gid, meta: { name } })],
      [],
    );
  } catch {
    throw conflict("group_exists", "A group with that name already exists.");
  }
  return c.json({ id: gid, name, memberIds: [] }, 201);
});

async function groupIn(c: C, workspaceId: string, groupId: string): Promise<void> {
  const g = await c.env.DB.prepare("SELECT id FROM groups WHERE id = ?1 AND workspace_id = ?2").bind(groupId, workspaceId).first();
  if (!g) throw notFound("group_not_found", "Group not found.");
}

workspaces.patch("/:id/groups/:gid", async (c) => {
  const caller = c.get("caller");
  const id = c.req.param("id");
  const gid = c.req.param("gid");
  if (!canManageGroups(await roleIn(c, id))) throw forbidden();
  await groupIn(c, id, gid);
  const name = str((await body(c.req)).name, "name", 60);
  await commit(c, [c.env.DB.prepare("UPDATE groups SET name = ?1 WHERE id = ?2").bind(name, gid)], [auditOf(caller, id, { action: "group.renamed", targetType: "group", targetId: gid, meta: { name } })], []);
  return c.json({ ok: true });
});

workspaces.delete("/:id/groups/:gid", async (c) => {
  const caller = c.get("caller");
  const id = c.req.param("id");
  const gid = c.req.param("gid");
  if (!canManageGroups(await roleIn(c, id))) throw forbidden();
  await groupIn(c, id, gid);
  const { results } = await c.env.DB.prepare("SELECT user_id FROM group_members WHERE group_id = ?1").bind(gid).all<{ user_id: string }>();
  await commit(
    c,
    [
      c.env.DB.prepare("DELETE FROM page_permissions WHERE workspace_id = ?1 AND principal_type = 'group' AND principal_id = ?2").bind(id, gid),
      c.env.DB.prepare("DELETE FROM groups WHERE id = ?1").bind(gid),
    ],
    [auditOf(caller, id, { action: "group.deleted", targetType: "group", targetId: gid })],
    results.length ? [{ type: "access.changed", workspaceId: id, docIds: null, userIds: results.map((r) => r.user_id) }] : [],
  );
  return c.json({ ok: true });
});

/** Replace a group's members. */
workspaces.put("/:id/groups/:gid/members", async (c) => {
  const caller = c.get("caller");
  const id = c.req.param("id");
  const gid = c.req.param("gid");
  if (!canManageGroups(await roleIn(c, id))) throw forbidden();
  await groupIn(c, id, gid);
  const raw = (await body(c.req)).userIds;
  if (!Array.isArray(raw) || raw.some((u) => typeof u !== "string")) throw bad("invalid_request", "userIds must be a list of user ids");
  const userIds = [...new Set(raw as string[])];
  if (userIds.length) {
    const { results } = await c.env.DB.prepare(`SELECT user_id FROM members WHERE workspace_id = ?1 AND user_id IN (${userIds.map((_, i) => `?${i + 2}`).join(",")})`)
      .bind(id, ...userIds)
      .all<{ user_id: string }>();
    if (results.length !== userIds.length) throw bad("not_a_member", "Everyone in a group must be in the workspace.");
  }
  const { results: before } = await c.env.DB.prepare("SELECT user_id FROM group_members WHERE group_id = ?1").bind(gid).all<{ user_id: string }>();
  const prev = new Set(before.map((r) => r.user_id));
  const changed = [...new Set([...userIds.filter((u) => !prev.has(u)), ...[...prev].filter((u) => !userIds.includes(u))])];
  await commit(
    c,
    [
      c.env.DB.prepare("DELETE FROM group_members WHERE group_id = ?1").bind(gid),
      ...userIds.map((u) => c.env.DB.prepare("INSERT INTO group_members (group_id, user_id) VALUES (?1, ?2)").bind(gid, u)),
    ],
    [auditOf(caller, id, { action: "group.members_changed", targetType: "group", targetId: gid, meta: { added: userIds.filter((u) => !prev.has(u)), removed: [...prev].filter((u) => !userIds.includes(u)) } })],
    changed.length ? [{ type: "access.changed", workspaceId: id, docIds: null, userIds: changed }] : [],
  );
  return c.json({ id: gid, memberIds: userIds });
});

// ---------------------------------------------------------------------------
// Invite links
// ---------------------------------------------------------------------------

/**
 * Create an invite link. A link for a page (from its Share sheet) also gives
 * the person that page at `level`: anyone with full access to the page may
 * invite guests that way; other roles follow the workspace invite rules.
 */
workspaces.post("/:id/invites", async (c) => {
  const caller = c.get("caller");
  const id = c.req.param("id");
  const actorRole = await roleIn(c, id);
  const b = await body(c.req);
  const role = b.role ?? "member";
  if (!isRole(role)) throw bad("invalid_role");
  const pageId = optStr(b.pageId, "pageId", 64) ?? null;
  let pageLevel: Level | null = null;
  if (pageId) {
    await pageExists(c, id, pageId);
    if ((await myLevel(c, id, pageId)) !== "full") throw forbidden("forbidden", "You need full access to invite people to this page.");
    pageLevel = isLevel(b.level) ? b.level : "edit";
    if (pageLevel === "none" || (role === "guest" && pageLevel === "full")) throw bad("invalid_level", "Guests can get at most Edit.");
    if (role !== "guest" && !canInvite(actorRole, role)) throw forbidden("forbidden", "You cannot invite people with this role.");
  } else if (!canInvite(actorRole, role)) {
    throw forbidden("forbidden", "You cannot invite people with this role.");
  }
  const hours = b.expiresInHours === undefined || b.expiresInHours === null ? 168 : Number(b.expiresInHours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 720) throw bad("invalid_expiry", "Links expire after 1 hour to 30 days.");
  const maxUses = b.maxUses === undefined || b.maxUses === null ? null : Number(b.maxUses);
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1000)) throw bad("invalid_max_uses", "maxUses must be between 1 and 1000.");
  const token = randomToken("wi_", 24);
  const inviteId = newId();
  const t = now();
  const expiresAt = t + hours * 3_600_000;
  await commit(
    c,
    [
      c.env.DB.prepare(
        "INSERT INTO invites (id, workspace_id, token_hash, role, created_by, created_at, expires_at, max_uses, page_id, page_level) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
      ).bind(inviteId, id, await sha256Hex(token), role, caller.userId, t, expiresAt, maxUses, pageId, pageLevel),
    ],
    [auditOf(caller, id, { action: "invite.created", targetType: "invite", targetId: inviteId, meta: { role, expiresAt, maxUses, pageId, pageLevel } })],
    [],
  );
  const url = `${c.env.PUBLIC_URL.replace(/\/$/, "")}/join/${token}`;
  return c.json({ id: inviteId, token, url, role, expiresAt, maxUses, uses: 0, createdAt: t, pageId, level: pageLevel, active: true, revokedAt: null }, 201);
});

type InviteListRow = {
  id: string;
  role: Role;
  created_by: string;
  created_at: number;
  expires_at: number;
  max_uses: number | null;
  uses: number;
  revoked_at: number | null;
  page_id: string | null;
  page_level: string | null;
};

/** Owners and admins see every link; with ?pageId, anyone with full access sees that page's links. */
workspaces.get("/:id/invites", async (c) => {
  const id = c.req.param("id");
  const role = await roleIn(c, id);
  const pageId = c.req.query("pageId");
  if (pageId) {
    if ((await myLevel(c, id, pageId)) !== "full") throw forbidden();
  } else if (!canManageInvites(role)) {
    throw forbidden();
  }
  const { results } = await c.env.DB.prepare(
    `SELECT id, role, created_by, created_at, expires_at, max_uses, uses, revoked_at, page_id, page_level FROM invites
     WHERE workspace_id = ?1 AND (?2 IS NULL OR page_id = ?2) ORDER BY created_at DESC LIMIT 100`,
  )
    .bind(id, pageId ?? null)
    .all<InviteListRow>();
  const t = now();
  return c.json(
    results.map((i) => ({
      id: i.id,
      role: i.role,
      createdBy: i.created_by,
      createdAt: i.created_at,
      expiresAt: i.expires_at,
      maxUses: i.max_uses,
      uses: i.uses,
      revokedAt: i.revoked_at,
      pageId: i.page_id,
      level: i.page_level,
      active: !i.revoked_at && i.expires_at > t && (i.max_uses === null || i.uses < i.max_uses),
    })),
  );
});

/** Owners and admins revoke any link; whoever made a link can revoke it too. Immediate. */
workspaces.delete("/:id/invites/:inviteId", async (c) => {
  const caller = c.get("caller");
  const id = c.req.param("id");
  const inviteId = c.req.param("inviteId");
  const role = await roleIn(c, id);
  const inv = await c.env.DB.prepare("SELECT created_by FROM invites WHERE id = ?1 AND workspace_id = ?2").bind(inviteId, id).first<{ created_by: string }>();
  if (!inv) throw notFound("invite_not_found", "Invite not found.");
  if (!canManageInvites(role) && inv.created_by !== caller.userId) throw forbidden();
  const res = await commit(
    c,
    [c.env.DB.prepare("UPDATE invites SET revoked_at = ?1 WHERE id = ?2 AND workspace_id = ?3 AND revoked_at IS NULL").bind(now(), inviteId, id)],
    [auditOf(caller, id, { action: "invite.revoked", targetType: "invite", targetId: inviteId })],
    [],
  );
  if (!res[0].meta.changes) throw notFound("invite_not_found", "Invite not found or already revoked.");
  return c.json({ ok: true });
});

type InviteRow = {
  id: string;
  workspace_id: string;
  role: Role;
  expires_at: number;
  max_uses: number | null;
  uses: number;
  revoked_at: number | null;
  page_id: string | null;
  page_level: string | null;
  name: string;
};

async function inviteByToken(db: D1Database, token: string): Promise<InviteRow | null> {
  return db
    .prepare(
      "SELECT i.id, i.workspace_id, i.role, i.expires_at, i.max_uses, i.uses, i.revoked_at, i.page_id, i.page_level, w.name FROM invites i JOIN workspaces w ON w.id = i.workspace_id WHERE i.token_hash = ?1",
    )
    .bind(await sha256Hex(token))
    .first<InviteRow>();
}

function inviteProblem(i: InviteRow | null): string | null {
  if (!i) return "invite_not_found";
  if (i.revoked_at) return "invite_revoked";
  if (i.expires_at <= now()) return "invite_expired";
  if (i.max_uses !== null && i.uses >= i.max_uses) return "invite_used_up";
  return null;
}

const INVITE_MESSAGES: Record<string, string> = {
  invite_not_found: "This invite link is not valid.",
  invite_revoked: "This invite link was turned off.",
  invite_expired: "This invite link expired.",
  invite_used_up: "This invite link was already used.",
};

/** Preview an invite (no account needed). */
invites.get("/:token", async (c) => {
  await rateLimit(c.env.DB, `invite-view:ip:${clientIp(c.req.raw)}`, 60, 10 * 60 * 1000);
  const i = await inviteByToken(c.env.DB, c.req.param("token"));
  const problem = inviteProblem(i);
  if (!i || problem) return c.json({ valid: false, reason: problem, message: INVITE_MESSAGES[problem!] });
  return c.json({ valid: true, workspace: { id: i.workspace_id, name: i.name }, role: i.role, expiresAt: i.expires_at, pageLevel: i.page_level });
});

/** The page grant that comes with a page invite (never replaces an explicit entry). */
function pageGrant(c: C, i: InviteRow, userId: string): D1PreparedStatement[] {
  if (!i.page_id || !i.page_level || !isLevel(i.page_level)) return [];
  return [
    c.env.DB.prepare(
      "INSERT OR IGNORE INTO page_permissions (workspace_id, page_id, principal_type, principal_id, level, granted_by, created_at) VALUES (?1, ?2, 'user', ?3, ?4, ?5, ?6)",
    ).bind(i.workspace_id, i.page_id, userId, i.page_level, `invite:${i.id}`, now()),
  ];
}

invites.post("/:token/accept", requireAuth, async (c) => {
  const caller = c.get("caller");
  await rateLimit(c.env.DB, `invite-accept:${caller.userId}`, 30, 10 * 60 * 1000);
  const i = await inviteByToken(c.env.DB, c.req.param("token"));
  const problem = inviteProblem(i);
  if (!i || problem) throw new ApiError(410, problem!, INVITE_MESSAGES[problem!]);
  const existing = await c.env.DB.prepare("SELECT role FROM members WHERE workspace_id = ?1 AND user_id = ?2").bind(i.workspace_id, caller.userId).first<{ role: Role }>();
  if (existing) {
    const grant = pageGrant(c, i, caller.userId);
    if (grant.length) await commit(c, grant, [auditOf(caller, i.workspace_id, { action: "permission.set", targetType: "page", targetId: i.page_id, meta: { via: "invite", invite: i.id } })], []);
    return c.json({ workspace: await workspaceView(c.env.DB, i.workspace_id, existing.role), alreadyMember: true, pageId: i.page_id });
  }
  const t = now();
  // Claim one use atomically; expiry, revocation and max uses are re-checked in the same statement.
  const claim = await c.env.DB.prepare(
    "UPDATE invites SET uses = uses + 1 WHERE id = ?1 AND revoked_at IS NULL AND expires_at > ?2 AND (max_uses IS NULL OR uses < max_uses)",
  )
    .bind(i.id, t)
    .run();
  if (!claim.meta.changes) throw new ApiError(410, "invite_used_up", INVITE_MESSAGES.invite_used_up);
  await commit(
    c,
    [
      c.env.DB.prepare("INSERT OR IGNORE INTO members (workspace_id, user_id, role, joined_at, invited_by) VALUES (?1, ?2, ?3, ?4, ?5)").bind(i.workspace_id, caller.userId, i.role, t, i.id),
      ...pageGrant(c, i, caller.userId),
    ],
    [auditOf(caller, i.workspace_id, { action: "member.joined", targetType: "invite", targetId: i.id, meta: { role: i.role, pageId: i.page_id, pageLevel: i.page_level } })],
    [],
  );
  return c.json({ workspace: await workspaceView(c.env.DB, i.workspace_id, i.role), alreadyMember: false, pageId: i.page_id });
});

// ---------------------------------------------------------------------------
// Page tree mirror and permissions
// ---------------------------------------------------------------------------

/**
 * Upsert tree nodes (and remove pages that were deleted for good). Nodes not
 * mentioned are left alone, because a member may only see part of the tree.
 * Each change is checked: adding a page needs edit on its parent (Members may
 * add top-level pages), moving needs edit on the page and on the new parent,
 * removing needs full access. Unpermitted changes come back in `rejected`.
 */
workspaces.put("/:id/tree", async (c) => {
  const caller = c.get("caller");
  const id = c.req.param("id");
  const role = await roleIn(c, id);
  const b = await body(c.req);
  const nodes = Array.isArray(b.nodes) ? (b.nodes as { id?: unknown; parentId?: unknown }[]) : null;
  if (!nodes || nodes.length > 5000) throw bad("invalid_request", "nodes must be a list of at most 5000 pages");
  const removed = Array.isArray(b.removed) ? (b.removed as unknown[]).filter((x): x is string => typeof x === "string") : [];
  for (const n of nodes) {
    if (typeof n.id !== "string" || !n.id || n.id.length > 64) throw bad("invalid_request", "every node needs an id");
    if (n.parentId !== null && n.parentId !== undefined && (typeof n.parentId !== "string" || n.parentId.length > 64)) throw bad("invalid_request", "parentId must be a page id or null");
  }
  const acl = await loadAcl(c.env.DB, id);
  const subject = await loadSubject(c.env.DB, id, caller.userId);
  const level = (pageId: string | null) => (pageId ? resolve(acl, subject, pageId) : role === "guest" ? "none" : "full");
  const rejected: { id: string; reason: string }[] = [];
  const stmts: D1PreparedStatement[] = [];
  const moved: string[] = [];
  const t = now();
  // Work on a copy so cycle checks see earlier nodes in the same request.
  const next: WorkspaceAcl = { tree: new Map(acl.tree), entries: acl.entries };

  for (const n of nodes as { id: string; parentId?: string | null }[]) {
    const parentId = n.parentId ?? null;
    const cur = acl.tree.get(n.id);
    if (cur && cur.parentId === parentId) continue;
    if (parentId === n.id) {
      rejected.push({ id: n.id, reason: "cycle" });
      continue;
    }
    if (parentId && wouldCycle(next, n.id, parentId)) {
      rejected.push({ id: n.id, reason: "cycle" });
      continue;
    }
    const parentOk = atLeast(level(parentId), "edit");
    if (!cur) {
      if (!parentOk) {
        rejected.push({ id: n.id, reason: parentId ? "no_edit_on_parent" : "guests_cannot_add_top_level_pages" });
        continue;
      }
      stmts.push(c.env.DB.prepare("INSERT INTO pages (workspace_id, id, parent_id, created_by, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)").bind(id, n.id, parentId, caller.userId, t));
    } else {
      // A device that cannot see the current parent does not have it locally
      // and reports the page at the top level: that is not a move, skip it.
      if (cur.parentId && level(cur.parentId) === "none") continue;
      // Moving takes edit on the page, on where it leaves and on where it goes.
      if (!atLeast(level(n.id), "edit") || !parentOk || (cur.parentId && !atLeast(level(cur.parentId), "edit"))) {
        rejected.push({ id: n.id, reason: "no_edit" });
        continue;
      }
      stmts.push(c.env.DB.prepare("UPDATE pages SET parent_id = ?1, updated_at = ?2 WHERE workspace_id = ?3 AND id = ?4").bind(parentId, t, id, n.id));
      moved.push(n.id, ...descendants(acl, n.id));
    }
    next.tree.set(n.id, { parentId, inherit: cur?.inherit ?? true });
  }

  const removedIds: string[] = [];
  for (const r of removed) {
    if (!acl.tree.has(r)) continue;
    if (!atLeast(level(r), "full")) {
      rejected.push({ id: r, reason: "no_full_access" });
      continue;
    }
    const subtree = [r, ...descendants(acl, r)];
    removedIds.push(...subtree);
    for (const p of subtree) {
      stmts.push(c.env.DB.prepare("DELETE FROM pages WHERE workspace_id = ?1 AND id = ?2").bind(id, p));
      stmts.push(c.env.DB.prepare("DELETE FROM page_permissions WHERE workspace_id = ?1 AND page_id = ?2").bind(id, p));
    }
  }

  if (stmts.length) {
    const events: AccessEvent[] = [];
    const affected = [...new Set([...moved, ...removedIds])];
    if (affected.length) events.push({ type: "access.changed", workspaceId: id, docIds: affected, userIds: null });
    await commit(
      c,
      stmts,
      moved.length || removedIds.length ? [auditOf(caller, id, { action: "tree.changed", targetType: "workspace", targetId: id, meta: { moved: [...new Set(moved)].slice(0, 50), removed: removedIds.slice(0, 50) } })] : [],
      events,
    );
  }
  return c.json({ applied: stmts.length > 0, rejected });
});

/**
 * The caller's level on every mirrored page, "none" included, so the app can
 * cache its rights and enforce them offline (a missing entry would otherwise
 * fall back to the parent's level).
 */
workspaces.get("/:id/access", async (c) => {
  const id = c.req.param("id");
  const role = await roleIn(c, id);
  const w = await workspaceView(c.env.DB, id, role);
  const acl = await loadAcl(c.env.DB, id);
  const subject = await loadSubject(c.env.DB, id, c.get("caller").userId);
  const docs = [...acl.tree.keys()].map((docId) => ({ docId, level: resolve(acl, subject, docId) }));
  return c.json({ role, defaultLevel: w.defaultLevel, docs });
});

/** True when making `parentId` the parent of `id` would put `id` above itself. */
function wouldCycle(acl: WorkspaceAcl, id: string, parentId: string): boolean {
  const seen = new Set<string>();
  let cur: string | null = parentId;
  while (cur && !seen.has(cur)) {
    if (cur === id) return true;
    seen.add(cur);
    cur = acl.tree.get(cur)?.parentId ?? null;
  }
  return false;
}

async function pageExists(c: C, workspaceId: string, pageId: string): Promise<void> {
  const p = await c.env.DB.prepare("SELECT id FROM pages WHERE workspace_id = ?1 AND id = ?2").bind(workspaceId, pageId).first();
  if (!p) throw notFound("page_not_found", "This page has not reached the workspace yet. Try again in a moment.");
}

workspaces.get("/:id/pages/:pageId/permissions", async (c) => {
  const id = c.req.param("id");
  const pageId = c.req.param("pageId");
  await roleIn(c, id);
  const acl = await loadAcl(c.env.DB, id);
  const mine = await myLevel(c, id, pageId, acl);
  if (mine === "none") throw notFound("page_not_found", "Page not found.");
  const { chain } = chainOf(acl, pageId);
  const seen = new Set<string>();
  const entries: { principalType: string; principalId: string; level: Level; pageId: string; inherited: boolean }[] = [];
  for (const p of chain) {
    for (const e of acl.entries.get(p) ?? []) {
      const key = `${e.principalType}:${e.principalId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ ...e, pageId: p, inherited: p !== pageId });
    }
  }
  const node = acl.tree.get(pageId);
  return c.json({ pageId, myLevel: mine, inherit: node?.inherit ?? true, mirrored: !!node, entries });
});

async function principalValid(c: C, workspaceId: string, type: string, principalId: string, level: Level): Promise<void> {
  if (type === "workspace") {
    if (principalId !== "*") throw bad("invalid_principal", "The workspace principal id is *");
    return;
  }
  if (type === "group") {
    await groupIn(c, workspaceId, principalId);
    return;
  }
  if (type === "user") {
    const m = await c.env.DB.prepare("SELECT role FROM members WHERE workspace_id = ?1 AND user_id = ?2").bind(workspaceId, principalId).first<{ role: Role }>();
    if (!m) throw bad("not_a_member", "Invite this person to the workspace first.");
    if (m.role === "guest" && level === "full") throw bad("invalid_level", "Guests can get at most Edit.");
    return;
  }
  throw bad("invalid_principal", "principalType must be user, group or workspace");
}

async function affectedUsers(c: C, type: string, principalId: string): Promise<string[] | null> {
  if (type === "user") return [principalId];
  if (type === "group") {
    const { results } = await c.env.DB.prepare("SELECT user_id FROM group_members WHERE group_id = ?1").bind(principalId).all<{ user_id: string }>();
    return results.map((r) => r.user_id);
  }
  return null;
}

/** Set one entry on a page. Needs full access to the page. */
workspaces.put("/:id/pages/:pageId/permissions", async (c) => {
  const caller = c.get("caller");
  const id = c.req.param("id");
  const pageId = c.req.param("pageId");
  await roleIn(c, id);
  await pageExists(c, id, pageId);
  const acl = await loadAcl(c.env.DB, id);
  if ((await myLevel(c, id, pageId, acl)) !== "full") throw forbidden("forbidden", "You need full access to share this page.");
  const b = await body(c.req);
  const type = str(b.principalType, "principalType", 20);
  const principalId = str(b.principalId, "principalId", 64);
  if (!isLevel(b.level)) throw bad("invalid_level", "level must be full, edit, comment, view or none");
  const level = b.level;
  await principalValid(c, id, type, principalId, level);
  await commit(
    c,
    [
      c.env.DB.prepare(
        `INSERT INTO page_permissions (workspace_id, page_id, principal_type, principal_id, level, granted_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(workspace_id, page_id, principal_type, principal_id) DO UPDATE SET level = excluded.level, granted_by = excluded.granted_by, created_at = excluded.created_at`,
      ).bind(id, pageId, type, principalId, level, caller.userId, now()),
    ],
    [auditOf(caller, id, { action: "permission.set", targetType: "page", targetId: pageId, meta: { principalType: type, principalId, level } })],
    [{ type: "access.changed", workspaceId: id, docIds: [pageId, ...descendants(acl, pageId)], userIds: await affectedUsers(c, type, principalId) }],
  );
  return c.json({ ok: true });
});

workspaces.delete("/:id/pages/:pageId/permissions/:type/:principalId", async (c) => {
  const caller = c.get("caller");
  const id = c.req.param("id");
  const pageId = c.req.param("pageId");
  const type = c.req.param("type");
  const principalId = c.req.param("principalId");
  await roleIn(c, id);
  const acl = await loadAcl(c.env.DB, id);
  if ((await myLevel(c, id, pageId, acl)) !== "full") throw forbidden("forbidden", "You need full access to change sharing.");
  const res = await commit(
    c,
    [c.env.DB.prepare("DELETE FROM page_permissions WHERE workspace_id = ?1 AND page_id = ?2 AND principal_type = ?3 AND principal_id = ?4").bind(id, pageId, type, principalId)],
    [auditOf(caller, id, { action: "permission.removed", targetType: "page", targetId: pageId, meta: { principalType: type, principalId } })],
    [{ type: "access.changed", workspaceId: id, docIds: [pageId, ...descendants(acl, pageId)], userIds: await affectedUsers(c, type, principalId) }],
  );
  if (!res[0].meta.changes) throw notFound("permission_not_found");
  return c.json({ ok: true });
});

/** Stop (or resume) inheriting permissions from parent pages. */
workspaces.patch("/:id/pages/:pageId", async (c) => {
  const caller = c.get("caller");
  const id = c.req.param("id");
  const pageId = c.req.param("pageId");
  await roleIn(c, id);
  await pageExists(c, id, pageId);
  const acl = await loadAcl(c.env.DB, id);
  if ((await myLevel(c, id, pageId, acl)) !== "full") throw forbidden("forbidden", "You need full access to change sharing.");
  const inherit = (await body(c.req)).inherit;
  if (typeof inherit !== "boolean") throw bad("invalid_request", "inherit must be true or false");
  const stmts = [c.env.DB.prepare("UPDATE pages SET inherit = ?1, updated_at = ?2 WHERE workspace_id = ?3 AND id = ?4").bind(inherit ? 1 : 0, now(), id, pageId)];
  // Restricting a page keeps the person doing it in: they get an explicit full entry.
  if (!inherit)
    stmts.push(
      c.env.DB.prepare(
        "INSERT OR IGNORE INTO page_permissions (workspace_id, page_id, principal_type, principal_id, level, granted_by, created_at) VALUES (?1, ?2, 'user', ?3, 'full', ?3, ?4)",
      ).bind(id, pageId, caller.userId, now()),
    );
  await commit(
    c,
    stmts,
    [auditOf(caller, id, { action: inherit ? "page.inherit_restored" : "page.restricted", targetType: "page", targetId: pageId })],
    [{ type: "access.changed", workspaceId: id, docIds: [pageId, ...descendants(acl, pageId)], userIds: null }],
  );
  return c.json({ ok: true, inherit });
});

workspaces.get("/:id/audit", async (c) => {
  const id = c.req.param("id");
  if (!canReadAudit(await roleIn(c, id))) throw forbidden("forbidden", "Only owners and admins can read the audit log.");
  const limit = Number(c.req.query("limit") ?? 100);
  const before = c.req.query("before") ? Number(c.req.query("before")) : undefined;
  return c.json(await listAudit(c.env.DB, { workspaceId: id }, limit, before));
});
