import { Hono } from "hono";
import type { AppEnv } from "../env";
import { audit } from "../lib/audit";
import { b64urlEncode, now } from "../lib/crypto";
import { ApiError, bad, body, notFound } from "../lib/http";
import { clientIp, rateLimit } from "../lib/ratelimit";
import { normalizeUsername } from "../lib/usernames";
import { userById } from "./auth";

/**
 * Public profiles (docs/contracts/identity.md, Public profiles).
 *
 * The person publishes from Worlds: their name, avatar, banner, bio, links and
 * profile blocks, copied from the profile on their device. The page itself is
 * drawn by services/edge at profile.<domain>/@username from GET /profiles/:username.
 * A hidden profile answers exactly like one that does not exist.
 */

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_DATA_CHARS = 200_000;
const MAX_BLOCKS = 12;
const MAX_LINKS = 24;

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

export interface PublicProfileData {
  displayName: string;
  bio: string | null;
  status: string | null;
  location: string | null;
  accent: string | null;
  theme: "light" | "dark" | "auto";
  textDirection: "ltr" | "rtl" | "auto";
  language: string;
  links: { label: string; url: string }[];
  blocks: unknown[];
  bannerFocus: string | null;
  avatarCrop: string | null;
}

interface Row {
  user_id: string;
  visible: number;
  data: string;
  avatar_key: string | null;
  banner_key: string | null;
  published_at: number;
  updated_at: number;
}

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

/** Only links a visitor can safely follow. */
export function safeUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (t.length > 2000) return null;
  try {
    const u = new URL(t);
    return u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** A file key this person owns: p/<their id>/<name>.<ext>. */
export function ownsKey(userId: string, key: unknown): key is string {
  return typeof key === "string" && key.startsWith(`p/${userId}/`) && /^p\/[A-Za-z0-9-]+\/[A-Za-z0-9_-]{8,64}\.[a-z0-9]{2,5}$/.test(key);
}

/**
 * Keep the parts of a block a visitor can see. Strings that point at files are
 * kept only when the file is this person's ("file:p/<id>/..."), anything else
 * that looks like a local path is dropped, and links must be http(s) or mailto.
 */
export function cleanValue(userId: string, v: unknown, depth = 0): unknown {
  if (depth > 6) return null;
  if (typeof v === "string") {
    if (v.startsWith("file:")) return ownsKey(userId, v.slice(5)) ? v : null;
    // Paths on the person's own computer never leave it.
    if (/^([a-zA-Z]:[\\/]|\/|\\\\|asset:|blob:|data:|tauri:|file:)/.test(v)) return null;
    return v.slice(0, 2000);
  }
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean" || v === null) return v;
  if (Array.isArray(v)) return v.slice(0, 48).map((x) => cleanValue(userId, x, depth + 1));
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 40)) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(k)) continue;
      out[k] = k === "url" || k.endsWith("Url") ? (x === undefined || x === null || x === "" ? null : safeUrl(x)) : cleanValue(userId, x, depth + 1);
    }
    return out;
  }
  return null;
}

export function cleanProfile(userId: string, raw: Record<string, unknown>, fallbackName: string): PublicProfileData {
  const links = Array.isArray(raw.links) ? raw.links : [];
  const blocks = Array.isArray(raw.blocks) ? raw.blocks : [];
  const theme = raw.theme === "light" || raw.theme === "dark" ? raw.theme : "auto";
  const dir = raw.textDirection === "ltr" || raw.textDirection === "rtl" ? raw.textDirection : "auto";
  const accent = typeof raw.accent === "string" && /^#[0-9a-fA-F]{6}$/.test(raw.accent) ? raw.accent.toLowerCase() : null;
  const focus = (v: unknown) => (typeof v === "string" && /^[0-9.,\s-]{1,80}$/.test(v) ? v : null);
  return {
    displayName: text(raw.displayName, 80) ?? fallbackName,
    bio: text(raw.bio, 1000),
    status: text(raw.status, 140),
    location: text(raw.location, 80),
    accent,
    theme,
    textDirection: dir,
    language: typeof raw.language === "string" && /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(raw.language) ? raw.language : "en",
    links: links
      .slice(0, MAX_LINKS)
      .map((l) => {
        const o = (l ?? {}) as Record<string, unknown>;
        const url = safeUrl(o.url);
        return url ? { label: text(o.label, 60) ?? "", url } : null;
      })
      .filter((l): l is { label: string; url: string } => !!l),
    blocks: blocks
      .slice(0, MAX_BLOCKS)
      .filter((b) => b && typeof b === "object" && typeof (b as { type?: unknown }).type === "string" && !(b as { hidden?: unknown }).hidden)
      .map((b) => cleanValue(userId, b)),
    bannerFocus: focus(raw.bannerFocus),
    avatarCrop: focus(raw.avatarCrop),
  };
}

const profileUrl = (publicUrl: string, username: string) => {
  // login.<domain> -> profile.<domain>; anywhere else (local, workers.dev) the service's own /p/ path.
  try {
    const u = new URL(publicUrl);
    if (u.hostname.startsWith("login.")) return `https://profile.${u.hostname.slice(6)}/@${username}`;
  } catch {
    // fall through
  }
  return `${publicUrl.replace(/\/+$/, "")}/profiles/${username}`;
};

async function rowFor(db: D1Database, userId: string): Promise<Row | null> {
  return db.prepare("SELECT * FROM public_profiles WHERE user_id = ?1").bind(userId).first<Row>();
}

function ownerView(c: { env: AppEnv["Bindings"] }, row: Row | null, username: string) {
  return {
    published: !!row,
    visible: row ? row.visible === 1 : false,
    username,
    url: profileUrl(c.env.PUBLIC_URL, username),
    profile: row ? (JSON.parse(row.data) as PublicProfileData) : null,
    avatar: row?.avatar_key ? `file:${row.avatar_key}` : null,
    banner: row?.banner_key ? `file:${row.banner_key}` : null,
    publishedAt: row?.published_at ?? null,
    updatedAt: row?.updated_at ?? null,
    filesEnabled: !!c.env.PROFILE_FILES,
  };
}

/** Every key the published profile still uses. */
function keysIn(value: unknown, into = new Set<string>()): Set<string> {
  if (typeof value === "string" && value.startsWith("file:")) into.add(value.slice(5));
  else if (Array.isArray(value)) value.forEach((v) => keysIn(v, into));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => keysIn(v, into));
  return into;
}

/** Routes for the signed-in owner, mounted on /me (behind requireAuth). */
export function ownerRoutes(me: Hono<AppEnv>) {
  me.get("/public-profile", async (c) => {
    const caller = c.get("caller");
    const u = await userById(c.env.DB, caller.userId);
    if (!u) throw notFound();
    return c.json(ownerView(c, await rowFor(c.env.DB, caller.userId), u.username ?? ""));
  });

  /** Publish (or update) the profile. { visible?, profile, avatar?, banner? } with avatar/banner as "file:<key>" or null. */
  me.put("/public-profile", async (c) => {
    const caller = c.get("caller");
    const u = await userById(c.env.DB, caller.userId);
    if (!u) throw notFound();
    await rateLimit(c.env.DB, `profile:publish:${caller.userId}`, 60, 3_600_000);
    const b = await body(c.req);
    const raw = (b.profile ?? {}) as Record<string, unknown>;
    if (typeof raw !== "object" || Array.isArray(raw)) throw bad("invalid_profile", "profile must be an object");
    const data = cleanProfile(caller.userId, raw, u.display_name || u.username || "Worlds");
    const json = JSON.stringify(data);
    if (json.length > MAX_DATA_CHARS) throw bad("profile_too_large", "The profile is too large to publish. Remove a few blocks and try again.");
    const key = (v: unknown) => (typeof v === "string" && v.startsWith("file:") && ownsKey(caller.userId, v.slice(5)) ? v.slice(5) : null);
    const old = await rowFor(c.env.DB, caller.userId);
    const visible = b.visible === undefined ? (old ? old.visible : 1) : b.visible ? 1 : 0;
    const avatar = b.avatar === undefined ? (old?.avatar_key ?? null) : key(b.avatar);
    const banner = b.banner === undefined ? (old?.banner_key ?? null) : key(b.banner);
    const t = now();
    await c.env.DB.prepare(
      `INSERT INTO public_profiles (user_id, visible, data, avatar_key, banner_key, published_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
       ON CONFLICT(user_id) DO UPDATE SET visible = ?2, data = ?3, avatar_key = ?4, banner_key = ?5, updated_at = ?6`,
    )
      .bind(caller.userId, visible, json, avatar, banner, t)
      .run();
    // Files the profile no longer uses are removed.
    if (c.env.PROFILE_FILES) {
      const used = keysIn(data);
      if (avatar) used.add(avatar);
      if (banner) used.add(banner);
      const listed = await c.env.PROFILE_FILES.list({ prefix: `p/${caller.userId}/`, limit: 1000 });
      const stale = listed.objects.map((o) => o.key).filter((k) => !used.has(k));
      if (stale.length) await c.env.PROFILE_FILES.delete(stale);
    }
    await audit(c.env.DB, { action: old ? "profile.updated" : "profile.published", actorUserId: caller.userId, actorKind: caller.actor, deviceId: caller.deviceId, targetType: "user", targetId: caller.userId });
    return c.json(ownerView(c, await rowFor(c.env.DB, caller.userId), u.username ?? ""));
  });

  /** Show or hide without changing what is published. */
  me.patch("/public-profile", async (c) => {
    const caller = c.get("caller");
    const u = await userById(c.env.DB, caller.userId);
    if (!u) throw notFound();
    const b = await body(c.req);
    if (typeof b.visible !== "boolean") throw bad("invalid_request", "visible must be true or false");
    const r = await c.env.DB.prepare("UPDATE public_profiles SET visible = ?1, updated_at = ?2 WHERE user_id = ?3").bind(b.visible ? 1 : 0, now(), caller.userId).run();
    if (!r.meta.changes) throw notFound("not_published", "Publish the profile first.");
    await audit(c.env.DB, { action: b.visible ? "profile.shown" : "profile.hidden", actorUserId: caller.userId, actorKind: caller.actor, deviceId: caller.deviceId, targetType: "user", targetId: caller.userId });
    return c.json(ownerView(c, await rowFor(c.env.DB, caller.userId), u.username ?? ""));
  });

  /** Take the profile down entirely: the row and every file. */
  me.delete("/public-profile", async (c) => {
    const caller = c.get("caller");
    await c.env.DB.prepare("DELETE FROM public_profiles WHERE user_id = ?1").bind(caller.userId).run();
    if (c.env.PROFILE_FILES) {
      const listed = await c.env.PROFILE_FILES.list({ prefix: `p/${caller.userId}/`, limit: 1000 });
      if (listed.objects.length) await c.env.PROFILE_FILES.delete(listed.objects.map((o) => o.key));
    }
    await audit(c.env.DB, { action: "profile.removed", actorUserId: caller.userId, actorKind: caller.actor, deviceId: caller.deviceId, targetType: "user", targetId: caller.userId });
    return c.json({ ok: true });
  });

  /** Upload one picture or short video: { mime, data } with data in base64. Returns { file: "file:<key>" }. */
  me.post("/public-profile/files", async (c) => {
    const caller = c.get("caller");
    if (!c.env.PROFILE_FILES) throw new ApiError(503, "files_unavailable", "Pictures cannot be published on this server yet.");
    await rateLimit(c.env.DB, `profile:file:${caller.userId}`, 200, 3_600_000);
    const b = await body(c.req);
    const ext = typeof b.mime === "string" ? MIME_EXT[b.mime] : undefined;
    if (!ext) throw bad("unsupported_file", "Use a PNG, JPEG, WebP, GIF or AVIF picture, or an MP4 or WebM video.");
    if (typeof b.data !== "string") throw bad("invalid_request", "data is required");
    let bytes: Uint8Array;
    try {
      const bin = atob(b.data.replace(/^data:[^,]*,/, ""));
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch {
      throw bad("invalid_request", "data must be base64");
    }
    if (!bytes.length) throw bad("invalid_request", "The file is empty.");
    if (bytes.length > MAX_FILE_BYTES) throw bad("file_too_large", "Files are limited to 10 MB.");
    // Named by content, so the same picture uploaded twice is stored once.
    const digest = b64urlEncode(await crypto.subtle.digest("SHA-256", bytes)).slice(0, 32);
    const key = `p/${caller.userId}/${digest}.${ext}`;
    if (!(await c.env.PROFILE_FILES.head(key))) {
      await c.env.PROFILE_FILES.put(key, bytes, { httpMetadata: { contentType: b.mime as string, cacheControl: "public, max-age=31536000, immutable" } });
    }
    return c.json({ file: `file:${key}`, size: bytes.length });
  });
}

/** What anyone may read: no sign-in. */
export const profiles = new Hono<AppEnv>();

profiles.get("/:username", async (c) => {
  await rateLimit(c.env.DB, `profile:read:${clientIp(c.req.raw, c.env.EDGE_SECRET)}`, 600, 60_000);
  const name = normalizeUsername(decodeURIComponent(c.req.param("username")));
  const row = await c.env.DB.prepare(
    `SELECT p.*, u.username, u.created_at AS joined FROM public_profiles p JOIN users u ON u.id = p.user_id WHERE u.username = ?1 AND p.visible = 1`,
  )
    .bind(name)
    .first<Row & { username: string; joined: number }>();
  if (!row) throw notFound("profile_not_found", "There is no public profile with that username.");
  const data = JSON.parse(row.data) as PublicProfileData;
  return c.json(
    {
      username: row.username,
      ...data,
      avatar: row.avatar_key ? `file:${row.avatar_key}` : null,
      banner: row.banner_key ? `file:${row.banner_key}` : null,
      joinedAt: row.joined,
      updatedAt: row.updated_at,
    },
    200,
    { "cache-control": "public, max-age=60" },
  );
});

/** A published picture: only while its owner's profile is visible. */
profiles.get("/files/p/:userId/:name", async (c) => {
  const userId = c.req.param("userId");
  const key = `p/${userId}/${c.req.param("name")}`;
  if (!c.env.PROFILE_FILES || !ownsKey(userId, key)) throw notFound();
  const row = await c.env.DB.prepare("SELECT visible FROM public_profiles WHERE user_id = ?1").bind(userId).first<{ visible: number }>();
  if (!row || row.visible !== 1) throw notFound();
  const obj = await c.env.PROFILE_FILES.get(key);
  if (!obj) throw notFound();
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  // Hiding a profile must take its pictures down too, so caches keep them only briefly.
  headers.set("cache-control", "public, max-age=300");
  headers.set("x-content-type-options", "nosniff");
  return new Response(obj.body, { headers });
});
