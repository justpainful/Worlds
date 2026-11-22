/**
 * Updates for Worlds on Windows (src-tauri/src/app_update.rs).
 *
 *   GET /updates/:target/:arch/:current     (x-worlds-channel: beta for testers)
 *
 * Answers in the form Tauri's updater reads: the newest installer the team
 * offers on the download links (the same pinned release and pulled files as
 * routes/downloads.ts), its signature from the release, and where to read
 * what changed. 204 when the app is up to date or nothing is signed yet.
 */
import { Hono } from "hono";
import type { AppEnv, Env } from "../env";
import { compareVersions, settings } from "../lib/control";
import { now } from "../lib/crypto";
import { releases, resolve } from "./downloads";

/** Tauri's target and architecture, and the download platform that is their installer. */
const PLATFORM: Record<string, string> = { "windows-x86_64": "windows" };

const SIG_MS = 24 * 3_600_000;

/** Is a newer than b? 1.2.0 > 1.2.0-beta.2 > 1.2.0-beta.1 > 1.1.0. */
export function newer(a: string, b: string): boolean {
  const base = compareVersions(a, b);
  if (base) return base > 0;
  const pa = a.split("-").slice(1).join("-");
  const pb = b.split("-").slice(1).join("-");
  if (!pa || !pb) return !pa && !!pb;
  return pa.localeCompare(pb, "en", { numeric: true }) > 0;
}

async function signature(env: Env, url: string): Promise<string | null> {
  const key = `sig:${url}`;
  const row = await env.DB.prepare("SELECT value, at FROM stats_cache WHERE key = ?1").bind(key).first<{ value: string; at: number }>();
  if (row && now() - row.at < SIG_MS) return row.value;
  const r = await fetch(url, { headers: { "user-agent": "worlds-updates" } }).catch(() => null);
  if (!r?.ok) return row?.value ?? null;
  const text = (await r.text()).trim();
  if (!text || text.length > 4000) return null;
  await env.DB.prepare("INSERT OR REPLACE INTO stats_cache (key, value, at) VALUES (?1, ?2, ?3)").bind(key, text, now()).run();
  return text;
}

export const updates = new Hono<AppEnv>();

updates.get("/:target/:arch/:current", async (c) => {
  const platform = PLATFORM[`${c.req.param("target")}-${c.req.param("arch")}`];
  const current = c.req.param("current").slice(0, 40);
  if (!platform) return c.body(null, 204);
  let list;
  try {
    list = await releases(c.env);
  } catch {
    return c.body(null, 204);
  }
  const s = await settings(c.env.DB);
  // Testers' beta channel takes prereleases too, and is never held back by a pinned release.
  const beta = c.req.header("x-worlds-channel") === "beta";
  const pulled = s.downloads.pulled.map((p) => p.name);
  const pick = resolve(list, beta ? null : s.downloads.pinnedTag, pulled, beta).picks.find((p) => p.platform === platform);
  if (!pick) return c.body(null, 204);
  const version = pick.tag.replace(/^v/, "");
  // Never offer an older version, even when the team pinned one for new downloads.
  if (!newer(version, current)) return c.body(null, 204);
  const release = list.find((r) => r.tag === pick.tag);
  const sig = release?.assets.find((a) => a.name === `${pick.name}.sig`);
  if (!release || !sig) return c.body(null, 204);
  const text = await signature(c.env, sig.url);
  if (!text) return c.body(null, 204);
  return c.json(
    {
      version,
      notes: `https://changelog.enterworlds.space/${version}/`,
      pub_date: release.publishedAt,
      url: pick.url,
      signature: text,
    },
    200,
    { "cache-control": "public, max-age=300" },
  );
});
