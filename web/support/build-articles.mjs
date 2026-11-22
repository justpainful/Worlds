// The help articles the support site searches: every page under web/content/<lang>/docs,
// with its title, description, section and headings, written to src/articles.json.
// Run before building: node web/support/build-articles.mjs
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const content = join(here, "..", "content");
const nav = JSON.parse(readFileSync(join(content, "nav.json"), "utf8"));
const sectionOf = new Map();
for (const s of nav) for (const item of s.items ?? []) sectionOf.set(item, s.id);

const strip = (h) =>
  h
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : f.endsWith(".html") ? [p] : [];
  });
}

const out = { sections: nav.map((s) => ({ id: s.id, ar: s.ar, en: s.en })), articles: [] };
for (const lang of ["ar", "en"]) {
  const base = join(content, lang);
  for (const file of walk(join(base, "docs"))) {
    const html = readFileSync(file, "utf8");
    const meta = /<!--([\s\S]*?)-->/.exec(html)?.[1] ?? "";
    const title = /title:\s*(.+)/.exec(meta)?.[1].trim() ?? strip(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? "");
    const description = /description:\s*(.+)/.exec(meta)?.[1].trim() ?? "";
    const key = relative(base, file).split(sep).join("/").replace(/\.html$/, "");
    const headings = [...html.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/g)].map((m) => strip(m[1])).slice(0, 30);
    const body = strip(html.replace(/<!--[\s\S]*?-->/, "")).slice(0, 1500);
    out.articles.push({
      lang,
      key,
      section: sectionOf.get(key) ?? null,
      url: `https://enterworlds.space/${lang === "en" ? "en/" : ""}${key}/`,
      title,
      description,
      headings,
      body,
    });
  }
}
writeFileSync(join(here, "src", "articles.json"), JSON.stringify(out));
console.log(`support: ${out.articles.length} articles`);
