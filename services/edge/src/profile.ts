/**
 * profile.<domain>: every Worlds account's public profile at /@username.
 *
 *   /@name            the page, drawn here from the identity service's GET /profiles/:name
 *   /files/p/<id>/... a published picture, passed through from /profiles/files/...
 *   /name             redirects to /@name
 *   /                 a short page about Worlds profiles
 *
 * Everything a person wrote is escaped, links are http(s) or mailto only, and
 * the page loads nothing from other sites (see the Content-Security-Policy).
 */

export interface PublicProfile {
  username: string;
  displayName: string;
  bio: string | null;
  status: string | null;
  location: string | null;
  accent: string | null;
  theme: "light" | "dark" | "auto";
  textDirection: "ltr" | "rtl" | "auto";
  language: string;
  links: { label: string; url: string }[];
  blocks: Record<string, unknown>[];
  bannerFocus: string | null;
  avatarCrop: string | null;
  avatar: string | null;
  banner: string | null;
  joinedAt: number;
  updatedAt: number;
}

type Lang = "en" | "ar";

const WORDS: Record<Lang, Record<string, string>> = {
  en: {
    joined: "Joined",
    links: "Links",
    made: "A Worlds profile",
    get: "Make yours in Worlds",
    missingTitle: "No profile here",
    missing: "There is no public profile with this username, or its owner has hidden it.",
    homeTitle: "Worlds profiles",
    home: "Every Worlds account can have a public profile at profile.enterworlds.space/@username, with its picture, banner, links and blocks. Its owner can hide it at any time.",
    open: "Open Worlds",
  },
  ar: {
    joined: "انضم",
    links: "الروابط",
    made: "ملف شخصي في Worlds",
    get: "أنشئ ملفك في Worlds",
    missingTitle: "لا يوجد ملف هنا",
    missing: "لا يوجد ملف عام بهذا الاسم، أو أخفاه صاحبه.",
    homeTitle: "الملفات الشخصية في Worlds",
    home: "يمكن لكل حساب في Worlds أن يكون له ملف عام على profile.enterworlds.space/@username، فيه صورته وغلافه وروابطه وكتله، ويستطيع صاحبه إخفاءه متى شاء.",
    open: "افتح Worlds",
  },
};

const MONTHS: Record<Lang, string[]> = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  ar: ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"],
};

/** The arrow after a link that opens elsewhere, as an entity so no file carries the glyph. */
const ARROW = "&#8599;";

export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only links a visitor can safely follow. */
export function safeHref(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** "file:p/<id>/<name>" becomes this host's /files/p/<id>/<name>; anything else is dropped. */
export function fileSrc(v: unknown): string | null {
  if (typeof v !== "string" || !v.startsWith("file:")) return null;
  const key = v.slice(5);
  return /^p\/[A-Za-z0-9-]+\/[A-Za-z0-9_-]{8,64}\.[a-z0-9]{2,5}$/.test(key) ? `/files/${key}` : null;
}

const isVideo = (src: string) => /\.(mp4|webm)$/.test(src);
const RTL_TEXT = /[֐-ࣿיִ-﷿ﹰ-﻿]/;

export function directionOf(p: Pick<PublicProfile, "textDirection" | "displayName" | "bio">): "ltr" | "rtl" {
  if (p.textDirection === "ltr" || p.textDirection === "rtl") return p.textDirection;
  return RTL_TEXT.test(`${p.displayName} ${p.bio ?? ""}`) ? "rtl" : "ltr";
}

const focusOf = (f: unknown) => {
  const [x, y] = String(f ?? "50,50").split(",").map(Number);
  return `${Number.isFinite(x) ? x : 50}% ${Number.isFinite(y) ? y : 50}%`;
};

/** A readable name for a link with no label of its own. */
export function linkLabel(l: { label: string; url: string }): string {
  if (l.label) return l.label;
  try {
    const u = new URL(l.url);
    if (u.protocol === "mailto:") return u.pathname;
    const host = u.hostname.replace(/^www\./, "");
    const known: Record<string, string> = {
      "x.com": "X",
      "twitter.com": "X",
      "instagram.com": "Instagram",
      "github.com": "GitHub",
      "youtube.com": "YouTube",
      "youtu.be": "YouTube",
      "tiktok.com": "TikTok",
      "linkedin.com": "LinkedIn",
      "t.me": "Telegram",
      "snapchat.com": "Snapchat",
      "twitch.tv": "Twitch",
      "discord.gg": "Discord",
      "discord.com": "Discord",
      "behance.net": "Behance",
      "dribbble.com": "Dribbble",
      "reddit.com": "Reddit",
      "threads.net": "Threads",
      "facebook.com": "Facebook",
      "wa.me": "WhatsApp",
    };
    return known[host] ?? host;
  } catch {
    return l.url;
  }
}

const hostOf = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === "mailto:" ? "" : u.hostname.replace(/^www\./, "") + (u.pathname.length > 1 ? u.pathname.replace(/\/$/, "") : "");
  } catch {
    return "";
  }
};

function icon(ref: unknown, size = 28): string {
  if (typeof ref !== "string" || !ref) return "";
  const src = fileSrc(ref);
  if (src) return `<img class="ic" src="${esc(src)}" width="${size}" height="${size}" alt="" loading="lazy">`;
  // An emoji or a short symbol; product icons were turned into files when published.
  if (ref.startsWith("pi:") || ref.startsWith("img:") || ref.length > 8) return "";
  return `<span class="ic emoji" style="font-size:${Math.round(size * 0.8)}px">${esc(ref)}</span>`;
}

function picture(ref: unknown, cls: string, focus?: unknown, fit = "cover"): string {
  const src = fileSrc(ref);
  if (!src) return "";
  const style = `object-fit:${fit === "contain" || fit === "whole" ? "contain" : fit === "original" ? "none" : "cover"};object-position:${focusOf(focus)}`;
  return isVideo(src)
    ? `<video class="${cls}" src="${esc(src)}" autoplay muted loop playsinline style="${style}"></video>`
    : `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy" style="${style}">`;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const items = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]).filter((x) => x && typeof x === "object") : []);

function item(it: Record<string, unknown>, kind: "grid" | "list" | "link" | "badge"): string {
  const href = safeHref(it.url);
  const inner =
    `${icon(it.icon, kind === "badge" ? 20 : kind === "grid" ? 34 : 26)}` +
    `<span class="it-text"><span class="it-title">${esc(it.title)}</span>${it.subtitle ? `<span class="it-sub">${esc(it.subtitle)}</span>` : ""}</span>` +
    (href && kind !== "badge" ? `<span class="go" aria-hidden="true">${ARROW}</span>` : "");
  return href ? `<a class="it it-${kind}" href="${esc(href)}" rel="noopener nofollow ugc" target="_blank">${inner}</a>` : `<div class="it it-${kind}">${inner}</div>`;
}

const SIZE: Record<string, [number, number]> = { "12x1": [12, 1], "12x2": [12, 2], "8x1": [8, 1], "6x1": [6, 1], "6x2": [6, 2], "4x1": [4, 1], "3x1": [3, 1] };
const STYLES = new Set(["soft", "tinted", "solid", "compact", "showcase", "minimal"]);
const FRAME_RATIO: Record<string, number> = { square: 1, large: 1, circle: 1, classic: 4 / 3, upright: 3 / 4, phone: 9 / 16, portrait: 1 / 2.1, column: 0.95 / 2.85, wide: 2.1, pano: 3 };

export function block(b: Record<string, unknown>): string {
  const [cols, rows] = SIZE[str(b.size)] ?? [12, 1];
  const style = STYLES.has(str(b.style)) ? str(b.style) : "soft";
  const accent = /^#[0-9a-f]{6}$/i.test(str(b.accent)) ? str(b.accent) : "";
  const title = (t: unknown) => (t ? `<h3 class="bt">${esc(t)}</h3>` : "");
  const label = (t: unknown, ic?: unknown) => (t ? `<div class="lbl">${icon(ic, 16)}${esc(t)}</div>` : "");
  let body = "";
  switch (b.type) {
    case "info": {
      const side = ["left", "right", "top", "background"].includes(str(b.imageSide)) ? str(b.imageSide) : "right";
      const art = picture(b.image, "art", b.focus, str(b.imageFit));
      body = `<div class="info side-${side}${art ? " has-art" : ""}">${side === "background" ? art : ""}<div class="txt">${label(b.label, b.labelIcon)}<div class="big">${esc(b.title)}</div>${b.subtitle ? `<p class="sub">${esc(b.subtitle)}</p>` : ""}${b.badge ? `<span class="chip">${esc(b.badge)}</span>` : ""}</div>${side !== "background" ? art : ""}</div>`;
      break;
    }
    case "progress": {
      const max = Number(b.max) > 0 ? Number(b.max) : 100;
      const value = Math.max(0, Math.min(max, Number(b.value) || 0));
      const pct = Math.round((value / max) * 100);
      const shown = b.display === "none" ? "" : b.display === "percent" ? `${pct}%` : `${value}/${max}`;
      body = `<div class="prog"><div class="row">${icon(b.icon, 30)}<div class="txt"><div class="big sm">${esc(b.title)}</div>${b.caption ? `<p class="sub">${esc(b.caption)}</p>` : ""}</div><span class="num">${esc(shown)}</span></div><div class="bar" role="progressbar" aria-valuenow="${value}" aria-valuemax="${max}"><span style="width:${pct}%"></span></div></div>`;
      break;
    }
    case "quote": {
      const side = ["left", "right", "top", "background"].includes(str(b.imageSide)) ? str(b.imageSide) : "right";
      const art = picture(b.image, "art", b.focus, str(b.imageFit));
      body = `<div class="info quote side-${side}${art ? " has-art" : ""}${b.align === "center" ? " center" : ""}">${side === "background" ? art : ""}<div class="txt">${label(b.label, b.labelIcon)}<blockquote>${esc(b.statement)}</blockquote>${b.subtext ? `<p class="sub">${esc(b.subtext)}</p>` : ""}</div>${side !== "background" ? art : ""}</div>`;
      break;
    }
    case "grid": {
      const n = [1, 2, 3, 4].includes(Number(b.columns)) ? Number(b.columns) : 3;
      body = `${title(b.title)}<div class="grid g${n}">${items(b.items).map((it) => item(it, "grid")).join("")}</div>`;
      break;
    }
    case "list":
      body = `${title(b.title)}<div class="list">${items(b.items).map((it) => item(it, "list")).join("")}</div>`;
      break;
    case "links":
      body = `${title(b.title)}<div class="list">${items(b.links).map((it) => item(it, "link")).join("")}</div>`;
      break;
    case "badges":
      body = `${title(b.title)}<div class="badges">${items(b.badges).map((it) => item(it, "badge")).join("")}</div>`;
      break;
    case "fields":
      body = `${title(b.title)}<dl class="fields">${items(b.fields)
        .map((f) => `<div><dt>${esc(f.key)}</dt><dd>${esc(f.value)}</dd></div>`)
        .join("")}</dl>`;
      break;
    case "media": {
      const art = picture(b.media, "media", b.focus, str(b.fit));
      if (!art) return "";
      body = `<figure class="mediawrap">${art}${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ""}</figure>`;
      break;
    }
    case "frame": {
      const photo = Array.isArray(b.photos) ? b.photos.find((p) => fileSrc(p)) : null;
      if (!photo) return "";
      const ratio = FRAME_RATIO[str(b.shape)] ?? 0;
      const radius = str(b.shape) === "circle" ? "50%" : `${Math.max(0, Math.min(60, Number(b.radius) || 18))}px`;
      const text = b.text ? `<figcaption class="ft ${b.textPos === "top" ? "top" : "bottom"}">${esc(b.text)}</figcaption>` : "";
      body = `<figure class="frame${b.shadow ? " shadow" : ""}" style="border-radius:${radius};aspect-ratio:${ratio || 4 / 3}">${b.fit === "whole" ? picture(photo, "back", b.focus) : ""}${picture(photo, "front", b.focus, b.fit === "whole" ? "contain" : "cover")}${text}</figure>`;
      break;
    }
    default:
      // Live blocks (streaks, activity) only make sense inside the app.
      return "";
  }
  const href = safeHref(b.url);
  const open = href ? `<a class="blk-link" href="${esc(href)}" rel="noopener nofollow ugc" target="_blank">` : "";
  return `<section class="blk st-${style} c${cols} r${rows}"${accent ? ` style="--accent:${esc(accent)}"` : ""}>${open}${body}${href ? "</a>" : ""}</section>`;
}

function langOf(p: { language?: string } | null, accept: string | null): Lang {
  const l = p?.language ?? accept ?? "";
  return /^ar\b/i.test(l) ? "ar" : "en";
}

const CSS = `
:root{--bg:#f8f8fa;--surface:#fdfdfd;--text:#1d1d1f;--muted:#6e6e73;--line:rgba(0,0,0,.08);--card:rgba(255,255,255,.72);--accent:#007aff;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#171719;--surface:#202023;--text:#f5f5f7;--muted:#aeaeb2;--line:rgba(255,255,255,.1);--card:rgba(40,40,44,.72);--accent:#0a84ff}}
:root[data-theme=dark]{--bg:#171719;--surface:#202023;--text:#f5f5f7;--muted:#aeaeb2;--line:rgba(255,255,255,.1);--card:rgba(40,40,44,.72);--accent:#0a84ff}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text)}
body{font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI Variable","Segoe UI","SF Arabic","Noto Sans Arabic",Tahoma,sans-serif;-webkit-font-smoothing:antialiased;min-height:100vh}
[dir=rtl] body{line-height:1.75}
a{color:inherit}
.ambient{position:fixed;inset:-10%;z-index:0;background-size:cover;background-position:center;filter:blur(60px) saturate(1.3);opacity:.35;pointer-events:none}
.page{position:relative;z-index:1;max-width:940px;margin:0 auto;padding:0 16px 56px}
.banner{position:relative;height:clamp(150px,30vw,300px);border-radius:0 0 18px 18px;overflow:hidden;background:color-mix(in srgb,var(--accent) 22%,var(--surface))}
.banner img,.banner video{width:100%;height:100%;display:block}
.head{position:relative;z-index:1;display:flex;align-items:flex-start;gap:18px;margin-top:-52px;padding:0 8px}
.avatar{flex:none;width:118px;height:118px;border-radius:50%;overflow:hidden;border:4px solid var(--bg);background:var(--surface);position:relative}
.avatar img{width:100%;height:100%;object-fit:cover;display:block}
.avatar .letter{display:grid;place-items:center;width:100%;height:100%;font-size:46px;font-weight:600;color:#fff;background:var(--accent)}
.who{padding-top:62px;min-width:0}
h1{margin:0;font-size:clamp(24px,4vw,32px);line-height:1.15;letter-spacing:-.01em;overflow-wrap:anywhere}
[dir=rtl] h1{letter-spacing:0;line-height:1.4}
.handle{color:var(--muted);font-size:15px;direction:ltr;unicode-bidi:isolate}
.status{display:inline-block;margin-top:6px;padding:3px 10px;border-radius:999px;background:var(--card);border:1px solid var(--line);font-size:13px}
.about{padding:18px 8px 6px}
.bio{margin:0 0 10px;font-size:16px;white-space:pre-line;overflow-wrap:anywhere}
.meta{display:flex;flex-wrap:wrap;gap:6px 16px;color:var(--muted);font-size:13px}
.links{display:flex;flex-wrap:wrap;gap:8px;padding:12px 8px 4px}
.link{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;background:var(--card);border:1px solid var(--line);text-decoration:none;font-weight:500;transition:background .11s cubic-bezier(.2,.7,.2,1)}
.link small{color:var(--muted);font-weight:400;direction:ltr;unicode-bidi:isolate}
.link:hover{background:color-mix(in srgb,var(--accent) 14%,var(--card))}
.link:focus-visible,.it:focus-visible,.blk-link:focus-visible,.btn:focus-visible,footer a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.blocks{display:grid;grid-template-columns:repeat(12,1fr);gap:12px;padding:18px 0 0}
.blk{position:relative;border-radius:16px;background:var(--card);border:1px solid var(--line);padding:16px;overflow:hidden;min-width:0;backdrop-filter:blur(18px) saturate(1.4);-webkit-backdrop-filter:blur(18px) saturate(1.4)}
.c12{grid-column:span 12}.c8{grid-column:span 8}.c6{grid-column:span 6}.c4{grid-column:span 4}.c3{grid-column:span 3}
.r2{grid-row:span 2}
.st-tinted{background:color-mix(in srgb,var(--accent) 16%,var(--card))}
.st-solid{background:var(--surface)}
.st-compact{padding:11px 13px;font-size:14px}
.st-minimal{background:none;border-color:transparent;backdrop-filter:none;-webkit-backdrop-filter:none;padding:8px 4px}
.st-showcase .big{font-size:24px}
.blk-link{display:block;text-decoration:none;color:inherit;margin:-16px;padding:16px;height:calc(100% + 32px)}
.bt{margin:0 0 10px;font-size:14px;font-weight:600;color:var(--muted)}
.lbl{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--accent);margin-bottom:4px}
.big{font-size:19px;font-weight:600;line-height:1.25;overflow-wrap:anywhere}
[dir=rtl] .big{line-height:1.5}
.big.sm{font-size:16px}
.sub{margin:4px 0 0;color:var(--muted);font-size:14px;overflow-wrap:anywhere}
.chip{display:inline-block;margin-top:8px;padding:2px 10px;border-radius:999px;background:color-mix(in srgb,var(--accent) 18%,transparent);color:var(--accent);font-size:12px;font-weight:600}
.info{display:flex;gap:14px;align-items:center;height:100%}
.info .txt{flex:1;min-width:0}
.info .art{width:38%;max-height:160px;border-radius:12px;align-self:stretch}
.info.side-left{flex-direction:row-reverse}
.info.side-top{flex-direction:column-reverse;align-items:stretch}
.info.side-top .art{width:100%;max-height:180px}
.info.side-background{position:relative;min-height:120px}
.info.side-background .art{position:absolute;inset:-16px;width:calc(100% + 32px);max-height:none;height:calc(100% + 32px);border-radius:0;opacity:.45}
.info.side-background .txt{position:relative}
blockquote{margin:0;font-size:20px;font-weight:600;line-height:1.35;overflow-wrap:anywhere}
[dir=rtl] blockquote{line-height:1.6}
.quote.center{text-align:center}
.prog .row{display:flex;align-items:center;gap:12px}
.prog .txt{flex:1;min-width:0}
.num{font-variant-numeric:tabular-nums;color:var(--muted);font-size:14px}
.bar{height:8px;border-radius:99px;background:var(--line);margin-top:12px;overflow:hidden}
.bar span{display:block;height:100%;border-radius:99px;background:var(--accent)}
.grid{display:grid;gap:8px}.g1{grid-template-columns:1fr}.g2{grid-template-columns:repeat(2,1fr)}.g3{grid-template-columns:repeat(3,1fr)}.g4{grid-template-columns:repeat(4,1fr)}
.list{display:flex;flex-direction:column;gap:2px}
.it{display:flex;align-items:center;gap:10px;padding:8px;border-radius:10px;text-decoration:none;color:inherit;min-width:0}
a.it:hover{background:color-mix(in srgb,var(--accent) 10%,transparent)}
.it-grid{position:relative;flex-direction:column;align-items:flex-start;background:color-mix(in srgb,var(--text) 4%,transparent);padding:10px}
.it-grid .go{position:absolute;top:10px;inset-inline-end:12px}
.it-text{display:flex;flex-direction:column;min-width:0;flex:1}
.it-title{font-weight:600;overflow-wrap:anywhere}
.it-sub{color:var(--muted);font-size:13px;overflow-wrap:anywhere}
.go{color:var(--muted);font-size:14px}
[dir=rtl] .go{transform:scaleX(-1)}
.badges{display:flex;flex-wrap:wrap;gap:6px}
.it-badge{padding:5px 11px;border-radius:999px;background:color-mix(in srgb,var(--accent) 14%,transparent);gap:6px}
.it-badge .it-title{font-size:13px}
.ic{flex:none;border-radius:24%;object-fit:cover}
.ic.emoji{display:inline-grid;place-items:center;line-height:1}
.fields{margin:0;display:grid;gap:8px}
.fields div{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line);padding-bottom:6px}
.fields div:last-child{border-bottom:0}
.fields dt{color:var(--muted)}.fields dd{margin:0;font-weight:600;text-align:end;overflow-wrap:anywhere}
.mediawrap{margin:-16px;height:calc(100% + 32px);min-height:180px;position:relative}
.mediawrap .media{width:100%;height:100%;min-height:180px;display:block}
.mediawrap figcaption{position:absolute;inset-inline:0;bottom:0;padding:10px 16px;color:#fff;background:rgba(0,0,0,.45);font-size:14px}
.st-minimal .mediawrap{margin:0}
.frame{margin:0 auto;position:relative;overflow:hidden;max-height:520px;width:100%;background:var(--line)}
.frame.shadow{box-shadow:0 10px 30px rgba(0,0,0,.25)}
.frame img,.frame video{position:absolute;inset:0;width:100%;height:100%}
.frame .back{filter:blur(24px);transform:scale(1.15);opacity:.7}
.frame .ft{position:absolute;inset-inline:0;padding:10px 14px;color:#fff;font-weight:600;background:rgba(0,0,0,.35)}
.frame .ft.top{top:0}.frame .ft.bottom{bottom:0}
footer{margin-top:36px;padding:0 8px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;color:var(--muted);font-size:13px}
footer a{color:var(--accent);text-decoration:none;font-weight:500}
.empty{max-width:520px;margin:18vh auto 0;padding:0 16px;text-align:center}
.empty h1{margin-bottom:10px}
.empty p{color:var(--muted)}
.btn{display:inline-block;margin-top:14px;padding:10px 18px;border-radius:999px;background:var(--accent);color:#fff;text-decoration:none;font-weight:600}
@media (max-width:720px){
  .c8,.c6,.c12{grid-column:span 12}.c4,.c3{grid-column:span 6}.r2{grid-row:span 1}
  .head{gap:12px;margin-top:-44px}.avatar{width:92px;height:92px}.who{padding-top:50px}
  .g3,.g4{grid-template-columns:repeat(2,1fr)}
  .info{flex-direction:column-reverse;align-items:stretch}.info .art{width:100%}
}
@media (max-width:420px){.c4,.c3{grid-column:span 12}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

function shell(opts: { title: string; description: string; lang: Lang; dir: "ltr" | "rtl"; theme: string; accent: string | null; image: string | null; url: string; body: string; ambient?: string | null; noindex?: boolean }): string {
  const meta = [
    `<meta property="og:title" content="${esc(opts.title)}">`,
    `<meta property="og:description" content="${esc(opts.description)}">`,
    `<meta property="og:type" content="profile">`,
    `<meta property="og:url" content="${esc(opts.url)}">`,
    `<meta property="og:site_name" content="Worlds">`,
    opts.image ? `<meta property="og:image" content="${esc(opts.image)}">` : "",
    `<meta name="twitter:card" content="${opts.image ? "summary_large_image" : "summary"}">`,
    opts.noindex ? `<meta name="robots" content="noindex">` : "",
  ].join("");
  const accent = opts.accent ? `<style>:root,:root[data-theme]{--accent:${esc(opts.accent)}}</style>` : "";
  return `<!doctype html><html lang="${opts.lang}" dir="${opts.dir}"${opts.theme === "light" || opts.theme === "dark" ? ` data-theme="${opts.theme}"` : ""}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(opts.title)}</title><meta name="description" content="${esc(opts.description)}"><link rel="canonical" href="${esc(opts.url)}">${meta}<style>${CSS}</style>${accent}</head><body>${opts.ambient ? `<div class="ambient" style="background-image:url('${esc(opts.ambient)}')"></div>` : ""}${opts.body}</body></html>`;
}

export function renderProfile(p: PublicProfile, origin: string, siteUrl: string): string {
  const lang = langOf(p, null);
  const w = WORDS[lang];
  const dir = directionOf(p);
  const banner = fileSrc(p.banner);
  const avatar = fileSrc(p.avatar);
  const [cx, cy, cz] = String(p.avatarCrop ?? "50,50,1").split(",").map(Number);
  const x = Number.isFinite(cx) ? cx : 50;
  const y = Number.isFinite(cy) ? cy : 50;
  const zoom = Number.isFinite(cz) && cz >= 1 ? Math.min(cz, 4) : 1;
  const avatarStyle = `object-position:${x}% ${y}%;${zoom > 1 ? `transform:scale(${zoom});transform-origin:${x}% ${y}%` : ""}`;
  const initial = [...(p.displayName || p.username)][0]?.toUpperCase() ?? "W";
  const joined = new Date(p.joinedAt);
  const joinedText = `${w.joined} ${MONTHS[lang][joined.getUTCMonth()]} ${joined.getUTCFullYear()}`;
  const links = p.links
    .map((l) => ({ ...l, href: safeHref(l.url) }))
    .filter((l) => l.href)
    .map((l) => {
      const label = linkLabel(l);
      const host = hostOf(l.url);
      return `<a class="link" href="${esc(l.href)}" rel="me noopener nofollow ugc" target="_blank">${esc(label)}${host && host !== label ? ` <small>${esc(host)}</small>` : ""}</a>`;
    })
    .join("");
  const blocks = p.blocks.map((b) => block(b)).join("");
  const bannerArt = banner
    ? isVideo(banner)
      ? `<video src="${esc(banner)}" autoplay muted loop playsinline style="object-fit:cover;object-position:${focusOf(p.bannerFocus)}"></video>`
      : `<img src="${esc(banner)}" alt="" style="object-fit:cover;object-position:${focusOf(p.bannerFocus)}">`
    : "";
  const body = `<main class="page">
<div class="banner">${bannerArt}</div>
<header class="head"><div class="avatar">${avatar && !isVideo(avatar) ? `<img src="${esc(avatar)}" alt="${esc(p.displayName)}" style="${avatarStyle}">` : `<span class="letter" aria-hidden="true">${esc(initial)}</span>`}</div>
<div class="who"><h1>${esc(p.displayName)}</h1><div class="handle">@${esc(p.username)}</div>${p.status ? `<div class="status">${esc(p.status)}</div>` : ""}</div></header>
<section class="about">${p.bio ? `<p class="bio">${esc(p.bio)}</p>` : ""}<div class="meta">${p.location ? `<span>${esc(p.location)}</span>` : ""}<span>${esc(joinedText)}</span></div></section>
${links ? `<nav class="links" aria-label="${esc(w.links)}">${links}</nav>` : ""}
${blocks ? `<div class="blocks">${blocks}</div>` : ""}
<footer><span>${esc(w.made)}</span><a href="${esc(siteUrl)}">${esc(w.get)}</a></footer>
</main>`;
  const description = p.bio ?? p.status ?? `@${p.username}`;
  return shell({
    title: `${p.displayName} (@${p.username})`,
    description: description.slice(0, 200),
    lang,
    dir,
    theme: p.theme,
    accent: p.accent,
    image: avatar && !isVideo(avatar) ? `${origin}${avatar}` : banner && !isVideo(banner) ? `${origin}${banner}` : null,
    url: `${origin}/@${p.username}`,
    body,
    ambient: banner && !isVideo(banner) ? banner : null,
  });
}

export function renderMissing(origin: string, siteUrl: string, accept: string | null, home = false): string {
  const lang = langOf(null, accept);
  const w = WORDS[lang];
  const title = home ? w.homeTitle : w.missingTitle;
  return shell({
    title,
    description: home ? w.home : w.missing,
    lang,
    dir: lang === "ar" ? "rtl" : "ltr",
    theme: "auto",
    accent: null,
    image: null,
    url: origin,
    noindex: !home,
    body: `<main class="empty"><h1>${esc(title)}</h1><p>${esc(home ? w.home : w.missing)}</p><a class="btn" href="${esc(siteUrl)}">${esc(w.open)}</a></main>`,
  });
}

const SECURITY: Record<string, string> = {
  "content-security-policy": "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};

export interface ProfileEnv {
  SITE_URL?: string;
}

/** Everything under profile.<domain>. `call` reaches the identity service with the edge headers. */
export async function handleProfile(request: Request, env: ProfileEnv, call: (path: string) => Promise<Response>): Promise<Response> {
  const url = new URL(request.url);
  const origin = `https://${url.host}`;
  const site = env.SITE_URL || `https://${url.host.replace(/^profile\./, "")}`;
  const accept = request.headers.get("accept-language");
  const html = (status: number, page: string, cache = "public, max-age=60") =>
    new Response(request.method === "HEAD" ? null : page, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": cache, ...SECURITY } });
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });

  const path = url.pathname;
  if (path === "/" || path === "") return html(200, renderMissing(origin, site, accept, true), "public, max-age=3600");
  if (path === "/robots.txt") return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });
  if (path.startsWith("/files/p/")) {
    const r = await call(`/profiles${path}`);
    if (!r.ok) return new Response("Not found", { status: 404, headers: SECURITY });
    const headers = new Headers(r.headers);
    for (const [k, v] of Object.entries(SECURITY)) headers.set(k, v);
    return new Response(r.body, { status: 200, headers });
  }
  const m = /^\/(@?)([A-Za-z0-9._]{3,20})\/?$/.exec(decodeURIComponent(path));
  if (!m) return html(404, renderMissing(origin, site, accept), "public, max-age=60");
  const name = m[2].toLowerCase();
  if (!m[1] || m[2] !== name || path.endsWith("/")) return Response.redirect(`${origin}/@${name}`, 301);
  const r = await call(`/profiles/${encodeURIComponent(name)}`);
  if (r.status === 404) return html(404, renderMissing(origin, site, accept), "public, max-age=30");
  if (!r.ok) return html(502, renderMissing(origin, site, accept), "no-store");
  const p = (await r.json()) as PublicProfile;
  return html(200, renderProfile(p, origin, site));
}
