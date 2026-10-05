import { isLevel, maxLevel, type Level, type Role } from "./roles";

/**
 * Page permission resolution.
 *
 * Inputs: the workspace page tree (id, parent, inherit flag) and the explicit
 * entries on pages, each for a user, a group, or the whole workspace ('*').
 *
 *   1. Not a member: none. Owner and Admin: full on every page.
 *   2. Walk from the page up to the root. A page with inherit = 0 is the last
 *      one considered (entries above it do not apply).
 *   3. The nearest entry for the user themself wins outright (it may lower
 *      access as well as raise it).
 *   4. Otherwise take the highest of: the nearest entry for each of the user's
 *      groups, and (Members only) the nearest workspace-wide entry, falling
 *      back to the workspace default level when the walk reached the root
 *      without a restriction.
 *   5. Guests only ever get what is shared with them or their groups.
 *
 * Pages not in the mirrored tree resolve as top-level pages.
 */

export interface TreeNode {
  parentId: string | null;
  inherit: boolean;
}

export interface Entry {
  principalType: "user" | "group" | "workspace";
  principalId: string;
  level: Level;
}

export interface Subject {
  userId: string;
  role: Role | null;
  groupIds: Set<string>;
  defaultLevel: Level;
}

export interface WorkspaceAcl {
  tree: Map<string, TreeNode>;
  entries: Map<string, Entry[]>;
}

/** Page ids from the page up to the last one that inherits (cycle safe). */
export function chainOf(acl: WorkspaceAcl, pageId: string): { chain: string[]; reachedRoot: boolean } {
  const chain: string[] = [];
  const seen = new Set<string>();
  let cur: string | null = pageId;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    chain.push(cur);
    const node = acl.tree.get(cur);
    if (!node) return { chain, reachedRoot: true };
    if (!node.inherit) return { chain, reachedRoot: false };
    cur = node.parentId;
  }
  return { chain, reachedRoot: cur === null };
}

export function resolve(acl: WorkspaceAcl, s: Subject, pageId: string): Level {
  if (!s.role) return "none";
  if (s.role === "owner" || s.role === "admin") return "full";
  const { chain, reachedRoot } = chainOf(acl, pageId);
  const nearest = (match: (e: Entry) => boolean): Level | null => {
    for (const id of chain) {
      const e = acl.entries.get(id)?.find(match);
      if (e) return e.level;
    }
    return null;
  };
  const own = nearest((e) => e.principalType === "user" && e.principalId === s.userId);
  if (own) return own;
  const candidates: Level[] = [];
  for (const g of s.groupIds) {
    const l = nearest((e) => e.principalType === "group" && e.principalId === g);
    if (l) candidates.push(l);
  }
  if (s.role === "member") {
    const everyone = nearest((e) => e.principalType === "workspace");
    if (everyone) candidates.push(everyone);
    else if (reachedRoot) candidates.push(s.defaultLevel);
  }
  return maxLevel(candidates);
}

// ---------------------------------------------------------------------------
// Loading from D1
// ---------------------------------------------------------------------------

export async function loadAcl(db: D1Database, workspaceId: string): Promise<WorkspaceAcl> {
  const [pages, perms] = await db.batch([
    db.prepare("SELECT id, parent_id, inherit FROM pages WHERE workspace_id = ?1").bind(workspaceId),
    db.prepare("SELECT page_id, principal_type, principal_id, level FROM page_permissions WHERE workspace_id = ?1").bind(workspaceId),
  ]);
  const tree = new Map<string, TreeNode>();
  for (const r of pages.results as { id: string; parent_id: string | null; inherit: number }[]) {
    tree.set(r.id, { parentId: r.parent_id, inherit: r.inherit !== 0 });
  }
  const entries = new Map<string, Entry[]>();
  for (const r of perms.results as { page_id: string; principal_type: Entry["principalType"]; principal_id: string; level: string }[]) {
    if (!isLevel(r.level)) continue;
    const list = entries.get(r.page_id) ?? [];
    list.push({ principalType: r.principal_type, principalId: r.principal_id, level: r.level });
    entries.set(r.page_id, list);
  }
  return { tree, entries };
}

export async function loadSubject(db: D1Database, workspaceId: string, userId: string): Promise<Subject> {
  const [m, g] = await db.batch([
    db
      .prepare("SELECT m.role, w.default_level FROM members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.workspace_id = ?1 AND m.user_id = ?2")
      .bind(workspaceId, userId),
    db
      .prepare("SELECT gm.group_id FROM group_members gm JOIN groups g ON g.id = gm.group_id WHERE g.workspace_id = ?1 AND gm.user_id = ?2")
      .bind(workspaceId, userId),
  ]);
  const row = (m.results as { role: Role; default_level: string }[])[0];
  return {
    userId,
    role: row?.role ?? null,
    defaultLevel: row && isLevel(row.default_level) ? row.default_level : "edit",
    groupIds: new Set((g.results as { group_id: string }[]).map((r) => r.group_id)),
  };
}

/** The Service Binding contract: one page. */
export async function checkAccess(db: D1Database, args: { userId: string; workspaceId: string; docId: string }): Promise<{ level: Level }> {
  const subject = await loadSubject(db, args.workspaceId, args.userId);
  if (!subject.role) return { level: "none" };
  const acl = await loadAcl(db, args.workspaceId);
  return { level: resolve(acl, subject, args.docId) };
}

/** The Service Binding contract: every mirrored page the user can at least view. */
export async function listDocs(db: D1Database, args: { userId: string; workspaceId: string }): Promise<{ docId: string; level: Level }[]> {
  const subject = await loadSubject(db, args.workspaceId, args.userId);
  if (!subject.role) return [];
  const acl = await loadAcl(db, args.workspaceId);
  const out: { docId: string; level: Level }[] = [];
  for (const id of acl.tree.keys()) {
    const level = resolve(acl, subject, id);
    if (level !== "none") out.push({ docId: id, level });
  }
  return out;
}

/** All descendants of a page (excluding itself), cycle safe. */
export function descendants(acl: WorkspaceAcl, pageId: string): string[] {
  const children = new Map<string, string[]>();
  for (const [id, n] of acl.tree) {
    if (!n.parentId) continue;
    const list = children.get(n.parentId) ?? [];
    list.push(id);
    children.set(n.parentId, list);
  }
  const out: string[] = [];
  const seen = new Set<string>([pageId]);
  const stack = [...(children.get(pageId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    stack.push(...(children.get(id) ?? []));
  }
  return out;
}
