// Builds changelog.enterworlds.space from web/changelog/releases into web/changelog/site.
//   node web/changelog/build.mjs
// Each release is a text file (see web/changelog/README.md). Every release gets
// a page and a banner: a map of islands drawn from its own changes, one island
// per area, one house per change, with the same seeded shapes as Cognition's world.
// The build fails on a dash the house style forbids, an unknown area or kind,
// or a line without both languages.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "site");
const SITE = "https://changelog.enterworlds.space";
const MAIN = "https://enterworlds.space";
const STATUS = "https://status.enterworlds.space";
const GITHUB = "https://github.com/justpainful/Worlds";

// Areas keep one colour in every banner, so Cognition is the same island colour in every release.
const AREAS = {
  cognition: ["Cognition", "Cognition", "terra"],
  welcome: ["الترحيب", "Welcome", "terra"],
  pages: ["الصفحات", "Pages", "teal"],
  writing: ["الكتابة", "Writing", "teal"],
  arabic: ["العربية", "Arabic", "teal"],
  search: ["البحث", "Search", "teal"],
  keyboard: ["لوحة المفاتيح", "Keyboard", "teal"],
  files: ["الملفات والالتقاط", "Files and capture", "teal"],
  study: ["الدراسة والتخطيط", "Study and planning", "ochre"],
  packs: ["الحزم", "Packs", "ochre"],
  drawing: ["الرسم", "Drawing", "ochre"],
  look: ["الشكل والتصميم", "Look and design", "ochre"],
  home: ["الرئيسية", "Home", "ochre"],
  claude: ["Claude والذكاء الاصطناعي", "Claude and AI", "plum"],
  plugins: ["الإضافات", "Plugins", "plum"],
  platforms: ["المنصات", "Platforms", "sage"],
  windows: ["ويندوز", "Windows", "sage"],
  accounts: ["الحسابات والمزامنة", "Accounts and sync", "sage"],
  web: ["الويب", "The web", "sage"],
  publishing: ["النشر والمشاركة", "Publishing and sharing", "sage"],
  profile: ["الملف الشخصي", "Profile", "sage"],
  accessibility: ["سهولة الوصول", "Accessibility", "ink"],
  safety: ["الأمان والحفظ", "Safety and storage", "ink"],
  performance: ["الأداء", "Performance", "ink"],
  fixes: ["إصلاحات عامة", "General fixes", "ink"],
  internals: ["تحت الغطاء", "Under the hood", "ink"],
};
const KINDS = { new: ["إضافة", "Added"], improved: ["تحسين", "Improved"], fixed: ["إصلاح", "Fixed"] };

const T = {
  ar: {
    dir: "rtl", other: "en", otherName: "English", locale: "ar_SA",
    name: "سجل التحديثات", skip: "انتقل إلى المحتوى",
    lead: "كل إصدار من Worlds، بكل تغيير صغير وكبير فيه، من الأحدث إلى الأقدم.",
    nav: [["الموقع", MAIN + "/"], ["الحالة", STATUS + "/"], ["GitHub", GITHUB]],
    latest: "الأحدث", version: "الإصدار", changes: "تغيير", highlights: "الأبرز", all: "كل التغييرات",
    download: "التنزيل من GitHub", notPublished: "صدر ضمن الإصدار التالي", read: "اقرأ التفاصيل",
    areas: "المجالات", prev: "الإصدار الأقدم", next: "الإصدار الأحدث", back: "كل الإصدارات",
    count: (n) => (n === 1 ? "تغيير واحد" : n === 2 ? "تغييران" : n <= 10 ? `${n} تغييرات` : `${n} تغييرًا`),
    areaCount: (n) => (n === 1 ? "مجال واحد" : n === 2 ? "مجالان" : n <= 10 ? `${n} مجالات` : `${n} مجالًا`),
    mapLabel: (v, a, c) => `خريطة الإصدار ${v}: ${a} و${c}، لكل مجال جزيرة ولكل تغيير بيت`,
    feed: "خلاصة التحديثات", fine: "Worlds اسم عمل إبداعي غير مسجل رسميًا. الشيفرة منشورة على GitHub.",
    nf: "ما وجدنا هذه الصفحة.", nfLink: "ارجع إلى سجل التحديثات",
  },
  en: {
    dir: "ltr", other: "ar", otherName: "العربية", locale: "en_US",
    name: "Changelog", skip: "Skip to content",
    lead: "Every Worlds release, with every change large and small, newest first.",
    nav: [["Site", MAIN + "/en/"], ["Status", STATUS + "/en/"], ["GitHub", GITHUB]],
    latest: "Latest", version: "Version", changes: "changes", highlights: "Highlights", all: "Every change",
    download: "Download from GitHub", notPublished: "Shipped in the next release", read: "Read the details",
    areas: "Areas", prev: "Older release", next: "Newer release", back: "All releases",
    count: (n) => (n === 1 ? "1 change" : `${n} changes`),
    areaCount: (n) => (n === 1 ? "1 area" : `${n} areas`),
    mapLabel: (v, a, c) => `Map of release ${v}: ${a} and ${c}, an island for each area and a house for each change`,
    feed: "Changelog feed", fine: "Worlds is a creative working name, not a registered mark. The code is published on GitHub.",
    nf: "We could not find this page.", nfLink: "Back to the changelog",
  },
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const base = (lang) => (lang === "en" ? "/en/" : "/");
const fail = (msg) => { console.error(`changelog: ${msg}`); process.exit(1); };

function dateText(iso, lang) {
  return new Intl.DateTimeFormat(lang === "ar" ? "ar" : "en-GB", { day: "numeric", month: "long", year: "numeric", numberingSystem: "latn", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
}

function pair(text, where) {
  const i = text.indexOf(" || ");
  if (i < 0) fail(`${where}: needs Arabic || English`);
  return { ar: text.slice(0, i).trim(), en: text.slice(i + 4).trim() };
}

function parse(file) {
  const raw = readFileSync(file, "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
  if (/[–—]/.test(raw)) fail(`${file}: an en or em dash`);
  const rel = { groups: [], highlights: [] };
  let group = null;
  raw.split("\n").forEach((line, n) => {
    const where = `${file}:${n + 1}`;
    if (!line.trim()) return;
    if (line.startsWith("# ")) {
      const key = line.slice(2).trim();
      if (key === "highlights") group = { key, items: rel.highlights };
      else {
        if (!AREAS[key]) fail(`${where}: unknown area ${key}`);
        group = { key, items: [] };
        rel.groups.push(group);
      }
      return;
    }
    if (line.startsWith("- ")) {
      if (!group) fail(`${where}: an item before any area`);
      const m = line.slice(2).match(/^(new|improved|fixed): (.*)$/);
      if (!m) fail(`${where}: start the item with new:, improved: or fixed:`);
      group.items.push({ kind: m[1], ...pair(m[2], where) });
      return;
    }
    const i = line.indexOf(": ");
    if (i < 0) fail(`${where}: not a field, area or item`);
    const k = line.slice(0, i);
    const v = line.slice(i + 2);
    rel[k] = ["version", "date", "published"].includes(k) ? v.trim() : pair(v, where);
  });
  for (const k of ["version", "date", "title", "summary", "intro"]) if (!rel[k]) fail(`${file}: missing ${k}`);
  rel.total = rel.groups.reduce((n, g) => n + g.items.length, 0);
  rel.kinds = { new: 0, improved: 0, fixed: 0 };
  for (const g of rel.groups) for (const it of g.items) rel.kinds[it.kind]++;
  rel.published = rel.published !== "no";
  return rel;
}

// ---------- The banner: a map of the release ----------

function seeded(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function blob(cx, cy, r, rand, points = 11, wobble = 0.24) {
  const pts = Array.from({ length: points }, (_, i) => {
    const a = (i / points) * Math.PI * 2;
    const rr = r * (1 - wobble / 2 + rand() * wobble);
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.78];
  });
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let d = "";
  pts.forEach((p, i) => {
    const m = mid(p, pts[(i + 1) % pts.length]);
    if (i === 0) {
      const s = mid(pts[pts.length - 1], p);
      d += `M${s[0].toFixed(1)} ${s[1].toFixed(1)}`;
    }
    d += ` Q${p[0].toFixed(1)} ${p[1].toFixed(1)} ${m[0].toFixed(1)} ${m[1].toFixed(1)}`;
  });
  return `${d} Z`;
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const W = 1200;
const H = 440;

function layout(rel) {
  const groups = [...rel.groups].sort((a, b) => b.items.length - a.items.length || (a.key < b.key ? -1 : 1));
  const placed = [];
  for (const g of groups) {
    const r = 28 + Math.sqrt(g.items.length) * 13;
    let x = 0;
    let y = 0;
    for (let k = placed.length ? placed.length * 2 : 0; k < 6000; k++) {
      const dist = k === 0 ? 0 : 26 * Math.sqrt(k);
      x = Math.cos(k * GOLDEN) * dist * 2.1;
      y = Math.sin(k * GOLDEN) * dist * 0.85;
      if (placed.every((o) => Math.abs(o.x - x) > o.r + r + 110 || Math.abs(o.y - y) > (o.r + r) * 0.8 + 34)) break;
    }
    placed.push({ g, x, y, r });
  }
  // Fit the archipelago into the sea beside the version number.
  const box = { x0: 430, x1: W - 40, y0: 34, y1: H - 30 };
  const minX = Math.min(...placed.map((p) => p.x - p.r));
  const maxX = Math.max(...placed.map((p) => p.x + p.r));
  const minY = Math.min(...placed.map((p) => p.y - p.r * 0.8));
  const maxY = Math.max(...placed.map((p) => p.y + p.r * 0.8 + 30));
  const s = Math.min(1.25, (box.x1 - box.x0) / (maxX - minX), (box.y1 - box.y0) / (maxY - minY));
  const ox = box.x0 + ((box.x1 - box.x0) - (maxX - minX) * s) / 2 - minX * s;
  const oy = box.y0 + ((box.y1 - box.y0) - (maxY - minY) * s) / 2 - minY * s;
  return placed.map((p) => ({ ...p, x: ox + p.x * s, y: oy + p.y * s, r: p.r * s }));
}

function banner(rel, lang, { labels = true, id = "" } = {}) {
  const t = T[lang];
  const islands = layout(rel);
  const pat = `dots-${rel.version.replace(/\./g, "-")}${id}`;
  const star = seeded(`stars${rel.version}`);
  let out = `<svg class="map" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t.mapLabel(rel.version, t.areaCount(rel.groups.length), t.count(rel.total)))}">`;
  out += `<defs><pattern id="${pat}" width="28" height="28" patternUnits="userSpaceOnUse"><circle class="dot" cx="2" cy="2" r="1.4"/></pattern></defs>`;
  out += `<rect class="sea" width="${W}" height="${H}"/><rect width="${W}" height="${H}" fill="url(#${pat})"/>`;
  // One star for each highlight, in the sky above the version.
  for (let i = 0; i < rel.highlights.length; i++) {
    const x = 48 + star() * 330;
    const y = 40 + star() * 150;
    const s = 5 + star() * 4;
    out += `<path class="star" d="M${x} ${y - s} L${x + s * 0.3} ${y - s * 0.3} L${x + s} ${y} L${x + s * 0.3} ${y + s * 0.3} L${x} ${y + s} L${x - s * 0.3} ${y + s * 0.3} L${x - s} ${y} L${x - s * 0.3} ${y - s * 0.3} Z"/>`;
  }
  for (const isl of islands) {
    const rand = seeded(`${rel.version}:${isl.g.key}`);
    const hue = AREAS[isl.g.key][2];
    out += `<g class="isl h-${hue}"><path class="land" d="${blob(isl.x, isl.y, isl.r, rand)}"/>`;
    const n = isl.g.items.length;
    const hs = Math.max(3.5, Math.min(9, (isl.r * 1.5) / Math.sqrt(n)));
    isl.g.items.forEach((it, j) => {
      const rr = isl.r * 0.72 * Math.sqrt((j + 0.5) / n);
      const a = j * GOLDEN + rand() * 0.2;
      const x = isl.x + Math.cos(a) * rr - hs / 2;
      const y = isl.y + Math.sin(a) * rr * 0.74 - hs / 2;
      out += `<rect class="house k-${it.kind}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${hs.toFixed(1)}" height="${(hs * 0.82).toFixed(1)}" rx="1"/>`;
    });
    out += "</g>";
    if (labels) {
      const name = AREAS[isl.g.key][lang === "ar" ? 0 : 1];
      out += `<text class="lbl" x="${isl.x.toFixed(1)}" y="${(isl.y + isl.r * 0.8 + 20).toFixed(1)}" text-anchor="middle">${esc(name)} <tspan class="num">${n}</tspan></text>`;
    }
  }
  out += `<text class="ver" x="48" y="330">${esc(rel.version)}</text><rect class="rule" x="50" y="350" width="${Math.min(330, rel.version.length * 52)}" height="5" rx="2.5"/>`;
  out += `<text class="when" x="48" y="396">${esc(dateText(rel.date, "en"))}</text>`;
  return `${out}</svg>`;
}

// ---------- Pages ----------

function shell(lang, { title, desc, path, body, alt }) {
  const t = T[lang];
  const canonical = SITE + path;
  return `<!doctype html>
<html lang="${lang}" dir="${t.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canonical}">
<link rel="alternate" hreflang="${t.other}" href="${SITE}${alt}">
<link rel="alternate" type="application/atom+xml" title="${esc(t.feed)}" href="${base(lang)}feed.xml">
<link rel="icon" href="/icon-32.png" sizes="32x32">
<link rel="stylesheet" href="/changelog.css">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${SITE}/og.png">
<meta property="og:locale" content="${t.locale}">
</head>
<body>
<a class="skip" href="#main">${t.skip}</a>
<header class="wrap top">
  <a class="brand" href="${base(lang)}"><img src="/icon-256.png" alt="" width="34" height="34"><span>Worlds</span><span class="sep" aria-hidden="true"></span><span class="what">${t.name}</span></a>
  <nav class="nav">${t.nav.map(([n, h]) => `<a href="${h}">${n}</a>`).join("")}<a class="lang" href="${alt}" hreflang="${t.other}" lang="${t.other}">${t.otherName}</a></nav>
</header>
<main id="main">
${body}
</main>
<footer class="wrap foot"><p>${t.fine}</p><p><a href="${base(lang)}feed.xml">${t.feed}</a></p></footer>
</body>
</html>
`;
}

const kindTag = (kind, lang) => `<span class="tag k-${kind}">${KINDS[kind][lang === "ar" ? 0 : 1]}</span>`;

function releasePage(rel, i, all, lang) {
  const t = T[lang];
  const older = all[i + 1];
  const newer = all[i - 1];
  const tag = `${GITHUB}/releases/tag/v${rel.version}`;
  const k = rel.kinds;
  const ar = (n, [one, two, few, many]) => (n === 1 ? one : n === 2 ? two : `<b>${n}</b> ${n <= 10 ? few : many}`);
  const parts = lang === "ar"
    ? [ar(k.new, ["ميزة جديدة", "ميزتان جديدتان", "ميزات جديدة", "ميزة جديدة"]), ar(k.improved, ["تحسين واحد", "تحسينان", "تحسينات", "تحسينًا"]), ar(k.fixed, ["إصلاح واحد", "إصلاحان", "إصلاحات", "إصلاحًا"])]
    : [`<b>${k.new}</b> added`, `<b>${k.improved}</b> improved`, `<b>${k.fixed}</b> fixed`];
  const shown = parts.filter((_, j) => [k.new, k.improved, k.fixed][j] > 0);
  const stats = lang === "ar" ? shown.join("، و") : shown.join(", ");
  let body = `<article class="wrap rel">
<figure class="hero">${banner(rel, lang)}</figure>
<p class="eyebrow"><span>${t.version} <span class="mono">${esc(rel.version)}</span></span><span>${esc(dateText(rel.date, lang))}</span>${i === 0 ? `<span class="badge">${t.latest}</span>` : ""}</p>
<h1>${esc(rel.title[lang])}</h1>
<p class="intro">${esc(rel.intro[lang])}</p>
${rel.note ? `<p class="note">${esc(rel.note[lang])}</p>` : ""}
<p class="actions">${rel.published ? `<a class="btn" href="${tag}">${t.download}</a>` : `<span class="muted">${t.notPublished}</span>`}<span class="stats">${t.count(rel.total)}: ${stats}</span></p>
<section class="hl" aria-labelledby="hl"><h2 id="hl">${t.highlights}</h2><ul>${rel.highlights.map((it) => `<li>${kindTag(it.kind, lang)}<span>${esc(it[lang])}</span></li>`).join("")}</ul></section>
<section class="all" aria-labelledby="all"><h2 id="all">${t.all}</h2>
<div class="cols"><nav class="toc" aria-label="${t.areas}"><ul>${rel.groups.map((g) => `<li><a href="#${g.key}"><i class="sw h-${AREAS[g.key][2]}" aria-hidden="true"></i>${esc(AREAS[g.key][lang === "ar" ? 0 : 1])}<span class="num">${g.items.length}</span></a></li>`).join("")}</ul></nav>
<div class="groups">${rel.groups.map((g) => `<section id="${g.key}" class="grp"><h3><i class="sw h-${AREAS[g.key][2]}" aria-hidden="true"></i>${esc(AREAS[g.key][lang === "ar" ? 0 : 1])}<span class="num">${g.items.length}</span></h3><ul>${g.items.map((it) => `<li>${kindTag(it.kind, lang)}<span>${esc(it[lang])}</span></li>`).join("")}</ul></section>`).join("\n")}</div></div>
</section>
<nav class="pn" aria-label="${t.back}">${older ? `<a class="older" href="${base(lang)}${older.version}/"><small>${t.prev}</small><span>${esc(older.version)} · ${esc(older.title[lang])}</span></a>` : "<span></span>"}${newer ? `<a class="newer" href="${base(lang)}${newer.version}/"><small>${t.next}</small><span>${esc(newer.version)} · ${esc(newer.title[lang])}</span></a>` : `<a class="newer" href="${base(lang)}"><small>${t.back}</small><span>${t.name}</span></a>`}</nav>
</article>`;
  return shell(lang, {
    title: `Worlds ${rel.version}: ${rel.title[lang]}`,
    desc: rel.summary[lang],
    path: `${base(lang)}${rel.version}/`,
    alt: `${base(t.other)}${rel.version}/`,
    body,
  });
}

function indexPage(all, lang) {
  const t = T[lang];
  const [latest, ...rest] = all;
  const card = (rel, big) => `<li class="${big ? "card big" : "card"}"><a href="${base(lang)}${rel.version}/">
<figure>${banner(rel, lang, { labels: big, id: big ? "-big" : "-s" })}</figure>
<div class="meta"><p class="eyebrow"><span class="mono">${esc(rel.version)}</span><span>${esc(dateText(rel.date, lang))}</span>${big ? `<span class="badge">${t.latest}</span>` : ""}</p>
<h2>${esc(rel.title[lang])}</h2><p>${esc(rel.summary[lang])}</p><p class="count">${t.count(rel.total)} · ${t.areaCount(rel.groups.length)}</p></div></a></li>`;
  const body = `<section class="wrap lead"><h1>${t.name}</h1><p>${t.lead}</p></section>
<ol class="wrap list">${card(latest, true)}${rest.map((r) => card(r, false)).join("")}</ol>`;
  return shell(lang, { title: `${t.name} · Worlds`, desc: t.lead, path: base(lang), alt: base(t.other), body });
}

function feed(all, lang) {
  const t = T[lang];
  const entries = all.map((rel) => `<entry><title>Worlds ${esc(rel.version)}: ${esc(rel.title[lang])}</title><link href="${SITE}${base(lang)}${rel.version}/"/><id>${SITE}${base(lang)}${rel.version}/</id><updated>${rel.date}T12:00:00Z</updated><summary>${esc(rel.summary[lang])}</summary></entry>`).join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${lang}">
<title>Worlds: ${esc(t.name)}</title><link href="${SITE}${base(lang)}"/><link rel="self" href="${SITE}${base(lang)}feed.xml"/><id>${SITE}${base(lang)}</id><updated>${all[0].date}T12:00:00Z</updated>
${entries}
</feed>
`;
}

// ---------- Build ----------

const rels = readdirSync(join(HERE, "releases")).filter((f) => f.endsWith(".txt")).map((f) => parse(join(HERE, "releases", f)));
const num = (v) => v.split(".").map(Number).reduce((a, b) => a * 1000 + b, 0);
rels.sort((a, b) => num(b.version) - num(a.version));

rmSync(OUT, { recursive: true, force: true });
const write = (p, s) => { mkdirSync(dirname(join(OUT, p)), { recursive: true }); writeFileSync(join(OUT, p), s); };
for (const lang of ["ar", "en"]) {
  const root = lang === "en" ? "en/" : "";
  write(`${root}index.html`, indexPage(rels, lang));
  write(`${root}feed.xml`, feed(rels, lang));
  rels.forEach((rel, i) => write(`${root}${rel.version}/index.html`, releasePage(rel, i, rels, lang)));
}
write("404.html", shell("ar", { title: "Worlds", desc: T.ar.nf, path: "/404", alt: "/en/", body: `<section class="wrap lead"><h1>404</h1><p>${T.ar.nf}</p><p><a href="/">${T.ar.nfLink}</a></p><p lang="en" dir="ltr">${T.en.nf} <a href="/en/">${T.en.nfLink}</a></p></section>` }));
write("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
write("sitemap.xml", `<?xml version="1.0" encoding="utf-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${["/", "/en/", ...rels.flatMap((r) => [`/${r.version}/`, `/en/${r.version}/`])].map((p) => `<url><loc>${SITE}${p}</loc></url>`).join("\n")}\n</urlset>\n`);
const SITE_DIR = join(HERE, "..", "site");
copyFileSync(join(HERE, "changelog.css"), join(OUT, "changelog.css"));
copyFileSync(join(HERE, "_headers"), join(OUT, "_headers"));
for (const f of ["icon-32.png", "icon-256.png"]) copyFileSync(join(SITE_DIR, f), join(OUT, f));
copyFileSync(join(SITE_DIR, "media", "og.png"), join(OUT, "og.png"));
mkdirSync(join(OUT, "fonts"), { recursive: true });
for (const f of readdirSync(join(SITE_DIR, "fonts"))) copyFileSync(join(SITE_DIR, "fonts", f), join(OUT, "fonts", f));
if (!existsSync(join(OUT, "index.html"))) fail("nothing was written");
console.log(`changelog: ${rels.length} releases, ${rels.reduce((n, r) => n + r.total, 0)} changes, written to ${OUT}`);
