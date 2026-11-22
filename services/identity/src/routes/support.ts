/**
 * Support requests (support.enterworlds.space and support@enterworlds.space).
 *
 * Anyone may ask, with or without a Worlds account: they confirm their email
 * with a code (the same codes as sign-in) and get a support session for "My
 * requests". Signed-in people may use their access token instead. A request
 * made with an email that belongs to an account is linked to that account.
 * The team answers from the dashboard (routes/admin.ts); each answer goes out
 * from support@ and, for account holders, into the app's notifications.
 */
import { Hono, type Context } from "hono";
import type { AppEnv, Env } from "../env";
import { callerFromToken } from "../lib/auth";
import { b64urlEncode, newId, now, randomToken, sha256Hex } from "../lib/crypto";
import { deliver, eventStmt, type EventEnvelope } from "../lib/events";
import { ApiError, bad, body, notFound, optStr, str, unauthorized } from "../lib/http";
import { clientIp, rateLimit } from "../lib/ratelimit";
import { freshPart, replyAddress, sendSupportMail, supportMail, ticketRef } from "../lib/supportMail";
import { consumeEmailCode } from "./auth";

export const KINDS = ["problem", "account", "recovery", "deletion", "report", "security", "suggestion", "other"] as const;
export type Kind = (typeof KINDS)[number];
export const STATUSES = ["open", "waiting", "working", "solved", "closed"] as const;
export type TicketStatus = (typeof STATUSES)[number];

const SESSION_DAYS = 30;
const MAX_FILE = 10 * 1024 * 1024;
const FILE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const HOUR = 3_600_000;

export interface TicketRow {
  id: string;
  number: number;
  user_id: string | null;
  email: string;
  name: string | null;
  kind: Kind;
  subject: string;
  fields: string;
  lang: string;
  status: TicketStatus;
  priority: string;
  assignee_id: string | null;
  tags: string;
  private: number;
  reply_key: string;
  rating: number | null;
  via: string;
  created_at: number;
  updated_at: number;
  first_reply_at: number | null;
  closed_at: number | null;
}

export interface MessageRow {
  id: string;
  ticket_id: string;
  author: "person" | "team" | "note" | "system";
  author_id: string | null;
  body: string;
  files: string;
  via: string;
  created_at: number;
}

export function ticketView(t: TicketRow) {
  return {
    id: t.id,
    number: t.number,
    ref: ticketRef(t.number),
    kind: t.kind,
    subject: t.subject,
    fields: safeJson<Record<string, string>>(t.fields, {}),
    lang: t.lang,
    status: t.status,
    rating: t.rating,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    closedAt: t.closed_at,
  };
}

export function messageView(m: MessageRow, authorName?: string | null) {
  return { id: m.id, author: m.author, authorName: authorName ?? null, body: m.body, files: safeJson<string[]>(m.files, []), via: m.via, createdAt: m.created_at };
}

export function safeJson<T>(s: string | null | undefined, fallback: T): T {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Who is asking
// ---------------------------------------------------------------------------

interface Requester {
  email: string;
  userId: string | null;
}

async function userIdForEmail(db: D1Database, email: string): Promise<string | null> {
  return (await db.prepare("SELECT id FROM users WHERE email = ?1").bind(email).first<{ id: string }>())?.id ?? null;
}

async function requester(c: Context<AppEnv>, required = true): Promise<Requester | null> {
  const h = c.req.header("authorization");
  if (h?.startsWith("Bearer ")) {
    const caller = await callerFromToken(c, h.slice(7).trim());
    if (!caller) throw unauthorized("invalid_token", "Your session ended. Sign in again.");
    const u = await c.env.DB.prepare("SELECT email FROM users WHERE id = ?1").bind(caller.userId).first<{ email: string }>();
    if (!u) throw unauthorized();
    return { email: u.email, userId: caller.userId };
  }
  const token = c.req.header("x-support-session");
  if (token) {
    const row = await c.env.DB.prepare("SELECT email FROM support_sessions WHERE token_hash = ?1 AND expires_at > ?2").bind(await sha256Hex(token), now()).first<{ email: string }>();
    if (!row) throw unauthorized("support_session_expired", "Confirm your email again.");
    return { email: row.email, userId: await userIdForEmail(c.env.DB, row.email) };
  }
  if (required) throw unauthorized("unauthorized", "Confirm your email first.");
  return null;
}

function mine(t: TicketRow, r: Requester): boolean {
  return t.email === r.email || (!!r.userId && t.user_id === r.userId);
}

// ---------------------------------------------------------------------------
// Shared with the dashboard
// ---------------------------------------------------------------------------

/** An in-app notification from Worlds, through the sync service's inbox. */
export function notifyStmt(
  db: D1Database,
  userId: string,
  n: { id: string; topic: string; title: string; excerpt: string; link?: string },
): { stmt: D1PreparedStatement; envelope: EventEnvelope } {
  return eventStmt(db, { type: "user.notify", userId, notification: { ...n, createdAt: now() } });
}

export async function addMessage(
  env: Env,
  t: TicketRow,
  m: { author: MessageRow["author"]; authorId: string | null; body: string; files?: string[]; via: string },
  status?: TicketStatus,
): Promise<MessageRow> {
  const row: MessageRow = {
    id: newId(),
    ticket_id: t.id,
    author: m.author,
    author_id: m.authorId,
    body: m.body,
    files: JSON.stringify(m.files ?? []),
    via: m.via,
    created_at: now(),
  };
  const next = status ?? t.status;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO support_messages (id, ticket_id, author, author_id, body, files, via, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)").bind(
      row.id,
      row.ticket_id,
      row.author,
      row.author_id,
      row.body,
      row.files,
      row.via,
      row.created_at,
    ),
    env.DB.prepare(
      `UPDATE support_tickets SET status = ?1, updated_at = ?2,
        closed_at = CASE WHEN ?1 IN ('solved', 'closed') THEN COALESCE(closed_at, ?2) ELSE NULL END,
        first_reply_at = CASE WHEN ?3 = 'team' THEN COALESCE(first_reply_at, ?2) ELSE first_reply_at END
       WHERE id = ?4`,
    ).bind(next, row.created_at, m.author, t.id),
    ...(m.files?.length ? m.files.map((k) => env.DB.prepare("UPDATE support_files SET ticket_id = ?1 WHERE key = ?2 AND ticket_id IS NULL").bind(t.id, k)) : []),
  ]);
  return row;
}

/** The team's own address list: owners and support, who hear about new requests in the app. */
async function teamToTell(env: Env): Promise<string[]> {
  const owners = (env.ADMIN_OWNERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const { results } = await env.DB.prepare("SELECT user_id FROM admin_roles WHERE role IN ('owner', 'support')").all<{ user_id: string }>();
  return [...new Set([...owners, ...results.map((r) => r.user_id)])];
}

export async function tellTeam(env: Env, t: TicketRow, title: string, excerpt: string): Promise<EventEnvelope[]> {
  const ids = await teamToTell(env);
  if (!ids.length) return [];
  const stmts = ids.map((id) =>
    notifyStmt(env.DB, id, { id: `support:${t.id}:${now()}`, topic: "support.team", title, excerpt: excerpt.slice(0, 200), link: `https://admin.enterworlds.space/#/support/${t.number}` }),
  );
  await env.DB.batch(stmts.map((s) => s.stmt));
  return stmts.map((s) => s.envelope);
}

function later(c: Context<AppEnv>, p: Promise<unknown>) {
  try {
    c.executionCtx.waitUntil(p);
  } catch {
    // Tests: it simply runs.
  }
}

function lang(v: unknown): "ar" | "en" {
  return v === "en" ? "en" : "ar";
}

function cleanFields(v: unknown): Record<string, string> {
  if (v === undefined || v === null) return {};
  if (typeof v !== "object" || Array.isArray(v)) throw bad("invalid_fields", "fields must be an object");
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, 20)) {
    if (!/^[a-z][a-zA-Z0-9_]{0,40}$/.test(k)) continue;
    if (typeof val !== "string" && typeof val !== "number" && typeof val !== "boolean") continue;
    const s = String(val).trim().slice(0, 2000);
    if (s) out[k] = s;
  }
  return out;
}

async function ownFiles(db: D1Database, keys: unknown, owner: string, ticketId?: string): Promise<string[]> {
  if (keys === undefined) return [];
  if (!Array.isArray(keys) || keys.length > 6) throw bad("invalid_files", "Up to 6 pictures.");
  const out: string[] = [];
  for (const k of keys) {
    if (typeof k !== "string") throw bad("invalid_files");
    const f = await db.prepare("SELECT owner, ticket_id FROM support_files WHERE key = ?1").bind(k).first<{ owner: string; ticket_id: string | null }>();
    if (!f || f.owner !== owner || (f.ticket_id && f.ticket_id !== ticketId)) throw bad("invalid_files", "A picture is not yours.");
    out.push(k);
  }
  return out;
}

const ownerKey = (r: Requester) => (r.userId ? `u:${r.userId}` : `e:${r.email}`);

export async function newTicket(
  env: Env,
  t: { userId: string | null; email: string; name?: string | null; kind: Kind; subject: string; fields: Record<string, string>; lang: string; via: string },
): Promise<TicketRow> {
  const id = newId();
  const time = now();
  const priority = t.kind === "security" || t.kind === "recovery" ? "high" : "normal";
  for (let attempt = 0; attempt < 5; attempt++) {
    const next = await env.DB.prepare("SELECT COALESCE(MAX(number), 1000) + 1 AS n FROM support_tickets").first<{ n: number }>();
    try {
      await env.DB.prepare(
        `INSERT INTO support_tickets (id, number, user_id, email, name, kind, subject, fields, lang, priority, private, reply_key, via, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)`,
      )
        .bind(id, next!.n, t.userId, t.email, t.name ?? null, t.kind, t.subject, JSON.stringify(t.fields), t.lang, priority, t.kind === "security" ? 1 : 0, randomToken("").slice(0, 16).toLowerCase(), t.via, time)
        .run();
      return (await env.DB.prepare("SELECT * FROM support_tickets WHERE id = ?1").bind(id).first<TicketRow>())!;
    } catch (e) {
      if (!/UNIQUE/i.test(String(e))) throw e;
    }
  }
  throw new ApiError(503, "busy", "Try again.");
}

// ---------------------------------------------------------------------------
// The public API
// ---------------------------------------------------------------------------

export const support = new Hono<AppEnv>();

/** Exchange an email code (from POST /auth/email/start) for a support session. */
support.post("/session", async (c) => {
  const b = await body(c.req);
  const email = await consumeEmailCode(c, b.challengeId, b.code);
  const token = randomToken("ss_");
  const t = now();
  await c.env.DB.prepare("INSERT INTO support_sessions (token_hash, email, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(await sha256Hex(token), email, t, t + SESSION_DAYS * 86_400_000)
    .run();
  return c.json({ token, email, expiresAt: t + SESSION_DAYS * 86_400_000 });
});

support.post("/session/end", async (c) => {
  const token = c.req.header("x-support-session");
  if (token) await c.env.DB.prepare("DELETE FROM support_sessions WHERE token_hash = ?1").bind(await sha256Hex(token)).run();
  return c.json({ ok: true });
});

support.get("/me", async (c) => {
  const r = (await requester(c))!;
  const { results } = await c.env.DB.prepare("SELECT * FROM support_tickets WHERE email = ?1 OR (user_id IS NOT NULL AND user_id = ?2) ORDER BY updated_at DESC LIMIT 100")
    .bind(r.email, r.userId)
    .all<TicketRow>();
  return c.json({ email: r.email, hasAccount: !!r.userId, requests: results.map(ticketView) });
});

/** A picture for a request: { mime, data } with data in base64. */
support.post("/files", async (c) => {
  const r = (await requester(c))!;
  await rateLimit(c.env.DB, `support-file:${r.email}`, 40, HOUR);
  if (!c.env.PROFILE_FILES) throw new ApiError(503, "no_storage", "Pictures cannot be stored right now.");
  const b = await body(c.req);
  const mime = str(b.mime, "mime", 40);
  if (!FILE_TYPES.has(mime)) throw bad("invalid_type", "Only PNG, JPEG, WebP or GIF pictures.");
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(str(b.data, "data", 15_000_000)), (ch) => ch.charCodeAt(0));
  } catch {
    throw bad("invalid_data", "The picture could not be read.");
  }
  if (bytes.length > MAX_FILE) throw bad("too_large", "Pictures can be up to 10 MB.");
  const key = `s/${b64urlEncode(crypto.getRandomValues(new Uint8Array(18)))}`;
  await c.env.PROFILE_FILES.put(key, bytes, { httpMetadata: { contentType: mime } });
  await c.env.DB.prepare("INSERT INTO support_files (key, ticket_id, owner, mime, size, created_at) VALUES (?1, NULL, ?2, ?3, ?4, ?5)")
    .bind(key, ownerKey(r), mime, bytes.length, now())
    .run();
  return c.json({ key });
});

support.get("/files/*", async (c) => {
  const r = (await requester(c))!;
  const key = c.req.path.replace(/^.*?\/files\//, "");
  const f = await c.env.DB.prepare("SELECT f.owner, f.mime, t.email, t.user_id FROM support_files f LEFT JOIN support_tickets t ON t.id = f.ticket_id WHERE f.key = ?1")
    .bind(key)
    .first<{ owner: string; mime: string; email: string | null; user_id: string | null }>();
  if (!f) throw notFound();
  const allowed = f.owner === ownerKey(r) || f.email === r.email || (!!r.userId && f.user_id === r.userId);
  if (!allowed || !c.env.PROFILE_FILES) throw notFound();
  const obj = await c.env.PROFILE_FILES.get(key);
  if (!obj) throw notFound();
  return new Response(obj.body, { headers: { "content-type": f.mime, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
});

support.post("/requests", async (c) => {
  const r = (await requester(c))!;
  await rateLimit(c.env.DB, `support-new:${r.email}`, 10, HOUR);
  await rateLimit(c.env.DB, `support-new:ip:${clientIp(c.req.raw, c.env.EDGE_SECRET)}`, 20, HOUR);
  const b = await body(c.req);
  const kind = b.kind as Kind;
  if (!KINDS.includes(kind)) throw bad("invalid_kind", "Choose what the request is about.");
  const subject = str(b.subject, "subject", 160);
  const text = str(b.body, "body", 10_000);
  const files = await ownFiles(c.env.DB, b.files, ownerKey(r));
  const t = await newTicket(c.env, {
    userId: r.userId,
    email: r.email,
    name: optStr(b.name, "name", 80) ?? null,
    kind,
    subject,
    fields: cleanFields(b.fields),
    lang: lang(b.lang),
    via: b.via === "app" ? "app" : "web",
  });
  await addMessage(c.env, t, { author: "person", authorId: r.userId, body: text, files, via: t.via });
  const mail = supportMail("received", t, null);
  later(c, sendSupportMail(c.env, { to: t.email, ...mail, replyTo: replyAddress(c.env, t.reply_key) }));
  later(c, tellTeam(c.env, t, `${ticketRef(t.number)} · ${subject}`, text).then((ev) => deliver(c.env, ev)));
  return c.json(ticketView(t), 201);
});

async function ticketFor(c: Context<AppEnv>, r: Requester): Promise<TicketRow> {
  const n = Number(c.req.param("number"));
  const t = Number.isInteger(n) ? await c.env.DB.prepare("SELECT * FROM support_tickets WHERE number = ?1").bind(n).first<TicketRow>() : null;
  if (!t || !mine(t, r)) throw notFound("request_not_found", "There is no request with that number for this email.");
  return t;
}

support.get("/requests/:number", async (c) => {
  const r = (await requester(c))!;
  const t = await ticketFor(c, r);
  const { results } = await c.env.DB.prepare("SELECT * FROM support_messages WHERE ticket_id = ?1 AND author != 'note' ORDER BY created_at").bind(t.id).all<MessageRow>();
  return c.json({ ...ticketView(t), messages: results.map((m) => messageView(m)) });
});

support.post("/requests/:number/messages", async (c) => {
  const r = (await requester(c))!;
  await rateLimit(c.env.DB, `support-msg:${r.email}`, 60, HOUR);
  const t = await ticketFor(c, r);
  const b = await body(c.req);
  const text = str(b.body, "body", 10_000);
  const files = await ownFiles(c.env.DB, b.files, ownerKey(r), t.id);
  const m = await addMessage(c.env, t, { author: "person", authorId: r.userId, body: text, files, via: b.via === "app" ? "app" : "web" }, "open");
  later(c, tellTeam(c.env, t, `${ticketRef(t.number)} · ${t.subject}`, text).then((ev) => deliver(c.env, ev)));
  return c.json(messageView(m), 201);
});

/** "Did this solve it?" Yes closes it as solved; no opens it again. */
support.post("/requests/:number/rate", async (c) => {
  const r = (await requester(c))!;
  const t = await ticketFor(c, r);
  const b = await body(c.req);
  if (typeof b.solved !== "boolean") throw bad("invalid_request", "solved must be true or false");
  await c.env.DB.prepare(
    "UPDATE support_tickets SET rating = ?1, status = CASE WHEN ?1 = 1 THEN 'solved' ELSE 'open' END, closed_at = CASE WHEN ?1 = 1 THEN COALESCE(closed_at, ?2) ELSE NULL END, updated_at = ?2 WHERE id = ?3",
  )
    .bind(b.solved ? 1 : 0, now(), t.id)
    .run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// support@ by email (handed over by routes/published.ts' inbound mail)
// ---------------------------------------------------------------------------

/** "Name <a@b>" or a bare address, lowercased. */
function senderOf(from: string): { email: string; name: string | null } | null {
  const m = /<\s*([^<>\s]+@[^<>\s]+)\s*>/.exec(from) ?? /([^\s<>"]+@[^\s<>"]+)/.exec(from);
  if (!m) return null;
  const name = from.replace(/<[^>]*>/, "").replace(/"/g, "").trim();
  return { email: m[1].toLowerCase(), name: name && name !== m[1] ? name.slice(0, 80) : null };
}

/** Returns false when the address is not a support one. */
export async function inboundSupport(env: Env, mail: { to: string; from: string; subject: string; text: string }): Promise<boolean> {
  const local = mail.to.toLowerCase().split("@")[0];
  if (local !== "support" && !local.startsWith("support+")) return false;
  const who = senderOf(mail.from);
  if (!who) return true;
  // No loops with our own mail or bounces.
  if (/^(mailer-daemon|postmaster|no-?reply|support)(\+|@)/i.test(who.email)) return true;
  const ok = await rateLimit(env.DB, `support-mail:${who.email}`, 30, 86_400_000).then(
    () => true,
    () => false,
  );
  if (!ok) return true;
  const text = freshPart(mail.text).slice(0, 10_000) || "(empty)";
  const key = local.startsWith("support+") ? local.slice(8) : null;
  const existing = key ? await env.DB.prepare("SELECT * FROM support_tickets WHERE reply_key = ?1").bind(key).first<TicketRow>() : null;
  if (existing && existing.email === who.email) {
    await addMessage(env, existing, { author: "person", authorId: existing.user_id, body: text, via: "email" }, "open");
    await deliver(env, await tellTeam(env, existing, `${ticketRef(existing.number)} · ${existing.subject}`, text));
    return true;
  }
  const subject = (mail.subject || "").replace(/^\s*((re|fwd?|رد|إعادة توجيه)\s*:\s*)+/i, "").trim().slice(0, 160) || "(no subject)";
  const t = await newTicket(env, {
    userId: await userIdForEmail(env.DB, who.email),
    email: who.email,
    name: who.name,
    kind: "other",
    subject,
    fields: {},
    lang: /[؀-ۿ]/.test(subject + text) ? "ar" : "en",
    via: "email",
  });
  await addMessage(env, t, { author: "person", authorId: t.user_id, body: text, via: "email" });
  await sendSupportMail(env, { to: t.email, ...supportMail("received", t, null), replyTo: replyAddress(env, t.reply_key) });
  await deliver(env, await tellTeam(env, t, `${ticketRef(t.number)} · ${subject}`, text));
  return true;
}

/** Cron: a request waiting a week for the person closes, and they are told. Old sessions go. */
export async function supportHousekeeping(env: Env): Promise<void> {
  const t = now();
  const { results } = await env.DB.prepare("SELECT * FROM support_tickets WHERE status = 'waiting' AND updated_at < ?1 LIMIT 50").bind(t - 7 * 86_400_000).all<TicketRow>();
  for (const row of results) {
    await addMessage(env, row, { author: "system", authorId: null, body: "closed_after_a_week", via: "system" }, "closed");
    await sendSupportMail(env, { to: row.email, ...supportMail("closed", row, null), replyTo: replyAddress(env, row.reply_key) });
  }
  await env.DB.prepare("DELETE FROM support_sessions WHERE expires_at < ?1").bind(t).run();
  // Pictures never attached to a request are dropped after a day.
  const { results: stray } = await env.DB.prepare("SELECT key FROM support_files WHERE ticket_id IS NULL AND created_at < ?1 LIMIT 100").bind(t - 86_400_000).all<{ key: string }>();
  for (const f of stray) {
    await env.PROFILE_FILES?.delete(f.key);
    await env.DB.prepare("DELETE FROM support_files WHERE key = ?1").bind(f.key).run();
  }
}

export function assertKind(v: unknown): Kind {
  if (!KINDS.includes(v as Kind)) throw bad("invalid_kind");
  return v as Kind;
}
