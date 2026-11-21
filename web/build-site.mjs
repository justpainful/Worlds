// Builds enterworlds.space from web/content into web/site.
//   node web/build-site.mjs           build, then check every page
// Each fragment in web/content/{ar,en} becomes a page (see web/content/README.md).
// The checks fail the build: a dash where the house style forbids it, a link
// to a page or file that does not exist, an image without its size.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build as viteBuild } from "vite";
import { loadArabic, loadPacks } from "./packs/load.mjs";
import { packPages } from "./packs/pages.mjs";

const WEB = dirname(fileURLToPath(import.meta.url));
const CONTENT = join(WEB, "content");
const OUT = join(WEB, "site");
const SITE = "https://enterworlds.space";
const VERSION = JSON.parse(readFileSync(join(WEB, "..", "package.json"), "utf8")).version;
const PLATFORMS = "Windows, macOS, Linux, Android, iOS, iPadOS, Web";

// When a page last changed, from git, for the sitemap and the article dates.
const changed = new Map();
function lastChanged(file) {
  if (!changed.has(file)) {
    let d = "";
    try { d = execFileSync("git", ["log", "-1", "--format=%cI", "--", file], { cwd: WEB, encoding: "utf8" }).trim(); } catch {}
    changed.set(file, d || new Date().toISOString());
  }
  return changed.get(file);
}
export const LINKS = {
  app: "https://app.enterworlds.space",
  demo: "https://demo.enterworlds.space",
  github: "https://github.com/justpainful/Worlds",
  releases: "https://github.com/justpainful/Worlds/releases/latest",
  issues: "https://github.com/justpainful/Worlds/issues",
};

const T = {
  ar: {
    dir: "rtl", other: "en", otherName: "English", locale: "ar_SA",
    skip: "انتقل إلى المحتوى", menu: "القائمة", home: "Worlds الصفحة الرئيسية",
    nav: [["features", "المزايا"], ["apps", "التطبيقات"], ["story", "القصة"], ["docs", "الدليل"], ["tools", "الأدوات"], ["support", "الدعم"]],
    github: "GitHub", docsMenu: "صفحات الدليل", docs: "الدليل", prev: "السابق", next: "التالي",
    foot: [["features", "المزايا"], ["packs", "الحزم"], ["notion-alternative", "بديل لـ Notion"], ["apps", "التطبيقات"], ["story", "القصة"], ["docs", "الدليل"], ["tools", "الأدوات"], ["support", "الدعم"], ["privacy", "الخصوصية"], ["terms", "شروط الاستخدام"]],
    away: [["https://changelog.enterworlds.space/", "سجل التحديثات"], ["https://status.enterworlds.space/", "الحالة"]],
    festival: "مهرجان الذكاء الطبيعي يقود الذكاء الاصطناعي 2026، مسار التجارب المتميزة.",
    fine: "Worlds اسم عمل إبداعي غير مسجل رسميًا، مستقل عن هوية imbue. الشيفرة منشورة على GitHub.",
    siteName: "Worlds",
  },
  en: {
    dir: "ltr", other: "ar", otherName: "العربية", locale: "en_US",
    skip: "Skip to content", menu: "Menu", home: "Worlds home",
    nav: [["features", "Features"], ["apps", "Apps"], ["story", "Story"], ["docs", "Docs"], ["tools", "Tools"], ["support", "Support"]],
    github: "GitHub", docsMenu: "Docs pages", docs: "Docs", prev: "Previous", next: "Next",
    foot: [["features", "Features"], ["packs", "Packs"], ["notion-alternative", "A Notion alternative"], ["apps", "Apps"], ["story", "Story"], ["docs", "Docs"], ["tools", "Tools"], ["support", "Support"], ["privacy", "Privacy"], ["terms", "Terms of use"]],
    away: [["https://changelog.enterworlds.space/en/", "Changelog"], ["https://status.enterworlds.space/en/", "Status"]],
    festival: "Natural Intelligence Leads Artificial Intelligence festival 2026, outstanding experiments track.",
    fine: "Worlds is a creative working name, not a registered mark, and is independent of the imbue identity. The code is published on GitHub.",
    siteName: "Worlds",
  },
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const route = (rel) => {
  const p = rel.replace(/\\/g, "/").replace(/\.html$/, "");
  return p === "index" ? "" : `${p}/`;
};
const url = (lang, r) => (lang === "en" ? "/en/" : "/") + r;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".html")) out.push(p);
  }
  return out;
}

function parse(file) {
  const raw = readFileSync(file, "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const m = raw.match(/^<!--\n([\s\S]*?)\n-->\n?/);
  const meta = {};
  if (m) for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: m ? raw.slice(m[0].length) : raw };
}

// The live page on the front page (web/live/live.ts): the app's own engines, bundled.
await viteBuild({
  root: join(WEB, ".."),
  configFile: false,
  publicDir: false,
  logLevel: "warn",
  plugins: [
    {
      // Quick add's date helpers without the rest of the planning model (it loads every pack).
      name: "live-planning-dates",
      enforce: "pre",
      resolveId(source, importer) {
        const from = (importer ?? "").split(String.fromCharCode(92)).join("/");
        if (source === "./model" && from.endsWith("src/planning/quickAdd.ts")) return join(WEB, "live/planning-dates.ts");
        return null;
      },
    },
  ],
  build: {
    lib: { entry: join(WEB, "live/live.ts"), formats: ["es"], fileName: () => "live.js" },
    outDir: OUT,
    emptyOutDir: false,
    copyPublicDir: false,
    minify: true,
    target: "es2020",
  },
});

// All pages, by language and route.
const pages = { ar: new Map(), en: new Map() };
for (const lang of ["ar", "en"]) {
  for (const file of walk(join(CONTENT, lang))) {
    const r = route(relative(join(CONTENT, lang), file));
    pages[lang].set(r, { ...parse(file), file, route: r });
  }
}

// A page for every pack, written from the app's own pack definitions.
const PACK_SOURCE = join(WEB, "..", "src", "packs", "definitions");
const packData = await loadPacks();
const generated = packPages(packData, loadArabic());
for (const lang of ["ar", "en"]) for (const g of generated[lang]) pages[lang].set(g.route, { ...g, file: PACK_SOURCE });

const nav = JSON.parse(readFileSync(join(CONTENT, "nav.json"), "utf8"));
const flat = nav.flatMap((s) => s.items.map((i) => `${i}/`));
const hello = readFileSync(join(CONTENT, "hello.svg"), "utf8").trim();

function header(lang, r) {
  const t = T[lang];
  const section = r.split("/")[0];
  const alt = pages[t.other].has(r) && r !== "404/" ? url(t.other, r) : url(t.other, "");
  const links = t.nav.filter(([k]) => pages[lang].has(`${k}/`)).map(([k, label]) => `<a href="${url(lang, `${k}/`)}"${section === k ? ' aria-current="page"' : ""}>${label}</a>`).join("");
  return `<header class="wrap top">
  <a class="lockup${r ? " small" : ""}" href="${url(lang, "")}" aria-label="${t.home}"><img class="logo" src="/icon-256.png" alt="" width="46" height="46"><span class="sep" aria-hidden="true"></span><img class="imbue" src="/mail/imbue.png" alt="imbue" width="70" height="26"></a>
  <nav class="nav" aria-label="${t.menu}">${links}<a href="${LINKS.github}">${t.github}</a><a class="lang" href="${alt}" hreflang="${t.other}" lang="${t.other}">${t.otherName}</a></nav>
  <details class="menu"><summary>${t.menu}</summary><div class="nav">${links}<a href="${LINKS.github}">${t.github}</a><a class="lang" href="${alt}" hreflang="${t.other}" lang="${t.other}">${t.otherName}</a></div></details>
</header>`;
}

function footer(lang) {
  const t = T[lang];
  return `<footer class="wrap foot">
  <div class="row">
    <div class="credit">
      <a class="lockup small" href="${url(lang, "")}" aria-label="${t.home}"><img class="logo" src="/icon-256.png" alt="" width="34" height="34"><span class="sep" aria-hidden="true"></span><img class="imbue" src="/mail/imbue.png" alt="imbue" width="51" height="19"></a>
      <p>${t.festival}</p>
    </div>
    <nav aria-label="${t.siteName}">${t.foot.filter(([k]) => pages[lang].has(`${k}/`)).map(([k, label]) => `<a href="${url(lang, `${k}/`)}">${label}</a>`).join("")}${t.away.map(([href, label]) => `<a href="${href}">${label}</a>`).join("")}<a href="${LINKS.github}">GitHub</a></nav>
  </div>
  <p class="fine">${t.fine}</p>
</footer>`;
}

// Schema.org data: who makes Worlds, the app itself, and where each page sits.
function jsonld(lang, page) {
  const t = T[lang];
  const r = page.route;
  const meta = page.meta;
  const pageUrl = `${SITE}${url(lang, r)}`;
  const org = { "@type": "Organization", "@id": `${SITE}/#org`, name: "Worlds", url: `${SITE}/`, logo: `${SITE}/icon-256.png`, sameAs: [LINKS.github] };
  const app = {
    "@type": "SoftwareApplication",
    "@id": `${SITE}/#app`,
    name: "Worlds",
    alternateName: lang === "ar" ? "وورلدز" : "Worlds app",
    description: pages[lang].get("")?.meta.description,
    url: `${SITE}${url(lang, "")}`,
    applicationCategory: "ProductivityApplication",
    applicationSubCategory: lang === "ar" ? "مساحة عمل للملاحظات والمهام والمستندات" : "Notes, tasks and documents workspace",
    operatingSystem: PLATFORMS,
    softwareVersion: VERSION,
    inLanguage: ["ar", "en"],
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    downloadUrl: LINKS.releases,
    installUrl: `${SITE}${url(lang, "apps/")}`,
    releaseNotes: `https://changelog.enterworlds.space${lang === "en" ? "/en/" : "/"}${VERSION}/`,
    screenshot: `${SITE}/media/og.png`,
    image: `${SITE}/icon-256.png`,
    publisher: { "@id": `${SITE}/#org` },
    sameAs: [LINKS.github, "https://app.enterworlds.space/"],
  };
  const graph = [];
  if (r === "") {
    graph.push(org, { "@type": "WebSite", "@id": `${SITE}/#site`, name: "Worlds", url: `${SITE}/`, inLanguage: lang, publisher: { "@id": `${SITE}/#org` } }, app);
  } else {
    const trail = [{ name: "Worlds", item: `${SITE}${url(lang, "")}` }];
    if (r.startsWith("docs/") && r !== "docs/") trail.push({ name: t.docs, item: `${SITE}${url(lang, "docs/")}` });
    if (r.startsWith("packs/") && r !== "packs/") trail.push({ name: lang === "ar" ? "الحزم" : "Packs", item: `${SITE}${url(lang, "packs/")}` });
    trail.push({ name: meta.nav ?? meta.title, item: pageUrl });
    graph.push({ "@type": "BreadcrumbList", itemListElement: trail.map((x, i) => ({ "@type": "ListItem", position: i + 1, ...x })) });
    if (r === "apps/") graph.push(app);
    else if (r.startsWith("docs/") || r === "story/" || (r.startsWith("packs/") && r !== "packs/")) {
      graph.push({
        "@type": r === "story/" ? "Article" : "TechArticle",
        headline: meta.title,
        description: meta.description,
        inLanguage: lang,
        url: pageUrl,
        dateModified: lastChanged(page.file),
        image: `${SITE}/media/og.png`,
        author: { "@id": `${SITE}/#org` },
        publisher: { "@type": "Organization", name: "Worlds", logo: { "@type": "ImageObject", url: `${SITE}/icon-256.png` } },
        about: { "@type": "SoftwareApplication", name: "Worlds", operatingSystem: PLATFORMS, applicationCategory: "ProductivityApplication" },
      });
    }
  }
  return `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c")}</script>`;
}

function head(lang, r, meta, page) {
  const t = T[lang];
  const title = r ? `${meta.title} · Worlds` : meta.title;
  const alts = ["ar", "en"].filter((l) => pages[l].has(r) && r !== "404/").map((l) => `<link rel="alternate" hreflang="${l}" href="${SITE}${url(l, r)}">`).join("\n")
    + (pages.ar.has(r) && r !== "404/" ? `\n<link rel="alternate" hreflang="x-default" href="${SITE}${url("ar", r)}">` : "");
  return `<!doctype html>
<html lang="${lang}" dir="${t.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(meta.description ?? "")}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f9f1e8" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1b1714" media="(prefers-color-scheme: dark)">
${r === "404/" ? '<meta name="robots" content="noindex">' : `<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">\n<link rel="canonical" href="${SITE}${url(lang, r)}">`}
${alts}
<meta property="og:type" content="website">
<meta property="og:site_name" content="Worlds">
<meta property="og:title" content="${esc(meta.title)}">
<meta property="og:description" content="${esc(meta.description ?? "")}">
<meta property="og:url" content="${SITE}${url(lang, r === "404/" ? "" : r)}">
<meta property="og:image" content="${SITE}/media/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${lang === "ar" ? "صفحة Worlds مكتوب عليها Hello, Worlds! بخط اليد" : "A Worlds page with Hello, Worlds! written by hand"}">
<meta property="og:locale" content="${t.locale}">
<meta property="og:locale:alternate" content="${lang === "ar" ? "en_US" : "ar_SA"}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(meta.title)}">
<meta name="twitter:description" content="${esc(meta.description ?? "")}">
<meta name="twitter:image" content="${SITE}/media/og.png">
<meta name="application-name" content="Worlds">
<link rel="alternate" type="application/atom+xml" title="${lang === "ar" ? "تحديثات Worlds" : "Worlds updates"}" href="https://changelog.enterworlds.space${lang === "en" ? "/en/" : "/"}feed.xml">
<link rel="icon" href="/icon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/icon-256.png">
<link rel="preload" href="/fonts/${lang === "ar" ? "plex-arabic-400" : "instrument-sans"}.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/site.css">
<script src="/site.js"></script>${r === "" ? "\n<script type=\"module\" src=\"/live.js\"></script>" : ""}${page && r !== "404/" ? `\n${jsonld(lang, page)}` : ""}
</head>`;
}

function docsIndex(lang) {
  return nav.map((s) => {
    const items = s.items.map((i) => pages[lang].get(`${i}/`)).filter(Boolean);
    if (!items.length) return "";
    return `<h2 id="${s.id}">${s[lang]}</h2>\n<ul class="index">${items.map((p) => `<li><a href="${url(lang, p.route)}"><strong>${p.meta.nav ?? p.meta.title}</strong><span>${p.meta.description ?? ""}</span></a></li>`).join("")}</ul>`;
  }).join("\n");
}

function sidebar(lang, r) {
  const t = T[lang];
  const groups = nav.map((s) => {
    const items = s.items.map((i) => pages[lang].get(`${i}/`)).filter(Boolean);
    if (!items.length) return "";
    const lis = items.map((p) => {
      const sub = p.route.split("/").length > 3 ? ' class="sub"' : "";
      return `<li${sub}><a href="${url(lang, p.route)}"${p.route === r ? ' aria-current="page"' : ""}>${p.meta.nav ?? p.meta.title}</a></li>`;
    }).join("");
    return `<h2>${s[lang]}</h2><ul>${lis}</ul>`;
  }).join("");
  return `<details class="side" open><summary>${t.docsMenu}</summary><div class="side-list">${groups}</div></details>`;
}

function pager(lang, r) {
  const t = T[lang];
  const list = flat.filter((x) => pages[lang].has(x));
  const i = list.indexOf(r);
  if (i < 0) return "";
  const prev = list[i - 1] && pages[lang].get(list[i - 1]);
  const next = list[i + 1] && pages[lang].get(list[i + 1]);
  return `<nav class="pager" aria-label="${t.docs}">${prev ? `<a class="prev" href="${url(lang, prev.route)}"><small>${t.prev}</small>${prev.meta.nav ?? prev.meta.title}</a>` : ""}${next ? `<a class="next" href="${url(lang, next.route)}"><small>${t.next}</small>${next.meta.nav ?? next.meta.title}</a>` : ""}</nav>`;
}

function crumb(lang, r) {
  const sec = nav.find((s) => s.items.some((i) => `${i}/` === r));
  if (!sec || r === "docs/") return "";
  return `<p class="crumb"><a href="${url(lang, "docs/")}">${T[lang].docs}</a> / ${sec[lang]}</p>`;
}

function render(lang, page) {
  const t = T[lang];
  const r = page.route;
  let body = page.body.replace("<!-- hello -->", hello).replace("<!-- docs-index -->", docsIndex(lang));
  for (const [k, v] of Object.entries(LINKS)) body = body.replaceAll(`{{${k}}}`, v);
  let main;
  if (r === "") main = `<main id="main">\n${body}\n</main>`;
  else if (r.startsWith("docs/")) {
    main = `<div class="wrap docs">\n${sidebar(lang, r)}\n<main id="main" class="article">\n${crumb(lang, r)}\n${body}\n${pager(lang, r)}\n</main>\n</div>`;
  } else main = `<div class="wrap page-solo"><main id="main" class="article">\n${body}\n</main></div>`;
  return `${head(lang, r, page.meta, page)}
<body>
<a class="skip" href="#main">${t.skip}</a>
${header(lang, r)}
${main}
${footer(lang)}
</body>
</html>
`;
}

// Generated folders are rebuilt from scratch; hand-made files (css, js, fonts, media) stay.
for (const dir of ["docs", "apps", "features", "packs", "notion-alternative", "story", "tools", "support", "privacy", "terms", "en"]) rmSync(join(OUT, dir), { recursive: true, force: true });

const problems = [];
const written = [];
for (const lang of ["ar", "en"]) {
  for (const page of pages[lang].values()) {
    if (!page.meta.title) problems.push(`${page.file}: no title`);
    const html = render(lang, page);
    // 404 pages sit next to the pages they cover (Workers assets serve the nearest 404.html).
    const dest = page.route === "404/" ? join(OUT, lang === "en" ? "en" : "", "404.html") : join(OUT, lang === "en" ? "en" : "", page.route, "index.html");
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, html);
    written.push([lang, page, html, dest]);
  }
}

// Publishing before every page is written (--publish): a link to a page that
// does not exist yet is dropped (a list item that is only that link goes
// away, any other link keeps its text), so nothing on the live site leads to
// a 404. Without the flag those links fail the build below.
const PUBLISH = process.argv.includes("--publish");
const exists = (p) => existsSync(join(OUT, p.endsWith("/") ? `${p}index.html` : p));
if (PUBLISH) {
  for (const w of written) {
    let html = w[2]
      .replace(/<li(?: class="[^"]*")?>\s*<a href="(\/[^"#?]*)[^"]*"[^>]*>[\s\S]*?<\/a>\s*<\/li>/g, (m, href) => (exists(href) ? m : ""))
      .replace(/<a href="(\/[^"#?]*)[^"]*"[^>]*>([\s\S]*?)<\/a>/g, (m, href, text) => (exists(href) ? m : text));
    if (html !== w[2]) {
      w[2] = html;
      writeFileSync(w[3], html);
    }
  }
}

// Checks.
const DASH = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
for (const [lang, page, html] of written) {
  const where = relative(WEB, page.file);
  const text = html.replace(/<(script|style)[\s\S]*?<\/\1>/g, "");
  const dash = text.split("\n").findIndex((l) => DASH.test(l));
  if (dash >= 0) problems.push(`${where}: a dash in "${text.split("\n")[dash].trim().slice(0, 80)}"`);
  for (const m of html.matchAll(/(?:href|src)="(\/[^"#?]*)/g)) {
    const p = m[1];
    const file = join(OUT, p.endsWith("/") ? `${p}index.html` : p);
    if (!existsSync(file)) problems.push(`${where}: missing ${p}`);
  }
  for (const m of html.matchAll(/<img\b[^>]*>/g)) {
    if (!/\bwidth="\d+"/.test(m[0]) || !/\bheight="\d+"/.test(m[0])) problems.push(`${where}: image without width and height: ${m[0].slice(0, 80)}`);
    if (!/\balt="/.test(m[0])) problems.push(`${where}: image without alt: ${m[0].slice(0, 80)}`);
  }
  if (/\sstyle="/.test(html.replace(hello, ""))) problems.push(`${where}: inline style (the site's CSP refuses it)`);
  if (/<script(?![^>]*\b(?:src=|type="application\/ld\+json"))/.test(html)) problems.push(`${where}: inline script (the site's CSP refuses it)`);
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { JSON.parse(m[1]); } catch { problems.push(`${where}: structured data is not valid JSON`); }
  }
  if (page.route === "404/") continue;
  if (pages[lang === "ar" ? "en" : "ar"].has(page.route) === false) problems.push(`${where}: no ${lang === "ar" ? "English" : "Arabic"} version`);
}

// Sitemap.
// Sitemap: every page with when it last changed and its other language.
const urls = written.filter(([, page]) => page.route !== "404/").map(([lang, page]) => {
  const alts = ["ar", "en"].filter((l) => pages[l].has(page.route)).map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${SITE}${url(l, page.route)}"/>`).join("");
  const xd = `<xhtml:link rel="alternate" hreflang="x-default" href="${SITE}${url("ar", page.route)}"/>`;
  const pri = page.route === "" ? "1.0" : ["features/", "apps/", "packs/", "notion-alternative/", "docs/", "story/"].includes(page.route) ? "0.8" : page.route.startsWith("docs/") || page.route.startsWith("packs/") ? "0.6" : "0.4";
  return `<url><loc>${SITE}${url(lang, page.route)}</loc><lastmod>${lastChanged(page.file).slice(0, 10)}</lastmod><priority>${pri}</priority>${alts}${xd}</url>`;
}).join("\n");
writeFileSync(join(OUT, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`);
writeFileSync(join(OUT, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\nSitemap: https://changelog.enterworlds.space/sitemap.xml\n`);

console.log(`${written.length} pages`);
const missingNav = flat.filter((r) => !pages.ar.has(r));
if (missingNav.length) console.log(`not written yet: ${missingNav.join(", ")}`);
if (problems.length) {
  console.error(problems.map((p) => `  ${p}`).join("\n"));
  process.exitCode = 1;
}
