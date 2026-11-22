/**
 * Public content and the reports about it (docs/admin/PLAN.md, phase 4).
 */
import type { Env } from "../env";
import { auditStmt } from "./audit";
import { now } from "./crypto";

export type Target = { type: "profile"; username: string } | { type: "page"; username: string; slug: string } | { type: "share"; slug: string };

/** What a reported link points at: profile.<domain>/@name, /@name/<slug>, or /s/<slug>. */
export function targetOf(link: string | undefined | null): Target | null {
  if (!link) return null;
  let path: string;
  try {
    path = decodeURIComponent(new URL(link.trim()).pathname);
  } catch {
    path = link.trim();
  }
  const page = /\/@([a-z0-9._]{3,20})\/([a-z0-9][a-z0-9-]{0,63})\/?$/i.exec(path);
  if (page) return { type: "page", username: page[1].toLowerCase(), slug: page[2].toLowerCase() };
  const profile = /\/@([a-z0-9._]{3,20})\/?$/i.exec(path) ?? /^@([a-z0-9._]{3,20})$/i.exec(path);
  if (profile) return { type: "profile", username: profile[1].toLowerCase() };
  const share = /\/s\/([a-z0-9]{6,64})\/?$/i.exec(path);
  if (share) return { type: "share", slug: share[1].toLowerCase() };
  return null;
}

export const targetKey = (t: Target) => (t.type === "share" ? `share:${t.slug}` : t.type === "page" ? `page:${t.username}/${t.slug}` : `profile:${t.username}`);

/** How many different people have open reports about this content. */
export async function reportersOf(db: D1Database, target: Target): Promise<number> {
  const { results } = await db.prepare("SELECT email, fields FROM support_tickets WHERE kind = 'report' AND status NOT IN ('solved', 'closed')").all<{ email: string; fields: string }>();
  const key = targetKey(target);
  const people = new Set<string>();
  for (const r of results) {
    let link: string | undefined;
    try {
      link = (JSON.parse(r.fields) as { link?: string }).link;
    } catch {
      continue;
    }
    const t = targetOf(link);
    if (t && targetKey(t) === key) people.add(r.email);
  }
  return people.size;
}

/** Hide or show reported content. Returns false when there is no such content. */
export async function setTeamHidden(db: D1Database, target: Target, hidden: boolean, reason: string | null): Promise<{ ownerId: string; title: string } | null> {
  if (target.type === "profile") {
    const row = await db.prepare("SELECT p.user_id FROM public_profiles p JOIN users u ON u.id = p.user_id WHERE u.username = ?1").bind(target.username).first<{ user_id: string }>();
    if (!row) return null;
    await db.prepare("UPDATE public_profiles SET team_hidden = ?1, team_reason = ?2 WHERE user_id = ?3").bind(hidden ? 1 : 0, hidden ? reason : null, row.user_id).run();
    return { ownerId: row.user_id, title: `@${target.username}` };
  }
  const row =
    target.type === "page"
      ? await db.prepare("SELECT p.id, p.user_id, p.title FROM published_pages p JOIN users u ON u.id = p.user_id WHERE u.username = ?1 AND p.slug = ?2 AND p.kind = 'page'").bind(target.username, target.slug).first<{ id: string; user_id: string; title: string }>()
      : await db.prepare("SELECT id, user_id, title FROM published_pages WHERE slug = ?1 AND kind = 'share'").bind(target.slug).first<{ id: string; user_id: string; title: string }>();
  if (!row) return null;
  await db.prepare("UPDATE published_pages SET team_hidden = ?1, team_reason = ?2 WHERE id = ?3").bind(hidden ? 1 : 0, hidden ? reason : null, row.id).run();
  return { ownerId: row.user_id, title: row.title };
}

/** After a new report: three different people reporting the same content hide it until the team looks. */
export const AUTO_HIDE_AT = 3;
export async function autoHideOnReports(env: Env, link: string | undefined): Promise<boolean> {
  const target = targetOf(link);
  if (!target) return false;
  if ((await reportersOf(env.DB, target)) < AUTO_HIDE_AT) return false;
  const hit = await setTeamHidden(env.DB, target, true, "reports");
  if (!hit) return false;
  await auditStmt(env.DB, { action: "content.hidden_by_reports", actorUserId: null, actorKind: "system", targetType: "user", targetId: hit.ownerId, meta: { content: targetKey(target), at: now() } }).run();
  return true;
}
