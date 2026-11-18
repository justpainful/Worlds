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

/* The page mirrors the app's profile (src/styles/profile.css): the same banner-lit
 * canvas, avatar, names, links row and the 12-column block grid with its styles. */

/** Lucide geometry (ISC), the same set the app draws its icons from. */
const GLYPHS: Record<string, string> = {
  globe: `<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>`,
  link: `<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>`,
  external: `<path d="M7 7h10v10"/><path d="M7 17 17 7"/>`,
  calendar: `<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>`,
};

function glyph(name: keyof typeof GLYPHS, size = 13): string {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPHS[name]}</svg>`;
}

function icon(ref: unknown, size = 28): string {
  if (typeof ref !== "string" || !ref) return "";
  const src = fileSrc(ref);
  if (src) return `<img class="ic" src="${esc(src)}" width="${size}" height="${size}" alt="" loading="lazy">`;
  // An emoji or a short symbol; product icons were turned into files when published.
  if (ref.startsWith("pi:") || ref.startsWith("img:") || ref.length > 8) return "";
  return `<span class="ic emoji" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.8)}px">${esc(ref)}</span>`;
}

const fitOf = (fit: unknown, fallback: string) => (fit === "original" ? "none" : fit === "contain" || fit === "whole" ? "contain" : fit === "cover" || fit === "fill" ? "cover" : fallback);

function media(src: string, cls: string, style: string, lazy = true): string {
  return isVideo(src)
    ? `<video class="${cls}" src="${esc(src)}" autoplay muted loop playsinline style="${style}"></video>`
    : `<img class="${cls}" src="${esc(src)}" alt=""${lazy ? ` loading="lazy"` : ""} style="${style}">`;
}

/** The app's <Art>: a picture beside, above or behind a block's text. */
function art(ref: unknown, side: string, fit: unknown, focus: unknown): string {
  const src = fileSrc(ref);
  if (!src) return "";
  return `<div class="pb-art pb-art-${side}">${media(src, "", `object-fit:${fitOf(fit, "contain")};object-position:${focusOf(focus)}`)}</div>`;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const items = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]).filter((x) => x && typeof x === "object") : []);

function label(text: unknown, ic?: unknown): string {
  return text ? `<div class="pb-label">${icon(ic, 16)}<span>${esc(text)}</span></div>` : "";
}

function itemRow(it: Record<string, unknown>, size: number): string {
  const href = safeHref(it.url);
  const inner =
    (it.icon ? `<span class="pb-item-icon" style="width:${size}px;height:${size}px">${icon(it.icon, size)}</span>` : "") +
    `<span class="pb-item-text"><span class="pb-item-title">${esc(it.title)}</span>${it.subtitle ? `<span class="pb-item-sub">${esc(it.subtitle)}</span>` : ""}</span>`;
  return href ? `<a class="pb-item is-link" href="${esc(href)}" rel="noopener nofollow ugc" target="_blank">${inner}</a>` : `<div class="pb-item">${inner}</div>`;
}

const SIZE: Record<string, [number, number]> = { "12x1": [12, 1], "12x2": [12, 2], "8x1": [8, 1], "6x1": [6, 1], "6x2": [6, 2], "4x1": [4, 1], "3x1": [3, 1] };
const STYLES = new Set(["soft", "tinted", "solid", "compact", "showcase", "minimal"]);
const FRAME_RATIO: Record<string, number> = { square: 1, large: 1, circle: 1, classic: 4 / 3, upright: 3 / 4, phone: 9 / 16, portrait: 1 / 2.1, column: 0.95 / 2.85, wide: 2.1, pano: 3 };
const SIDES = ["left", "right", "top", "background"];

/** Cross-fading slides like the app's frame slideshow, in CSS so the page runs no script for it. */
function slideshow(n: number, interval: number): { name: string; css: string } {
  const period = n * interval;
  const pct = (s: number) => +((s / period) * 100).toFixed(3);
  const name = `fr${n}x${interval}`;
  return { name, css: `@keyframes ${name}{0%{opacity:0}${pct(0.9)}%{opacity:1}${pct(interval)}%{opacity:1}${pct(interval + 0.9)}%{opacity:0}100%{opacity:0}}` };
}

function frame(b: Record<string, unknown>): string {
  const photos = (Array.isArray(b.photos) ? b.photos : []).map(fileSrc).filter((p): p is string => !!p).slice(0, 12);
  if (!photos.length) return "";
  const shape = str(b.shape) || "auto";
  const ratio = FRAME_RATIO[shape];
  const radius = shape === "circle" ? "50%" : `${Math.max(0, Math.min(80, Number(b.radius) || 0))}px`;
  const whole = b.fit === "whole";
  const pos = focusOf(b.focus);
  const n = photos.length;
  const interval = Math.max(3, Math.min(60, Math.round(Number(b.interval) || 8)));
  const show = n > 1 ? slideshow(n, interval) : null;
  const slides = photos
    .map((p, k) => {
      const anim = show ? ` style="animation:${show.name} ${n * interval}s linear ${k * interval - 0.9}s infinite"` : "";
      return `<div class="frame-slide${k === 0 ? " is-first" : ""}"${anim}>${whole ? media(p, "frame-back", "", k > 0) : ""}${media(p, "frame-img", `object-fit:${whole ? "contain" : "cover"};object-position:${pos}`, k > 0)}</div>`;
    })
    .join("");
  // "Auto" keeps the picture's own shape: an invisible copy of the first photo sizes the frame.
  const sizer = ratio ? "" : isVideo(photos[0]) ? "" : `<img class="frame-sizer" src="${esc(photos[0])}" alt="">`;
  const style = `border-radius:${radius};${ratio ? `aspect-ratio:${ratio}` : isVideo(photos[0]) ? "aspect-ratio:1" : ""}`;
  const text = b.text ? `<div class="frame-text is-${b.textPos === "top" ? "top" : "bottom"}"><span dir="auto">${esc(b.text)}</span></div>` : "";
  const dots = n > 1 ? `<div class="frame-dots" aria-hidden="true">${photos.map(() => "<span></span>").join("")}</div>` : "";
  return `${show ? `<style>${show.css}</style>` : ""}<div class="frame-art${b.shadow ? " has-shadow" : ""} fit-${whole ? "whole" : "fill"}" style="${style}">${sizer}${slides}${text}${dots}</div>`;
}

export function block(b: Record<string, unknown>): string {
  const [cols, rows] = SIZE[str(b.size)] ?? [12, 1];
  const style = STYLES.has(str(b.style)) ? str(b.style) : "solid";
  const accent = /^#[0-9a-f]{6}$/i.test(str(b.accent)) ? str(b.accent) : "";
  let body = "";
  switch (b.type) {
    case "info": {
      const side = SIDES.includes(str(b.imageSide)) ? str(b.imageSide) : "right";
      const a = art(b.image, side, b.imageFit, b.focus);
      body = `${a}<div class="pb-hero${a ? ` has-art-${side}` : ""}">${label(b.label, b.labelIcon)}<div class="pb-title-row"><h3 class="pb-title">${esc(b.title)}</h3>${b.badge ? `<span class="pb-badge">${esc(b.badge)}</span>` : ""}</div>${b.subtitle ? `<div class="pb-subtitle">${esc(b.subtitle)}</div>` : ""}</div>`;
      break;
    }
    case "quote": {
      const side = SIDES.includes(str(b.imageSide)) ? str(b.imageSide) : "right";
      const a = art(b.image, side, b.imageFit, b.focus);
      body = `${a}<div class="pb-hero pb-quote-body align-${b.align === "center" ? "center" : "start"}${a ? ` has-art-${side}` : ""}">${label(b.label, b.labelIcon)}<div class="pb-statement">${esc(b.statement)}</div>${b.subtext ? `<div class="pb-subtitle">${esc(b.subtext)}</div>` : ""}</div>`;
      break;
    }
    case "progress": {
      const max = Number(b.max) > 0 ? Number(b.max) : 100;
      const value = Math.max(0, Math.min(max, Number(b.value) || 0));
      const pct = Math.round((value / max) * 100);
      const shown = b.display === "none" ? "" : b.display === "percent" ? `${pct}%` : `${value}/${max}`;
      body = `<div class="pb-progress">${b.icon ? `<span class="pb-tile">${icon(b.icon, 44)}</span>` : ""}<div class="pb-progress-main"><div class="pb-bar" role="progressbar" aria-valuenow="${value}" aria-valuemax="${max}"><span style="width:${pct}%"></span></div><div class="pb-progress-row"><div><div class="pb-item-title">${esc(b.title)}</div>${b.caption ? `<div class="pb-item-sub">${esc(b.caption)}</div>` : ""}</div>${shown ? `<span class="pb-progress-value">${esc(shown)}</span>` : ""}</div></div></div>`;
      break;
    }
    case "grid": {
      const n = [1, 2, 3, 4].includes(Number(b.columns)) ? Number(b.columns) : 2;
      body = `<div class="pb-section">${label(b.title)}<div class="pb-grid g${n}">${items(b.items).map((it) => itemRow(it, 48)).join("")}</div></div>`;
      break;
    }
    case "list":
      body = `<div class="pb-section">${label(b.title)}<div class="pb-list">${items(b.items).map((it) => itemRow(it, 36)).join("")}</div></div>`;
      break;
    case "links":
      body = `<div class="pb-section">${label(b.title)}<div class="pb-links">${items(b.links)
        .map((l) => {
          const href = safeHref(l.url);
          const inner = `${l.icon ? icon(l.icon, 20) : glyph("link", 14)}<span>${esc(l.title)}</span>${glyph("external", 12)}`;
          return href ? `<a class="pb-link" href="${esc(href)}" rel="noopener nofollow ugc" target="_blank">${inner}</a>` : `<span class="pb-link">${inner}</span>`;
        })
        .join("")}</div></div>`;
      break;
    case "badges":
      body = `<div class="pb-section">${label(b.title)}<div class="pb-badges">${items(b.badges)
        .map((x) => `<span class="pb-badge-item"${x.subtitle ? ` title="${esc(x.subtitle)}"` : ""}>${icon(x.icon, 28)}<span>${esc(x.title)}</span></span>`)
        .join("")}</div></div>`;
      break;
    case "fields":
      body = `<div class="pb-section">${label(b.title)}<dl class="pb-fields">${items(b.fields)
        .map((f) => `<div class="pb-field"><dt>${esc(f.key)}</dt><dd>${esc(f.value)}</dd></div>`)
        .join("")}</dl></div>`;
      break;
    case "media": {
      const src = fileSrc(b.media);
      if (!src) return "";
      body = `<div class="pb-media"><div class="pb-art pb-art-background">${media(src, "", `object-fit:${fitOf(b.fit, "cover")};object-position:${focusOf(b.focus)}`)}</div>${b.caption ? `<div class="pb-media-caption">${esc(b.caption)}</div>` : ""}</div>`;
      break;
    }
    case "frame":
      body = frame(b);
      if (!body) return "";
      break;
    default:
      // Live blocks (streaks, activity) only make sense inside the app.
      return "";
  }
  const href = safeHref(b.url);
  const tag = href ? "a" : "section";
  const attrs = href ? ` href="${esc(href)}" rel="noopener nofollow ugc" target="_blank"` : "";
  const css = `grid-column:span ${cols};grid-row:span ${rows}${accent ? `;--pb-accent:${esc(accent)}` : ""}`;
  return `<${tag} class="pblock pbt-${esc(b.type)} pb-style-${style} pb-size-${cols}-${rows}${href ? " is-clickable" : ""}" style="${css}"${attrs}>${body}</${tag}>`;
}

function langOf(p: { language?: string } | null, accept: string | null): Lang {
  const l = p?.language ?? accept ?? "";
  return /^ar\b/i.test(l) ? "ar" : "en";
}

const CSS = `
:root{--text-1:rgba(245,245,247,.94);--text-2:rgba(235,235,245,.62);--text-3:rgba(235,235,245,.5);--text-4:rgba(235,235,245,.24);--accent:#0a84ff;--banner-rgb:120,110,140;--banner-deep:32,30,38;--ring:rgba(255,255,255,.3);--font-ui:"Segoe UI Variable Text","Segoe UI",-apple-system,BlinkMacSystemFont,system-ui,"IBM Plex Sans Arabic","SF Arabic","Noto Sans Arabic",Tahoma,sans-serif;--spring:cubic-bezier(.2,.7,.2,1);color-scheme:dark}
:root.light-banner{--ring:rgba(0,0,0,.32)}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:rgb(var(--banner-deep));color:var(--text-1)}
body{font:450 15px/1.5 var(--font-ui);-webkit-font-smoothing:antialiased;min-height:100vh}
a{color:inherit;text-decoration:none}
a:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:6px}
.pf{position:relative;min-height:100vh;overflow-x:clip}
.pf-canvas{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0}
.pf-ambient{position:absolute;left:-15%;top:-10%;width:130%;height:1100px;object-fit:cover;filter:blur(90px) saturate(1.5);opacity:.42;-webkit-mask-image:linear-gradient(#000 0%,rgba(0,0,0,.6) 45%,transparent 100%);mask-image:linear-gradient(#000 0%,rgba(0,0,0,.6) 45%,transparent 100%)}
.light-banner .pf-ambient{opacity:.26}
.pf-canvas::after{content:"";position:absolute;inset:0;background:linear-gradient(rgba(var(--banner-deep),.25) 0px,rgba(var(--banner-deep),.55) 420px,rgb(var(--banner-deep)) 980px)}
.pf-banner{position:relative;z-index:1;height:240px;overflow:hidden;-webkit-mask-image:linear-gradient(#000 calc(100% - 90px),transparent);mask-image:linear-gradient(#000 calc(100% - 90px),transparent)}
.pf-banner.has-art{height:var(--banner-h,clamp(220px,34vh,470px))}
.pf-banner-img{display:block;width:100%;height:100%;object-fit:cover}
.pf-banner-empty{width:100%;height:100%;background:radial-gradient(80% 120% at 30% 0%,rgba(var(--banner-rgb),.35),transparent 70%)}
.pf-body{position:relative;z-index:2;margin-top:-84px}
.pf-column{position:relative;max-width:980px;margin:0 auto;padding:0 clamp(16px,5vw,44px) 72px;container-type:inline-size}
.pf-avatar{display:inline-block;padding:4px;border-radius:50%;background:var(--ring);box-shadow:0 10px 30px rgba(0,0,0,.35);-webkit-backdrop-filter:blur(18px) saturate(1.4);backdrop-filter:blur(18px) saturate(1.4)}
.avatar{display:grid;place-items:center;width:132px;height:132px;border-radius:50%;overflow:hidden;background:linear-gradient(160deg,#3a3a40,#2a2a2e);font:600 44px/1 var(--font-ui);color:#fff}
.avatar img{width:100%;height:100%;object-fit:cover;display:block}
.pf-names{margin-top:14px;display:flex;flex-direction:column;gap:3px}
.pf-name{margin:0;font:700 34px/1.12 var(--font-ui);letter-spacing:-.02em;overflow-wrap:anywhere}
[dir=rtl] .pf-name{letter-spacing:0;line-height:1.35}
.pf-handle{font:500 15px/1.35 var(--font-ui);color:var(--text-3)}
.pf-presence{display:inline-flex;align-items:center;gap:7px;margin-top:6px;font:450 13px/1.4 var(--font-ui);color:var(--text-2)}
.pf-presence-dot{width:7px;height:7px;border-radius:50%;background:#3ddc84;box-shadow:0 0 8px rgba(61,220,132,.7)}
.pf-bio{margin:16px 0 0;max-width:640px;font:400 15.5px/1.55 var(--font-ui);white-space:pre-wrap;overflow-wrap:anywhere}
[dir=rtl] .pf-bio{line-height:1.8}
.pf-links{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:12px}
.pf-link{display:inline-flex;align-items:center;gap:6px;font:450 13px/1.4 var(--font-ui);color:var(--text-2);transition:color 110ms var(--spring)}
.pf-link .icon{color:var(--text-3);flex:none}
a.pf-link:hover{color:var(--text-1);text-decoration:underline;text-underline-offset:3px}
.pf-blocks{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));grid-auto-rows:minmax(124px,auto);gap:14px;margin-top:30px}
@container (max-width:760px){.pf-blocks>*{grid-column:span 6!important}.pf-blocks>.pb-size-12-1,.pf-blocks>.pb-size-12-2{grid-column:span 12!important}}
@container (max-width:520px){.pf-blocks>*{grid-column:span 12!important;grid-row:auto!important}}
.pblock{position:relative;display:block;border-radius:24px;overflow:hidden;min-height:124px;color:var(--text-1);--pb-accent:rgb(var(--banner-rgb))}
.pblock.is-clickable{cursor:pointer}
.pb-style-solid,.pb-style-compact,.pb-style-showcase{background:linear-gradient(180deg,#202326,#1a1c1f);box-shadow:inset 0 0 0 1px rgba(255,255,255,.06),0 6px 18px rgba(0,0,0,.18)}
.pb-style-soft,.pb-style-tinted{background:rgba(255,255,255,.06);-webkit-backdrop-filter:blur(24px) saturate(1.6);backdrop-filter:blur(24px) saturate(1.6);box-shadow:inset 0 0 0 .5px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.14),inset 0 0 0 1px rgba(255,255,255,.06)}
.pb-style-tinted{background:linear-gradient(135deg,color-mix(in srgb,var(--pb-accent) 30%,transparent),transparent 75%),rgba(255,255,255,.05)}
.pb-style-minimal{background:none;min-height:0}
.pb-style-minimal .pb-hero,.pb-style-minimal .pb-section,.pb-style-minimal .pb-progress{padding-left:2px;padding-right:2px}
.pb-style-compact{min-height:0}
.pb-style-compact .pb-hero,.pb-style-compact .pb-section,.pb-style-compact .pb-progress{padding:12px 14px}
.pb-style-compact .pb-title,.pb-style-compact .pb-statement{font-size:17px;margin-top:8px}
.pb-style-showcase .pb-title,.pb-style-showcase .pb-statement{font-size:28px;letter-spacing:-.02em}
.pb-style-showcase .pb-art{width:58%}
.pb-style-showcase .pb-hero.has-art-right{padding-right:56%}
.pb-art{position:absolute;top:0;bottom:0;width:46%;pointer-events:none;z-index:0}
.pb-art img,.pb-art video{width:100%;height:100%;display:block}
.pb-art-right{right:0;-webkit-mask-image:linear-gradient(to left,#000 55%,transparent);mask-image:linear-gradient(to left,#000 55%,transparent)}
.pb-art-left{left:0;-webkit-mask-image:linear-gradient(to right,#000 55%,transparent);mask-image:linear-gradient(to right,#000 55%,transparent)}
.pb-art-background{inset:0;width:100%}
.pb-art-top{left:0;right:0;width:100%;bottom:40%;-webkit-mask-image:linear-gradient(#000 50%,transparent);mask-image:linear-gradient(#000 50%,transparent)}
.pb-hero{position:relative;z-index:1;padding:20px 22px;display:flex;flex-direction:column;height:100%}
.pb-hero.has-art-right{padding-right:44%}
.pb-hero.has-art-left{padding-left:44%}
.pb-hero.has-art-background{text-shadow:0 1px 12px rgba(0,0,0,.6)}
.pb-label{display:flex;align-items:center;gap:7px;font:600 13px/1.3 var(--font-ui)}
.pb-title-row{display:flex;align-items:center;gap:8px;margin-top:auto;padding-top:18px}
.pb-title{margin:0;font:600 21px/1.25 var(--font-ui);letter-spacing:-.01em;overflow-wrap:anywhere}
.pb-subtitle{margin-top:4px;font:450 13px/1.4 var(--font-ui);color:var(--text-3)}
.pb-badge{padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--pb-accent) 24%,transparent);font:500 11.5px/1.35 var(--font-ui)}
.pb-quote-body .pb-statement{margin-top:auto;padding-top:18px;font:600 22px/1.25 var(--font-ui);letter-spacing:-.01em;overflow-wrap:anywhere}
.pb-quote-body.align-center{align-items:center;text-align:center}
[dir=rtl] .pb-title,[dir=rtl] .pb-statement,[dir=rtl] .pf-name{letter-spacing:0}
[dir=rtl] .pb-title,[dir=rtl] .pb-quote-body .pb-statement{line-height:1.5}
.pb-progress{position:relative;display:flex;align-items:center;gap:14px;padding:18px 20px;height:100%}
.pb-tile{flex:none;width:54px;height:54px;display:grid;place-items:center;border-radius:15px;background:rgba(255,255,255,.05);box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}
.pb-progress-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:9px}
.pb-bar{height:7px;border-radius:999px;background:rgba(255,255,255,.12);overflow:hidden}
.pb-bar span{display:block;height:100%;border-radius:inherit;background:#f2f2f2}
.pb-style-tinted .pb-bar span,.pblock[style*="--pb-accent:#"] .pb-bar span{background:var(--pb-accent)}
.pb-progress-row{display:flex;align-items:flex-end;justify-content:space-between;gap:10px}
.pb-progress-value{font:600 14px/1.2 var(--font-ui);font-variant-numeric:tabular-nums}
.pb-section{position:relative;padding:18px 20px;display:flex;flex-direction:column;gap:14px}
.pb-grid{display:grid;gap:16px 22px}.g1{grid-template-columns:minmax(0,1fr)}.g2{grid-template-columns:repeat(2,minmax(0,1fr))}.g3{grid-template-columns:repeat(3,minmax(0,1fr))}.g4{grid-template-columns:repeat(4,minmax(0,1fr))}
.pb-list{display:flex;flex-direction:column;gap:12px}
.pb-item{display:flex;align-items:center;gap:13px;min-width:0}
a.pb-item:hover .pb-item-title{text-decoration:underline;text-underline-offset:3px}
.pb-item-icon{flex:none;display:grid;place-items:center}
.pb-item-text{display:flex;flex-direction:column;gap:2px;min-width:0}
.pb-item-title{font:600 14.5px/1.3 var(--font-ui);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pb-item-sub{font:450 12.5px/1.4 var(--font-ui);color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pb-media{position:absolute;inset:0}
.pb-media .pb-art{width:100%;-webkit-mask-image:none;mask-image:none}
.pb-media-caption{position:absolute;left:0;right:0;bottom:0;padding:30px 18px 14px;font:450 12.5px/1.4 var(--font-ui);color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.6))}
.pb-fields{margin:0;display:flex;flex-direction:column}
.pb-field{display:flex;justify-content:space-between;gap:16px;padding:8px 0;border-bottom:.5px solid rgba(255,255,255,.08)}
.pb-field:last-child{border-bottom:0}
.pb-field dt{font:450 12.5px/1.4 var(--font-ui);color:var(--text-3)}
.pb-field dd{margin:0;font:600 13.5px/1.35 var(--font-ui);text-align:end;overflow-wrap:anywhere}
.pb-links{display:flex;flex-wrap:wrap;gap:8px}
.pb-link{display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 14px 0 10px;border-radius:999px;background:rgba(255,255,255,.08);font:600 13.5px/1.35 var(--font-ui);transition:background-color 110ms var(--spring)}
a.pb-link:hover{background:rgba(255,255,255,.15)}
.pb-link>.icon:last-child{color:var(--text-3)}
[dir=rtl] .pb-link>.icon:last-child{transform:scaleX(-1)}
.pb-badges{display:flex;flex-wrap:wrap;gap:12px}
.pb-badge-item{display:flex;flex-direction:column;align-items:center;gap:6px;width:70px;font:500 11.5px/1.35 var(--font-ui);color:var(--text-2);text-align:center}
.ic{flex:none;border-radius:24%;object-fit:cover}
.ic.emoji{display:inline-grid;place-items:center;line-height:1}
.pblock.pbt-frame{background:none;box-shadow:none;overflow:visible;min-height:0;border-radius:0;align-self:start}
.frame-art{position:relative;width:100%;overflow:hidden;isolation:isolate;background:rgba(255,255,255,.04);container-type:inline-size}
.frame-art.has-shadow{box-shadow:0 2px 4px rgba(0,0,0,.18),0 10px 26px rgba(0,0,0,.32),0 22px 48px rgba(0,0,0,.18)}
.frame-sizer{display:block;width:100%;height:auto;max-height:300vw;visibility:hidden}
.frame-slide{position:absolute;inset:0;opacity:0}
.frame-slide.is-first{opacity:1}
.frame-slide[style]{opacity:0}
.frame-img{position:absolute;inset:0;width:100%;height:100%;display:block}
.frame-back{position:absolute;inset:-12%;width:124%;height:124%;object-fit:cover;filter:blur(26px) brightness(.66) saturate(1.2)}
.frame-text{position:absolute;left:0;right:0;z-index:2;padding:16px;font:700 clamp(14px,4cqw,26px)/1.2 var(--font-ui);color:#fff}
.frame-text.is-bottom{bottom:0;padding-top:44px;background:linear-gradient(transparent,rgba(0,0,0,.7))}
.frame-text.is-top{top:0;padding-bottom:44px;background:linear-gradient(rgba(0,0,0,.7),transparent)}
.frame-dots{position:absolute;z-index:3;left:50%;bottom:10px;transform:translateX(-50%);display:flex;gap:5px;padding:4px 7px;border-radius:999px;background:rgba(0,0,0,.32)}
.frame-dots span{width:5px;height:5px;border-radius:50%;background:rgba(255,255,255,.45)}
footer{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-top:44px;font:450 12.5px/1.4 var(--font-ui);color:var(--text-3)}
footer a{color:var(--text-2);font-weight:600}
footer a:hover{color:var(--text-1)}
.empty{position:relative;z-index:1;max-width:520px;margin:18vh auto 0;padding:0 16px;text-align:center}
.empty h1{margin:0 0 10px;font:700 28px/1.2 var(--font-ui)}
.empty p{color:var(--text-2)}
.btn{display:inline-block;margin-top:14px;padding:10px 18px;border-radius:999px;background:#f4f2ee;color:#111;font-weight:600}
@media (max-width:600px){.pf-body{margin-top:-64px}.avatar{width:104px;height:104px;font-size:36px}.pf-name{font-size:28px}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}.frame-slide[style]{animation:none!important}.frame-slide.is-first[style]{opacity:1}}
`;

/**
 * The app samples the banner for its colour (src/profile/bannerColor.ts) and sizes
 * the banner by the picture's proportions (src/media/crop.ts bannerHeight). The page
 * does the same once the banner loads; it is the only script the page runs.
 */
export const TONE_SCRIPT = `(function(){var i=document.querySelector("img.pf-banner-img");if(!i)return;var R=document.documentElement;function run(){try{var bw=i.parentNode.offsetWidth||900,vh=innerHeight,mx=Math.max(220,Math.min(vh*.44,470)),h=Math.min(mx,Math.max(220,bw*i.naturalHeight/Math.max(1,i.naturalWidth))),sm=i.naturalHeight*1.6/(devicePixelRatio||1);if(h>sm)h=Math.max(220,sm);R.style.setProperty("--banner-h",Math.round(h)+"px");var W=48,H=Math.max(8,Math.round(i.naturalHeight/Math.max(1,i.naturalWidth)*W)),c=document.createElement("canvas");c.width=W;c.height=H;var x=c.getContext("2d");x.drawImage(i,0,0,W,H);var d=x.getImageData(0,0,W,H).data,r=0,g=0,b=0,s=0,L=0,n=0;for(var y=0;y<H;y++)for(var z=0;z<W;z++){var k=(y*W+z)*4,a=d[k],e=d[k+1],f=d[k+2],hi=Math.max(a,e,f)/255,lo=Math.min(a,e,f)/255,l=(hi+lo)/2,t=hi===lo?0:l>.5?(hi-lo)/(2-hi-lo):(hi-lo)/(hi+lo),w=(.15+t*t)*(l>.08&&l<.92?1:.1);r+=a*w;g+=e*w;b+=f*w;s+=w;if(y>H*.6){L+=(.2126*a+.7152*e+.0722*f)/255;n++}}r/=s;g/=s;b/=s;var raw=[r,g,b].map(function(v){return v*.32+14}),q=Math.min(1,46/Math.max.apply(null,raw));R.style.setProperty("--banner-rgb",[r,g,b].map(Math.round).join(","));R.style.setProperty("--banner-deep",raw.map(function(v){return Math.round(v*q)}).join(","));if(n&&L/n>.62)R.classList.add("light-banner")}catch(_){}}if(i.complete&&i.naturalWidth)run();else i.addEventListener("load",run)})();`;

function shell(opts: { title: string; description: string; lang: Lang; dir: "ltr" | "rtl"; accent: string | null; image: string | null; url: string; body: string; script?: boolean; noindex?: boolean }): string {
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
  const accent = opts.accent ? `<style>:root{--accent:${esc(opts.accent)}}</style>` : "";
  return `<!doctype html><html lang="${opts.lang}" dir="${opts.dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#1e1d24"><title>${esc(opts.title)}</title><meta name="description" content="${esc(opts.description)}"><link rel="canonical" href="${esc(opts.url)}">${meta}<style>${CSS}</style>${accent}</head><body>${opts.body}${opts.script ? `<script>${TONE_SCRIPT}</script>` : ""}</body></html>`;
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
    .map((l) => `<a class="pf-link" href="${esc(l.href)}" rel="me noopener nofollow ugc" target="_blank">${glyph("link")}<span>${esc(linkLabel(l))}</span></a>`)
    .join("");
  const blocks = p.blocks.map((b) => block(b)).join("");
  const stillBanner = banner && !isVideo(banner) ? banner : null;
  const bannerArt = banner
    ? isVideo(banner)
      ? `<video class="pf-banner-img" src="${esc(banner)}" autoplay muted loop playsinline style="object-position:${focusOf(p.bannerFocus)}"></video>`
      : `<img class="pf-banner-img" src="${esc(banner)}" alt="" style="object-position:${focusOf(p.bannerFocus)}">`
    : `<div class="pf-banner-empty"></div>`;
  const body = `<div class="pf">
<div class="pf-canvas" aria-hidden="true">${stillBanner ? `<img class="pf-ambient" src="${esc(stillBanner)}" alt="">` : ""}</div>
<div class="pf-banner${banner ? " has-art" : ""}">${bannerArt}</div>
<div class="pf-body"><main class="pf-column">
<header><div class="pf-avatar"><div class="avatar">${avatar && !isVideo(avatar) ? `<img src="${esc(avatar)}" alt="${esc(p.displayName)}" style="${avatarStyle}">` : `<span aria-hidden="true">${esc(initial)}</span>`}</div></div>
<div class="pf-names"><h1 class="pf-name">${esc(p.displayName)}</h1><div class="pf-handle"><bdi dir="ltr">@${esc(p.username)}</bdi></div>${p.status ? `<div class="pf-presence" dir="auto"><span class="pf-presence-dot"></span>${esc(p.status)}</div>` : ""}</div></header>
${p.bio ? `<p class="pf-bio" dir="auto">${esc(p.bio)}</p>` : ""}
<nav class="pf-links" aria-label="${esc(w.links)}">${p.location ? `<span class="pf-link">${glyph("globe")}<span>${esc(p.location)}</span></span>` : ""}${links}<span class="pf-link">${glyph("calendar")}<span>${esc(joinedText)}</span></span></nav>
${blocks ? `<div class="pf-blocks">${blocks}</div>` : ""}
<footer><span>${esc(w.made)}</span><a href="${esc(siteUrl)}">${esc(w.get)}</a></footer>
</main></div>
</div>`;
  const description = p.bio ?? p.status ?? `@${p.username}`;
  return shell({
    title: `${p.displayName} (@${p.username})`,
    description: description.slice(0, 200),
    lang,
    dir,
    accent: p.accent,
    image: avatar && !isVideo(avatar) ? `${origin}${avatar}` : stillBanner ? `${origin}${stillBanner}` : null,
    url: `${origin}/@${p.username}`,
    body,
    script: !!stillBanner,
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
    accent: null,
    image: null,
    url: origin,
    noindex: !home,
    body: `<div class="pf"><div class="pf-canvas" aria-hidden="true"></div><div class="pf-banner"><div class="pf-banner-empty"></div></div><main class="empty"><h1>${esc(title)}</h1><p>${esc(home ? w.home : w.missing)}</p><a class="btn" href="${esc(siteUrl)}">${esc(w.open)}</a></main></div>`,
  });
}

let scriptHash: Promise<string> | null = null;
/** The CSP names the one script the page may run by its hash. */
function toneHash(): Promise<string> {
  scriptHash ??= crypto.subtle.digest("SHA-256", new TextEncoder().encode(TONE_SCRIPT)).then((d) => btoa(String.fromCharCode(...new Uint8Array(d))));
  return scriptHash;
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
  const hash = await toneHash();
  const html = (status: number, page: string, cache = "public, max-age=60") =>
    new Response(request.method === "HEAD" ? null : page, {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": cache,
        ...SECURITY,
        "content-security-policy": `${SECURITY["content-security-policy"]}; script-src 'sha256-${hash}'`,
      },
    });
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
