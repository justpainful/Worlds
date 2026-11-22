import { Hono } from "hono";
import type { AppEnv } from "../env";
import { requireAuth } from "../lib/auth";
import { now, randomToken, sha256Hex } from "../lib/crypto";
import { inboundSupport } from "./support";
import { bad, body, notFound } from "../lib/http";
import { clientIp, rateLimit, sameSecret } from "../lib/ratelimit";

/**
 * Pages on the web (Worlds 1.0).
 *
 * - Published pages: the person publishes a page from Worlds as HTML; it is
 *   shown by services/edge at profile.<domain>/@username/<slug>.
 * - Share links: the same, at /s/<random slug>, optionally with a password
 *   and an end date. After the end date the link answers like one that never
 *   existed.
 * - Email inbox: mail to <key>@<inbox domain> is handed over by the edge and
 *   kept until the person's Worlds picks it up.
 *
 * The HTML is drawn by Worlds from the page's blocks and shown by the edge
 * under a policy that runs no scripts.
 */

const MAX_HTML = 600_000;
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const shortId = (n: number) => randomToken("", 16).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, n);

export const published = new Hono<AppEnv>();

// ---- The owner ---------------------------------------------------------

published.use("/mine", requireAuth);
published.use("/mine/*", requireAuth);

published.get("/mine", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT slug, kind, title, lang, expires_at AS expiresAt, password_hash IS NOT NULL AS hasPassword, views, updated_at AS updatedAt FROM published_pages WHERE user_id = ?1 ORDER BY updated_at DESC",
  )
    .bind(c.get("caller").userId)
    .all();
  return c.json({ pages: rows.results });
});

/** Publish or update a page; `kind: "share"` makes a share link with a random slug. */
published.put("/mine", async (c) => {
  const caller = c.get("caller");
  const b = await body(c.req);
  const kind = b.kind === "share" ? "share" : "page";
  const title = typeof b.title === "string" ? b.title.trim().slice(0, 200) : "";
  const html = typeof b.html === "string" ? b.html : "";
  const lang = b.lang === "ar" ? "ar" : "en";
  if (!title || !html) throw bad("missing", "A title and the page are needed.");
  if (html.length > MAX_HTML) throw bad("too_large", "The page is too large to publish.");
  let slug = typeof b.slug === "string" ? b.slug.toLowerCase() : "";
  if (kind === "page" && !SLUG.test(slug)) throw bad("invalid_slug", "Use letters, numbers and dashes for the address.");
  if (kind === "share" && !SLUG.test(slug)) slug = shortId(16);
  const expiresAt = typeof b.expiresAt === "number" && b.expiresAt > now() ? Math.floor(b.expiresAt) : null;
  const password = typeof b.password === "string" && b.password.length >= 4 ? await sha256Hex(`${slug}:${b.password}`) : null;
  const t = now();
  await c.env.DB.prepare(
    `INSERT INTO published_pages (id, user_id, slug, kind, title, html, lang, password_hash, expires_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
     ON CONFLICT(kind, user_id, slug) DO UPDATE SET title = ?5, html = ?6, lang = ?7, password_hash = ?8, expires_at = ?9, updated_at = ?10`,
  )
    .bind(randomToken("pp_", 12), caller.userId, slug, kind, title, html, lang, password, expiresAt, t)
    .run();
  return c.json({ slug, kind, expiresAt });
});

published.delete("/mine/:kind/:slug", async (c) => {
  await c.env.DB.prepare("DELETE FROM published_pages WHERE user_id = ?1 AND kind = ?2 AND slug = ?3")
    .bind(c.get("caller").userId, c.req.param("kind") === "share" ? "share" : "page", c.req.param("slug").toLowerCase())
    .run();
  return c.json({ ok: true });
});

// ---- Readers (through the edge) ---------------------------------------

/** A published page of a public profile. */
published.get("/page/:username/:slug", async (c) => {
  const slug = c.req.param("slug").toLowerCase();
  const row = await c.env.DB.prepare(
    `SELECT p.id, p.title, p.html, p.lang, u.display_name AS author, u.username FROM published_pages p JOIN users u ON u.id = p.user_id
     WHERE u.username = ?1 AND p.slug = ?2 AND p.kind = 'page' AND (u.suspended_until IS NULL OR u.suspended_until <= ?3)`,
  )
    .bind(c.req.param("username").toLowerCase(), slug, now())
    .first<{ id: string }>();
  if (!row) throw notFound();
  await c.env.DB.prepare("UPDATE published_pages SET views = views + 1 WHERE id = ?1").bind(row.id).run();
  return c.json(row);
});

/** A share link: 401 asks for the password, 404 when it never existed or has ended. */
published.post("/share/:slug", async (c) => {
  const slug = c.req.param("slug").toLowerCase();
  await rateLimit(c.env.DB, `share:${clientIp(c.req.raw, c.env.EDGE_SECRET)}`, 60, 600_000);
  const row = await c.env.DB.prepare(
    `SELECT p.id, p.title, p.html, p.lang, p.password_hash AS passwordHash, p.expires_at AS expiresAt FROM published_pages p JOIN users u ON u.id = p.user_id
     WHERE p.slug = ?1 AND p.kind = 'share' AND (u.suspended_until IS NULL OR u.suspended_until <= ?2)`,
  )
    .bind(slug, now())
    .first<{ id: string; title: string; html: string; lang: string; passwordHash: string | null; expiresAt: number | null }>();
  if (!row || (row.expiresAt && row.expiresAt < now())) throw notFound();
  if (row.passwordHash) {
    const b = await body(c.req).catch(() => ({}) as Record<string, unknown>);
    const given = typeof b.password === "string" ? await sha256Hex(`${slug}:${b.password}`) : "";
    if (given !== row.passwordHash) return c.json({ error: "password", message: "This page needs its password." }, 401);
  }
  await c.env.DB.prepare("UPDATE published_pages SET views = views + 1 WHERE id = ?1").bind(row.id).run();
  return c.json({ title: row.title, html: row.html, lang: row.lang, expiresAt: row.expiresAt });
});

// ---- Email inbox -------------------------------------------------------

/** This person's inbox address, made the first time it is asked for. */
published.get("/mail/address", requireAuth, async (c) => {
  const userId = c.get("caller").userId;
  let row = await c.env.DB.prepare("SELECT key FROM mail_addresses WHERE user_id = ?1").bind(userId).first<{ key: string }>();
  if (!row) {
    const key = `w${shortId(10)}`;
    await c.env.DB.prepare("INSERT INTO mail_addresses (user_id, key, created_at) VALUES (?1, ?2, ?3)").bind(userId, key, now()).run();
    row = { key };
  }
  return c.json({ address: `${row.key}@${c.env.MAIL_INBOX_DOMAIN || "in.example.com"}` });
});

published.get("/mail/items", requireAuth, async (c) => {
  const rows = await c.env.DB.prepare("SELECT id, sender, subject, body, received_at AS receivedAt FROM mail_items WHERE user_id = ?1 AND picked_at IS NULL ORDER BY received_at LIMIT 50")
    .bind(c.get("caller").userId)
    .all();
  return c.json({ items: rows.results });
});

published.post("/mail/items/ack", requireAuth, async (c) => {
  const b = await body(c.req);
  const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === "string").slice(0, 100) : [];
  const t = now();
  const userId = c.get("caller").userId;
  if (ids.length) await c.env.DB.batch(ids.map((id) => c.env.DB.prepare("UPDATE mail_items SET picked_at = ?1 WHERE id = ?2 AND user_id = ?3").bind(t, id, userId)));
  // Picked-up mail is kept a week, then removed.
  await c.env.DB.prepare("DELETE FROM mail_items WHERE picked_at IS NOT NULL AND picked_at < ?1").bind(t - 7 * 86_400_000).run();
  return c.json({ ok: true });
});

/** Mail handed over by the edge's email handler; only the edge may call it. */
published.post("/mail/inbound", async (c) => {
  if (!c.env.EDGE_SECRET || !sameSecret(c.req.header("x-worlds-edge") ?? null, c.env.EDGE_SECRET)) throw notFound();
  const b = await body(c.req);
  const to = typeof b.to === "string" ? b.to.toLowerCase() : "";
  // support@ and support+<request>@ belong to the support desk (routes/support.ts).
  if (await inboundSupport(c.env, { to, from: String(b.from ?? ""), subject: String(b.subject ?? ""), text: typeof b.text === "string" ? b.text : "" })) return c.json({ ok: true });
  const key = to.split("@")[0]?.split("+")[0] ?? "";
  const row = await c.env.DB.prepare("SELECT user_id AS userId FROM mail_addresses WHERE key = ?1").bind(key).first<{ userId: string }>();
  if (!row) throw notFound();
  await rateLimit(c.env.DB, `mail:${row.userId}`, 200, 86_400_000);
  const text = typeof b.text === "string" ? b.text.slice(0, 200_000) : "";
  await c.env.DB.prepare("INSERT INTO mail_items (id, user_id, sender, subject, body, received_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
    .bind(randomToken("m_", 12), row.userId, String(b.from ?? "").slice(0, 300), String(b.subject ?? "").slice(0, 300), text, now())
    .run();
  return c.json({ ok: true });
});
