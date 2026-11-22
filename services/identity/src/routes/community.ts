/**
 * Suggestions and votes, the public roadmap, testers, surveys, and messages
 * from the team (docs/admin/PLAN.md, phase 5). The team's side is in
 * routes/admin.ts.
 *
 *   /community/suggestions  the public board (approved ideas) and new ideas
 *   /community/roadmap      approved ideas by stage
 *   /me/testers             apply, see the answer, leave
 *   /me/surveys             a short question in the app, and its answer
 *   /me/messages            conversations the team started
 */
import { Hono, type Context } from "hono";
import type { AppEnv, Env } from "../env";
import { callerFromToken, emit, requireAuth } from "../lib/auth";
import { newId, now } from "../lib/crypto";
import { bad, body, conflict, normalizeEmail, notFound, optStr, str } from "../lib/http";
import { bannedWordIn } from "../lib/names";
import { clientIp, rateLimit } from "../lib/ratelimit";
import { notifyTeam, requester, safeJson } from "./support";

export const SUGGESTION_STATUSES = ["new", "planned", "working", "shipped", "declined", "duplicate"] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

export interface SuggestionRow {
  id: string;
  number: number;
  user_id: string | null;
  email: string | null;
  title: string;
  body: string;
  lang: string;
  status: SuggestionStatus;
  public: number;
  shipped_in: string | null;
  merged_into: string | null;
  team_note: string | null;
  created_at: number;
  updated_at: number;
  votes?: number;
  mine?: number;
}

export function suggestionView(s: SuggestionRow) {
  return {
    id: s.id,
    number: s.number,
    title: s.title,
    body: s.body,
    lang: s.lang,
    status: s.status,
    shippedIn: s.shipped_in,
    teamNote: s.team_note,
    votes: s.votes ?? 0,
    voted: !!s.mine,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  };
}

/** Who is voting: a signed-in account or a confirmed support email; null for anyone else. */
async function voterOf(c: Context<AppEnv>): Promise<string | null> {
  const h = c.req.header("authorization");
  if (h?.startsWith("Bearer ")) {
    const caller = await callerFromToken(c, h.slice(7).trim());
    return caller ? `u:${caller.userId}` : null;
  }
  if (c.req.header("x-support-session")) {
    const r = await requester(c, false);
    return r ? (r.userId ? `u:${r.userId}` : `e:${r.email}`) : null;
  }
  return null;
}

const VOTES = "(SELECT COUNT(*) FROM suggestion_votes v WHERE v.suggestion_id = s.id)";

export async function newSuggestion(env: Env, s: { userId: string | null; email: string | null; title: string; body: string; lang: string }): Promise<SuggestionRow> {
  const id = newId();
  const t = now();
  for (let attempt = 0; attempt < 5; attempt++) {
    const next = await env.DB.prepare("SELECT COALESCE(MAX(number), 100) + 1 AS n FROM suggestions").first<{ n: number }>();
    try {
      await env.DB.prepare("INSERT INTO suggestions (id, number, user_id, email, title, body, lang, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)")
        .bind(id, next!.n, s.userId, s.email, s.title, s.body, s.lang, t)
        .run();
      // The person who suggests it is its first vote.
      await env.DB.prepare("INSERT OR IGNORE INTO suggestion_votes (suggestion_id, voter, created_at) VALUES (?1, ?2, ?3)")
        .bind(id, s.userId ? `u:${s.userId}` : `e:${s.email}`, t)
        .run();
      return (await env.DB.prepare("SELECT * FROM suggestions WHERE id = ?1").bind(id).first<SuggestionRow>())!;
    } catch (e) {
      if (!/UNIQUE/i.test(String(e))) throw e;
    }
  }
  throw bad("busy", "Try again.");
}

export const community = new Hono<AppEnv>();

community.get("/suggestions", async (c) => {
  await rateLimit(c.env.DB, `ideas:${clientIp(c.req.raw, c.env.EDGE_SECRET)}`, 300, 60_000);
  const voter = await voterOf(c).catch(() => null);
  const sort = c.req.query("sort") === "new" ? "s.created_at DESC" : `${VOTES} DESC, s.updated_at DESC`;
  const status = c.req.query("status");
  const where = ["s.public = 1", "s.status NOT IN ('declined', 'duplicate')"];
  const args: unknown[] = [voter ?? ""];
  if (status && SUGGESTION_STATUSES.includes(status as SuggestionStatus)) {
    args.push(status);
    where.push(`s.status = ?${args.length}`);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT s.*, ${VOTES} AS votes, EXISTS(SELECT 1 FROM suggestion_votes v WHERE v.suggestion_id = s.id AND v.voter = ?1) AS mine
     FROM suggestions s WHERE ${where.join(" AND ")} ORDER BY ${sort} LIMIT 200`,
  )
    .bind(...args)
    .all<SuggestionRow>();
  return c.json(results.map(suggestionView), 200, { "cache-control": voter ? "private, no-store" : "public, max-age=60" });
});

/** While sign-up is by invitation, people leave their email to get a code later. */
community.post("/waitlist", async (c) => {
  await rateLimit(c.env.DB, `waitlist:${clientIp(c.req.raw, c.env.EDGE_SECRET)}`, 10, 3_600_000);
  const b = await body(c.req);
  const email = normalizeEmail(b.email);
  await c.env.DB.prepare("INSERT OR IGNORE INTO waitlist (email, lang, created_at) VALUES (?1, ?2, ?3)").bind(email, b.lang === "en" ? "en" : "ar", now()).run();
  return c.json({ ok: true });
});

community.get("/roadmap", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT s.*, ${VOTES} AS votes FROM suggestions s WHERE s.public = 1 AND s.status IN ('planned', 'working', 'shipped') ORDER BY s.updated_at DESC LIMIT 300`,
  ).all<SuggestionRow>();
  const by = (st: SuggestionStatus) => results.filter((r) => r.status === st).map(suggestionView);
  return c.json({ planned: by("planned"), working: by("working"), shipped: by("shipped") }, 200, { "cache-control": "public, max-age=120" });
});

/** A new idea, from the app (signed in) or the support site (a confirmed email). */
community.post("/suggestions", async (c) => {
  const r = (await requester(c))!;
  await rateLimit(c.env.DB, `idea-new:${r.email}`, 10, 86_400_000);
  const b = await body(c.req);
  const title = str(b.title, "title", 140);
  const text = optStr(b.body, "body", 4000) ?? "";
  if (await bannedWordIn(c.env.DB, `${title} ${text}`)) throw bad("name_not_allowed", "The idea has a word that is not allowed.");
  const s = await newSuggestion(c.env, { userId: r.userId, email: r.userId ? null : r.email, title, body: text, lang: b.lang === "en" ? "en" : "ar" });
  emit(c, await notifyTeam(c.env, { id: `idea:${s.id}`, topic: "suggestion.new", title: `#${s.number} · ${title}`, excerpt: text || title, link: "https://admin.enterworlds.space/#/community" }));
  return c.json(suggestionView({ ...s, votes: 1, mine: 1 }), 201);
});

community.post("/suggestions/:id/vote", async (c) => {
  const voter = await voterOf(c);
  if (!voter) throw bad("sign_in_to_vote", "Sign in or confirm your email to vote.");
  const s = await c.env.DB.prepare("SELECT id FROM suggestions WHERE id = ?1 AND public = 1").bind(c.req.param("id")).first();
  if (!s) throw notFound();
  const b = await body(c.req).catch(() => ({}) as Record<string, unknown>);
  if (b.vote === false) await c.env.DB.prepare("DELETE FROM suggestion_votes WHERE suggestion_id = ?1 AND voter = ?2").bind(c.req.param("id"), voter).run();
  else await c.env.DB.prepare("INSERT OR IGNORE INTO suggestion_votes (suggestion_id, voter, created_at) VALUES (?1, ?2, ?3)").bind(c.req.param("id"), voter, now()).run();
  const n = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM suggestion_votes WHERE suggestion_id = ?1").bind(c.req.param("id")).first<{ n: number }>();
  return c.json({ votes: n?.n ?? 0, voted: b.vote !== false });
});

// ---------------------------------------------------------------------------
// The signed-in person: testers, surveys, messages from the team
// ---------------------------------------------------------------------------

export const mine = new Hono<AppEnv>();
mine.use("*", requireAuth);

mine.get("/testers", async (c) => {
  const row = await c.env.DB.prepare("SELECT status, platforms, applied_at, decided_at FROM testers WHERE user_id = ?1").bind(c.get("caller").userId).first<{
    status: string;
    platforms: string;
    applied_at: number;
    decided_at: number | null;
  }>();
  return c.json(row ? { status: row.status, platforms: safeJson<string[]>(row.platforms, []), appliedAt: row.applied_at, decidedAt: row.decided_at } : { status: null });
});

mine.post("/testers", async (c) => {
  const userId = c.get("caller").userId;
  const b = await body(c.req);
  const platforms = Array.isArray(b.platforms) ? b.platforms.filter((p): p is string => typeof p === "string").slice(0, 8).map((p) => p.slice(0, 20)) : [];
  const old = await c.env.DB.prepare("SELECT status FROM testers WHERE user_id = ?1").bind(userId).first<{ status: string }>();
  if (old?.status === "accepted") return c.json({ status: "accepted" });
  await c.env.DB.prepare(
    "INSERT INTO testers (user_id, status, platforms, note, applied_at) VALUES (?1, 'applied', ?2, ?3, ?4) ON CONFLICT(user_id) DO UPDATE SET status = 'applied', platforms = ?2, note = ?3, applied_at = ?4, decided_at = NULL",
  )
    .bind(userId, JSON.stringify(platforms), optStr(b.note, "note", 500) ?? null, now())
    .run();
  emit(c, await notifyTeam(c.env, { id: `tester:${userId}:${now()}`, topic: "testers.applied", title: "Tester", excerpt: platforms.join(", ") || "-", link: "https://admin.enterworlds.space/#/community" }));
  return c.json({ status: "applied" }, 201);
});

mine.delete("/testers", async (c) => {
  await c.env.DB.prepare("DELETE FROM testers WHERE user_id = ?1").bind(c.get("caller").userId).run();
  return c.json({ ok: true });
});

/** Surveys this person has not answered yet. */
mine.get("/surveys", async (c) => {
  const userId = c.get("caller").userId;
  const tester = await c.env.DB.prepare("SELECT 1 FROM testers WHERE user_id = ?1 AND status = 'accepted'").bind(userId).first();
  const { results } = await c.env.DB.prepare(
    `SELECT s.* FROM surveys s WHERE s.active = 1 AND (s.ends_at IS NULL OR s.ends_at > ?1) AND (s.audience = 'all' OR (s.audience = 'testers' AND ?3 = 1))
       AND NOT EXISTS (SELECT 1 FROM survey_answers a WHERE a.survey_id = s.id AND a.user_id = ?2) ORDER BY s.created_at DESC LIMIT 3`,
  )
    .bind(now(), userId, tester ? 1 : 0)
    .all<{ id: string; question_ar: string; question_en: string; choices: string; audience: string }>();
  return c.json(results.map((s) => ({ id: s.id, question: { ar: s.question_ar, en: s.question_en }, choices: safeJson<{ ar: string; en: string }[]>(s.choices, []) })));
});

mine.post("/surveys/:id", async (c) => {
  const userId = c.get("caller").userId;
  const s = await c.env.DB.prepare("SELECT choices FROM surveys WHERE id = ?1 AND active = 1").bind(c.req.param("id")).first<{ choices: string }>();
  if (!s) throw notFound();
  const b = await body(c.req);
  const choices = safeJson<unknown[]>(s.choices, []);
  let choice: number | null = null;
  let text: string | null = null;
  if (choices.length) {
    if (!Number.isInteger(b.choice) || (b.choice as number) < 0 || (b.choice as number) >= choices.length) throw bad("invalid_choice");
    choice = b.choice as number;
  } else text = str(b.text, "text", 1000);
  try {
    await c.env.DB.prepare("INSERT INTO survey_answers (survey_id, user_id, choice, text, created_at) VALUES (?1, ?2, ?3, ?4, ?5)").bind(c.req.param("id"), userId, choice, text, now()).run();
  } catch {
    throw conflict("answered", "You already answered.");
  }
  return c.json({ ok: true });
});

mine.get("/messages", async (c) => {
  const userId = c.get("caller").userId;
  const { results: threads } = await c.env.DB.prepare("SELECT id, subject, status, created_at, updated_at FROM team_threads WHERE user_id = ?1 ORDER BY updated_at DESC LIMIT 50")
    .bind(userId)
    .all<{ id: string; subject: string; status: string; created_at: number; updated_at: number }>();
  const out = [];
  for (const t of threads) {
    const { results } = await c.env.DB.prepare("SELECT id, author, body, created_at, read_at FROM team_messages WHERE thread_id = ?1 ORDER BY created_at")
      .bind(t.id)
      .all<{ id: string; author: string; body: string; created_at: number; read_at: number | null }>();
    out.push({ id: t.id, subject: t.subject, status: t.status, createdAt: t.created_at, updatedAt: t.updated_at, messages: results.map((m) => ({ id: m.id, author: m.author, body: m.body, createdAt: m.created_at, read: !!m.read_at || m.author === "person" })) });
  }
  // Reading the list marks the team's messages as read.
  await c.env.DB.prepare("UPDATE team_messages SET read_at = ?1 WHERE read_at IS NULL AND author = 'team' AND thread_id IN (SELECT id FROM team_threads WHERE user_id = ?2)").bind(now(), userId).run();
  return c.json(out);
});

mine.post("/messages/:id", async (c) => {
  const userId = c.get("caller").userId;
  await rateLimit(c.env.DB, `dm:${userId}`, 60, 3_600_000);
  const t = await c.env.DB.prepare("SELECT id, subject, status FROM team_threads WHERE id = ?1 AND user_id = ?2").bind(c.req.param("id"), userId).first<{ id: string; subject: string; status: string }>();
  if (!t) throw notFound();
  if (t.status === "closed") throw conflict("closed", "This conversation is closed.");
  const text = str((await body(c.req)).body, "body", 4000);
  const id = newId();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO team_messages (id, thread_id, author, author_id, body, created_at) VALUES (?1, ?2, 'person', ?3, ?4, ?5)").bind(id, t.id, userId, text, now()),
    c.env.DB.prepare("UPDATE team_threads SET updated_at = ?1 WHERE id = ?2").bind(now(), t.id),
  ]);
  emit(c, await notifyTeam(c.env, { id: `dm:${id}`, topic: "messages.reply", title: t.subject, excerpt: text, link: "https://admin.enterworlds.space/#/community" }));
  return c.json({ id }, 201);
});
