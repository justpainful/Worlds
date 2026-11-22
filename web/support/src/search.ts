import data from "./articles.json";
import type { Lang } from "./i18n";

export interface Article {
  lang: Lang;
  key: string;
  section: string | null;
  url: string;
  title: string;
  description: string;
  headings: string[];
  body: string;
}

export const ARTICLES = data.articles as Article[];
export const SECTIONS = data.sections as { id: string; ar: string; en: string }[];

/** Arabic letters folded so أ إ آ ا, ة ه, ى ي and the short vowels all match. */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const prepared = ARTICLES.map((a) => ({ a, title: fold(a.title), desc: fold(a.description), heads: fold(a.headings.join(" ")), body: fold(a.body) }));

/** Articles in this language, best first: words in the title count most, then headings, the summary and the text. */
export function search(q: string, lang: Lang, limit = 6): Article[] {
  const words = fold(q)
    .split(" ")
    .filter((w) => w.length > 1);
  if (!words.length) return [];
  const scored = prepared
    .filter((p) => p.a.lang === lang)
    .map((p) => {
      let score = 0;
      let hits = 0;
      for (const w of words) {
        let hit = false;
        if (p.title.includes(w)) (score += 6), (hit = true);
        if (p.heads.includes(w)) (score += 3), (hit = true);
        if (p.desc.includes(w)) (score += 2), (hit = true);
        if (p.body.includes(w)) (score += 1), (hit = true);
        if (hit) hits++;
      }
      return { a: p.a, score: score * (hits / words.length) };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score);
  return scored.slice(0, limit).map((x) => x.a);
}

/** A handful of articles people need most often. */
const POPULAR = ["docs/troubleshooting", "docs/account", "docs/install", "docs/sync", "docs/getting-started", "docs/install/update-uninstall"];
export function popular(lang: Lang): Article[] {
  return POPULAR.map((k) => ARTICLES.find((a) => a.key === k && a.lang === lang)).filter(Boolean) as Article[];
}
