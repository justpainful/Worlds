/**
 * Things that arrive from outside: articles saved to read later (clean,
 * without ads, kept on the device), and what the Worlds browser extension
 * sends (a page, a selection, a link).
 */
import { api, errorMessage, isTauri } from "../lib/api";
import { useStore } from "../state/store";
import { tr, uiLanguage } from "../i18n/ui";
import { newProperty } from "../pages/properties";

const READING_KEY = "reader.parent";
const CAPTURE_KEY = "capture.parent";

async function holder(key: string, title: string): Promise<string> {
  const s = useStore.getState();
  const id = s.settings[key] as string | undefined;
  if (id && s.pages[id] && !s.pages[id].deletedAt) return id;
  const meta = await api.createPage({ title } as never);
  s.setSetting(key, meta.id);
  return meta.id;
}

/** The readable part of a web page as Markdown, with its title. */
export function readable(html: string, url: string): { title: string; markdown: string; byline: string } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const title = doc.querySelector('meta[property="og:title"]')?.getAttribute("content")?.trim() || doc.title?.trim() || url;
  const byline = doc.querySelector('meta[name="author"]')?.getAttribute("content")?.trim() ?? "";
  doc.querySelectorAll("script, style, noscript, nav, header, footer, aside, form, iframe, svg, button, [role=navigation], [aria-hidden=true], .ad, .ads, .advert, .share, .social, .comments, .related").forEach((e) => e.remove());
  // The container with the most paragraph text wins.
  let best: Element = doc.querySelector("article, main, [role=main]") ?? doc.body;
  let bestScore = 0;
  doc.querySelectorAll("article, main, section, div").forEach((el) => {
    const ps = [...el.querySelectorAll(":scope > p, :scope > div > p")];
    const score = ps.reduce((sum, p) => sum + (p.textContent?.trim().length ?? 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  });
  const base = new URL(url);
  const out: string[] = [];
  const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
  const walk = (el: Element) => {
    for (const c of [...el.children]) {
      const tag = c.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        const t = text(c);
        if (t && t !== title) out.push(`${"#".repeat(Math.min(3, Math.max(2, Number(tag[1]))))} ${t}`);
      } else if (tag === "p") {
        const t = text(c);
        if (t.length > 1) out.push(t);
      } else if (tag === "blockquote") out.push(`> ${text(c)}`);
      else if (tag === "li") out.push(`- ${text(c)}`);
      else if (tag === "pre") out.push("```\n" + (c.textContent ?? "").trim() + "\n```");
      else if (tag === "img") {
        const src = c.getAttribute("src");
        if (src && !src.startsWith("data:")) {
          try {
            out.push(`![${c.getAttribute("alt") ?? ""}](${new URL(src, base).href})`);
          } catch {
            /* skip */
          }
        }
      } else walk(c);
    }
  };
  walk(best);
  return { title, byline, markdown: out.join("\n\n") };
}

/** Save an article to the reading list: a clean copy you can read offline. */
export async function saveArticle(url: string, open = true): Promise<string | null> {
  const s = useStore.getState();
  try {
    if (!isTauri) throw new Error(tr("Saving articles works in the Worlds app on your computer."));
    s.toast({ message: tr("Saving the article") });
    const html = await api.fetchArticle(url);
    const { title, markdown, byline } = readable(html, url);
    const parent = await holder(READING_KEY, uiLanguage() === "ar" ? "قائمة القراءة" : "Reading list");
    const source = `${uiLanguage() === "ar" ? "المصدر" : "Source"}: [${new URL(url).hostname}](${url})${byline ? ` · ${byline}` : ""}`;
    const page = await api.createPage({ title, parentId: parent, markdown: `${source}\n\n${markdown}` } as never);
    const status = newProperty("status", "Status");
    status.value = "Not started";
    const link = newProperty("url", "Link");
    link.value = url;
    await api.setPageMeta(page.id, "properties", [status, link]);
    await s.refreshPages();
    if (open) s.openPage(page.id);
    return page.id;
  } catch (e) {
    s.toast({ message: errorMessage(e), tone: "error" });
    return null;
  }
}

interface Captured {
  kind?: "page" | "selection" | "link" | "article";
  title?: string;
  url?: string;
  text?: string;
}

/** What the browser extension sent: an article to read, or a note with the selection and its source. */
export async function receiveCapture(c: Captured) {
  const s = useStore.getState();
  const url = typeof c.url === "string" && /^https?:\/\//.test(c.url) ? c.url : "";
  if (c.kind === "article" && url) return saveArticle(url, false).then((id) => id && s.toast({ message: tr("Saved to your reading list"), action: { label: tr("Open"), run: () => s.openPage(id) } }));
  try {
    const parent = await holder(CAPTURE_KEY, uiLanguage() === "ar" ? "من المتصفح" : "From the browser");
    const title = (c.title ?? "").slice(0, 200) || url || tr("Captured");
    const quote = (c.text ?? "").trim();
    const md = [quote ? quote.split(/\n+/).map((l) => `> ${l}`).join("\n") : "", url ? `[${(() => { try { return new URL(url).hostname; } catch { return url; } })()}](${url})` : ""].filter(Boolean).join("\n\n");
    const page = await api.createPage({ title, parentId: parent, markdown: md } as never);
    await s.refreshPages();
    s.toast({ message: `${tr("Saved from the browser")}: ${title}`, action: { label: tr("Open"), run: () => s.openPage(page.id) } });
  } catch (e) {
    s.toast({ message: errorMessage(e), tone: "error" });
  }
}

/** Listen for the extension's captures (desktop only). */
export async function listenForCaptures() {
  if (!isTauri || (window as unknown as { __WORLDS_MOCK__?: boolean }).__WORLDS_MOCK__) return;
  const { listen } = await import("@tauri-apps/api/event");
  await listen<Captured>("capture:received", (e) => void receiveCapture(e.payload));
  // A page made through the local API: show it.
  await listen("pages:changed", () => void useStore.getState().refreshPages());
}
