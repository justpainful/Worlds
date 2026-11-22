// Builds changelog.enterworlds.space from web/changelog/releases into web/changelog/site.
//   node web/changelog/build.mjs
// Each release is a text file (see web/changelog/README.md). Every release gets
// a page whose hero is a dark panel with the release's feature cards, each with
// its own line drawing (web/changelog/art.mjs).
// The build fails on a dash the house style forbids, an unknown area or kind,
// or a line without both languages.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ART, art } from "./art.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "site");
const SITE = "https://changelog.enterworlds.space";
const MAIN = "https://enterworlds.space";
const STATUS = "https://status.enterworlds.space";
const GITHUB = "https://github.com/justpainful/Worlds";

// Areas keep one colour on every page, so Cognition has the same colour in every release.
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
    featured: (v) => `أبرز ما جاء في Worlds ${v}`, see: (a) => `تفاصيل ${a}`, toHighlights: "انتقل إلى الأبرز",
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
    featured: (v) => `The best of Worlds ${v}`, see: (a) => `${a} in detail`, toHighlights: "Go to the highlights",
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
  const rel = { groups: [], highlights: [], features: [] };
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
    if (k === "feature") {
      // feature: <drawing> <area or all> :: title :: words[ :: link] || the same in English
      const m = v.match(/^(\S+) (\S+) :: (.*)$/);
      if (!m) fail(`${where}: write feature: <drawing> <area> :: title :: words || English`);
      if (!ART[m[1]]) fail(`${where}: no drawing named ${m[1]}`);
      const both = pair(m[3], where);
      const [ar, en] = [both.ar, both.en].map((x) => x.split(" :: ").map((y) => y.trim()));
      if (ar.length < 2 || en.length < 2) fail(`${where}: a feature needs a title and words in both languages`);
      rel.features.push({ art: m[1], anchor: m[2], title: { ar: ar[0], en: en[0] }, desc: { ar: ar[1], en: en[1] }, link: ar[2] && en[2] ? { ar: ar[2], en: en[2] } : null });
      return;
    }
    rel[k] = ["version", "date", "published"].includes(k) ? v.trim() : pair(v, where);
  });
  for (const k of ["version", "date", "title", "summary", "intro"]) if (!rel[k]) fail(`${file}: missing ${k}`);
  if (!rel.features.length) fail(`${file}: add at least one feature: line for the release panel`);
  for (const f of rel.features) if (f.anchor !== "all" && !rel.groups.some((g) => g.key === f.anchor)) fail(`${file}: feature ${f.art} points at ${f.anchor}, which has no changes here`);
  rel.total = rel.groups.reduce((n, g) => n + g.items.length, 0);
  rel.kinds = { new: 0, improved: 0, fixed: 0 };
  for (const g of rel.groups) for (const it of g.items) rel.kinds[it.kind]++;
  rel.published = rel.published !== "no";
  return rel;
}

// ---------- The release panel ----------
// One component for every release: a near-black panel with the version, the
// title and the release's feature cards, each with its own line drawing
// (web/changelog/art.mjs). The release page shows it as its hero; the list
// shows the newest release the same way and the older ones as smaller cards.

// The version as people say it: 1.0.0 is "1.0", 0.3.1 stays "0.3.1".
const spoken = (v) => v.replace(/\.0$/, "");

function kindParts(rel, lang) {
  const k = rel.kinds;
  const ar = (n, [one, two, few, many]) => (n === 1 ? one : n === 2 ? two : `<b>${n}</b> ${n <= 10 ? few : many}`);
  const parts = lang === "ar"
    ? [ar(k.new, ["ميزة جديدة", "ميزتان جديدتان", "ميزات جديدة", "ميزة جديدة"]), ar(k.improved, ["تحسين واحد", "تحسينان", "تحسينات", "تحسينًا"]), ar(k.fixed, ["إصلاح واحد", "إصلاحان", "إصلاحات", "إصلاحًا"])]
    : [`<b>${k.new}</b> added`, `<b>${k.improved}</b> improved`, `<b>${k.fixed}</b> fixed`];
  return parts.filter((_, j) => [k.new, k.improved, k.fixed][j] > 0);
}

const arrow = (lang) => (lang === "ar" ? "&#8598;" : "&#8599;");

/** One feature: the drawing above, the words below, the whole card a link. */
function featureCard(f, rel, lang, page, heading) {
  const t = T[lang];
  const href = `${page}#${f.anchor}`;
  const go = f.link?.[lang] || (f.anchor === "all" ? t.all : t.see(AREAS[f.anchor][lang === "ar" ? 0 : 1]));
  return `<li class="feat"><a href="${href}"><div class="feat-art">${art(f.art)}</div><div class="feat-body"><${heading}>${esc(f.title[lang])}</${heading}><p>${esc(f.desc[lang])}</p><span class="feat-go">${esc(go)} <span aria-hidden="true">${arrow(lang)}</span></span></div></a></li>`;
}

/**
 * The panel. On a release page `page` is "" (links stay on the page) and the
 * title is the page's h1; in the list it links to the release page.
 */
function releasePanel(rel, lang, { latest = false, onPage = true } = {}) {
  const t = T[lang];
  const page = onPage ? "" : `${base(lang)}${rel.version}/`;
  const h = onPage ? "h1" : "h2";
  const id = `t-${rel.version.replace(/\./g, "-")}`;
  const title = onPage ? esc(rel.title[lang]) : `<a href="${page}">${esc(rel.title[lang])}</a>`;
  return `<section class="panel" aria-labelledby="${id}">
<div class="panel-top"><p class="crumbs"><a href="${MAIN}${lang === "ar" ? "/" : "/en/"}">Worlds</a><span aria-hidden="true">/</span><a href="${base(lang)}">${t.name}</a></p><time datetime="${rel.date}">${esc(dateText(rel.date, lang))}</time></div>
<p class="panel-ver">${t.version} <span class="mono">${esc(rel.version)}</span>${latest ? `<span class="badge">${t.latest}</span>` : ""}</p>
<${h} id="${id}">${title}</${h}>
<p class="panel-sub">${esc(t.featured(spoken(rel.version)))}</p>
<ul class="feats">${rel.features.map((f) => featureCard(f, rel, lang, page, "h3")).join("")}</ul>
<div class="panel-foot"><p class="panel-stats">${kindParts(rel, lang).join('<span class="dot" aria-hidden="true"></span>')}</p><a class="down" href="${page}#${onPage ? "hl" : "all"}" aria-label="${onPage ? t.toHighlights : t.read}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5v13M6.5 12.5 12 18l5.5-5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></a></div>
</section>`;
}

/** An older release in the list: its first drawing on the dark panel, then the words. */
function releaseCard(rel, lang) {
  const t = T[lang];
  const f = rel.features[0];
  return `<li class="card"><a href="${base(lang)}${rel.version}/"><div class="card-art">${art(f.art)}</div>
<div class="card-body"><p class="eyebrow"><span class="mono">${esc(rel.version)}</span><span>${esc(dateText(rel.date, lang))}</span></p>
<h2>${esc(rel.title[lang])}</h2><p>${esc(rel.summary[lang])}</p><p class="count">${t.count(rel.total)} · ${t.areaCount(rel.groups.length)}</p></div></a></li>`;
}

// ---------- Pages ----------

function shell(lang, { title, desc, path, body, alt, ld }) {
  const t = T[lang];
  const canonical = SITE + path;
  return `<!doctype html>
<html lang="${lang}" dir="${t.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="${path === "/404" ? "noindex" : "index, follow, max-image-preview:large, max-snippet:-1"}">
<link rel="canonical" href="${canonical}">
<link rel="alternate" hreflang="${lang}" href="${canonical}">
<link rel="alternate" hreflang="${t.other}" href="${SITE}${alt}">
<link rel="alternate" hreflang="x-default" href="${SITE}${lang === "ar" ? path : alt}">
<link rel="alternate" type="application/atom+xml" title="${esc(t.feed)}" href="${base(lang)}feed.xml">
<link rel="icon" href="/icon-32.png" sizes="32x32">
<link rel="stylesheet" href="/changelog.css">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${canonical}">
<meta property="og:type" content="${path.split("/").filter(Boolean).some((x) => /^\d/.test(x)) ? "article" : "website"}">
<meta property="og:site_name" content="Worlds">
<meta property="og:image" content="${SITE}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="${t.locale}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${SITE}/og.png">${ld ? `\n<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": ld }).replace(/</g, "\\u003c")}</script>` : ""}
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
  const shown = kindParts(rel, lang);
  const stats = lang === "ar" ? shown.join("، و") : shown.join(", ");
  let body = `<article class="wrap rel">
${releasePanel(rel, lang, { latest: i === 0 })}
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
  const page = `${SITE}${base(lang)}${rel.version}/`;
  const ld = [
    {
      "@type": "TechArticle",
      headline: `Worlds ${rel.version}: ${rel.title[lang]}`,
      description: rel.summary[lang],
      inLanguage: lang,
      url: page,
      datePublished: rel.date,
      image: `${SITE}/og.png`,
      author: { "@type": "Organization", name: "Worlds", url: MAIN + "/" },
      publisher: { "@type": "Organization", name: "Worlds", logo: { "@type": "ImageObject", url: `${SITE}/icon-256.png` } },
      about: { "@type": "SoftwareApplication", name: "Worlds", softwareVersion: rel.version, applicationCategory: "ProductivityApplication", operatingSystem: "Windows, macOS, Linux, Android, iOS, iPadOS, Web", offers: { "@type": "Offer", price: "0", priceCurrency: "USD" }, url: MAIN + "/", releaseNotes: page },
    },
    { "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Worlds", item: lang === "ar" ? MAIN + "/" : MAIN + "/en/" },
      { "@type": "ListItem", position: 2, name: t.name, item: `${SITE}${base(lang)}` },
      { "@type": "ListItem", position: 3, name: `${rel.version}`, item: page },
    ] },
  ];
  return shell(lang, {
    title: `Worlds ${rel.version}: ${rel.title[lang]}`,
    desc: rel.summary[lang],
    path: `${base(lang)}${rel.version}/`,
    alt: `${base(t.other)}${rel.version}/`,
    body,
    ld,
  });
}

function indexPage(all, lang) {
  const t = T[lang];
  const [latest, ...rest] = all;
  const body = `<section class="wrap lead"><h1>${t.name}</h1><p>${t.lead}</p></section>
<div class="wrap">${releasePanel(latest, lang, { latest: true, onPage: false })}
<p class="latest-sum">${esc(latest.summary[lang])} <a href="${base(lang)}${latest.version}/">${t.read}</a></p></div>
<ol class="wrap list">${rest.map((r) => releaseCard(r, lang)).join("")}</ol>`;
  const ld = [{
    "@type": "CollectionPage",
    name: `${t.name} · Worlds`,
    description: t.lead,
    inLanguage: lang,
    url: `${SITE}${base(lang)}`,
    mainEntity: { "@type": "ItemList", itemListElement: all.map((rel, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE}${base(lang)}${rel.version}/`, name: `Worlds ${rel.version}: ${rel.title[lang]}` })) },
  }];
  return shell(lang, { title: `${t.name} · Worlds`, desc: t.lead, path: base(lang), alt: base(t.other), body, ld });
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
const entry = (ar, en, date) => [ar, en].map((p) => `<url><loc>${SITE}${p}</loc><lastmod>${date}</lastmod><xhtml:link rel="alternate" hreflang="ar" href="${SITE}${ar}"/><xhtml:link rel="alternate" hreflang="en" href="${SITE}${en}"/><xhtml:link rel="alternate" hreflang="x-default" href="${SITE}${ar}"/></url>`).join("\n");
write("sitemap.xml", `<?xml version="1.0" encoding="utf-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${[entry("/", "/en/", rels[0].date), ...rels.map((r) => entry(`/${r.version}/`, `/en/${r.version}/`, r.date))].join("\n")}\n</urlset>\n`);
const SITE_DIR = join(HERE, "..", "site");
copyFileSync(join(HERE, "changelog.css"), join(OUT, "changelog.css"));
copyFileSync(join(HERE, "_headers"), join(OUT, "_headers"));
for (const f of ["icon-32.png", "icon-256.png"]) copyFileSync(join(SITE_DIR, f), join(OUT, f));
copyFileSync(join(SITE_DIR, "media", "og.png"), join(OUT, "og.png"));
mkdirSync(join(OUT, "fonts"), { recursive: true });
for (const f of readdirSync(join(SITE_DIR, "fonts"))) copyFileSync(join(SITE_DIR, "fonts", f), join(OUT, "fonts", f));
// IndexNow: the same key as the main site, so search engines accept pings for this host.
const KEY = readFileSync(join(HERE, "..", "indexnow-key.txt"), "utf8").trim();
writeFileSync(join(OUT, `${KEY}.txt`), KEY);
if (!existsSync(join(OUT, "index.html"))) fail("nothing was written");
console.log(`changelog: ${rels.length} releases, ${rels.reduce((n, r) => n + r.total, 0)} changes, written to ${OUT}`);
