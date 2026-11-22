/**
 * The download links on enterworlds.space (docs/admin/PLAN.md, section 7).
 *
 *   GET /downloads              which file each platform gets right now
 *   GET /downloads/:platform    a redirect to that file on GitHub
 *
 * The files stay on GitHub's release pages. The team can pull one file that
 * has a problem, so its platform falls back to the same file in the release
 * before, or pin an older release for everyone, from the dashboard, without
 * touching GitHub.
 */
import { Hono } from "hono";
import type { AppEnv, Env } from "../env";
import { settings } from "../lib/control";
import { now } from "../lib/crypto";
import { ApiError } from "../lib/http";

const REPO = "justpainful/Worlds";

/** Each platform and the file name that is its download. */
export const PLATFORMS: Record<string, { label: string; match: RegExp }> = {
  windows: { label: "Windows", match: /-Windows-x64-setup\.exe$/i },
  macos: { label: "Mac", match: /-macOS[^/]*\.dmg$/i },
  "macos-zip": { label: "Mac (zip)", match: /-macOS[^/]*\.zip$/i },
  "linux-appimage": { label: "Linux AppImage", match: /\.AppImage$/i },
  "linux-deb": { label: "Linux deb", match: /\.deb$/i },
  android: { label: "Android", match: /-Android[^/]*\.apk$/i },
  iphone: { label: "iPhone", match: /-iPhone[^/]*\.ipa$/i },
  ipad: { label: "iPad", match: /-iPad[^/]*\.ipa$/i },
};

export interface Release {
  tag: string;
  publishedAt: string;
  draft: boolean;
  prerelease: boolean;
  assets: { name: string; size: number; downloads: number; url: string }[];
}

export interface Pick {
  platform: string;
  label: string;
  tag: string;
  name: string;
  size: number;
  url: string;
  /** True when this is not the newest file for the platform: pulled or pinned. */
  fallback: boolean;
}

const CACHE_KEY = "github-releases-full";
const FRESH_MS = 10 * 60_000;

/** GitHub's releases, kept ten minutes; an older copy is used when GitHub cannot be reached. */
export async function releases(env: Env, fresh = false): Promise<Release[]> {
  const row = await env.DB.prepare("SELECT value, at FROM stats_cache WHERE key = ?1").bind(CACHE_KEY).first<{ value: string; at: number }>();
  if (row && !fresh && now() - row.at < FRESH_MS) return JSON.parse(row.value) as Release[];
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, { headers: { "user-agent": "worlds-downloads", accept: "application/vnd.github+json" } });
    if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
    const list = (await r.json()) as {
      tag_name: string;
      published_at: string;
      draft: boolean;
      prerelease: boolean;
      assets: { name: string; size: number; download_count: number; browser_download_url: string }[];
    }[];
    const out: Release[] = list.map((x) => ({
      tag: x.tag_name,
      publishedAt: x.published_at,
      draft: !!x.draft,
      prerelease: !!x.prerelease,
      assets: x.assets.map((a) => ({ name: a.name, size: a.size, downloads: a.download_count, url: a.browser_download_url })),
    }));
    await env.DB.prepare("INSERT OR REPLACE INTO stats_cache (key, value, at) VALUES (?1, ?2, ?3)").bind(CACHE_KEY, JSON.stringify(out), now()).run();
    return out;
  } catch (e) {
    if (row) return JSON.parse(row.value) as Release[];
    throw new ApiError(502, "github_unavailable", e instanceof Error ? e.message : "GitHub could not be reached.");
  }
}

/** Only files on GitHub's own download host are ever linked. */
function safeUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === "https:" && url.hostname === "github.com" && url.pathname.startsWith(`/${REPO}/releases/download/`);
  } catch {
    return false;
  }
}

/**
 * Which file each platform gets: from the pinned release (or the newest one),
 * skipping pulled files, and falling back to older releases for a platform
 * whose file was pulled.
 */
export function resolve(list: Release[], pinnedTag: string | null, pulled: string[]): { tag: string | null; picks: Pick[] } {
  const published = list.filter((r) => !r.draft && !r.prerelease).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  let start = 0;
  if (pinnedTag) {
    const i = published.findIndex((r) => r.tag === pinnedTag);
    if (i >= 0) start = i;
  }
  const gone = new Set(pulled);
  const picks: Pick[] = [];
  for (const [platform, p] of Object.entries(PLATFORMS)) {
    for (let i = start; i < published.length; i++) {
      const a = published[i].assets.find((x) => p.match.test(x.name) && !gone.has(x.name) && safeUrl(x.url));
      if (a) {
        picks.push({ platform, label: p.label, tag: published[i].tag, name: a.name, size: a.size, url: a.url, fallback: i > 0 });
        break;
      }
    }
  }
  return { tag: published[start]?.tag ?? null, picks };
}

export async function currentDownloads(env: Env, fresh = false) {
  const s = await settings(env.DB);
  const list = await releases(env, fresh);
  return { ...resolve(list, s.downloads.pinnedTag, s.downloads.pulled.map((p) => p.name)), releases: list };
}

export const downloads = new Hono<AppEnv>();

downloads.get("/", async (c) => {
  const { tag, picks } = await currentDownloads(c.env);
  return c.json({ tag, files: picks.map(({ platform, label, tag: t, name, size }) => ({ platform, label, tag: t, name, size, url: `/downloads/${platform}` })) }, 200, {
    "cache-control": "public, max-age=300",
    "access-control-allow-origin": "*",
  });
});

downloads.get("/:platform", async (c) => {
  const platform = c.req.param("platform");
  if (!PLATFORMS[platform]) throw new ApiError(404, "unknown_platform", "There is no download for that platform.");
  let pick: Pick | undefined;
  try {
    pick = (await currentDownloads(c.env)).picks.find((p) => p.platform === platform);
  } catch {
    // GitHub is unreachable and nothing is cached: the releases page still works.
  }
  const to = pick?.url ?? `https://github.com/${REPO}/releases/latest`;
  return c.redirect(to, 302);
});
