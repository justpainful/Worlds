// The document an HTML page's frame receives, built in the browser for the
// web version (the desktop builds the same in src-tauri/src/html_page.rs and
// serves it from whtml:). Base styles and the runtime go first in <head>, so
// the page's own styles win.
import baseCss from "./base.css?raw";
import runtimeJs from "./runtime.js?raw";

/** The app's current theme, for frames that follow it. */
export const appTheme = (): "dark" | "light" => (typeof document !== "undefined" && document.documentElement.dataset.theme === "light" ? "light" : "dark");

export function composeHtmlPage(source: string, state: unknown, lang: "ar" | "en", theme: "dark" | "light" = appTheme()): string {
  const boot = JSON.stringify({ state: state === undefined ? null : state, lang, theme }).replace(/<\//g, "<\\/");
  const head =
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<style data-worlds-base>${baseCss}</style><script>window.__worldsBoot=${boot};</script><script>${runtimeJs}</script>`;
  const langAttrs = lang === "ar" ? ` lang="ar" dir="rtl"` : ` lang="en"`;
  const html = /<html(\s[^>]*)?>/i.exec(source);
  if (!html) return `<!doctype html><html${langAttrs}><head>${head}</head><body>${source}</body></html>`;
  let doc = source;
  if (!/\slang\s*=/i.test(html[0])) {
    doc = doc.slice(0, html.index) + html[0].slice(0, -1) + langAttrs + ">" + doc.slice(html.index + html[0].length);
  }
  const headTag = /<head(\s[^>]*)?>/i.exec(doc);
  if (headTag) {
    const at = headTag.index + headTag[0].length;
    doc = doc.slice(0, at) + head + doc.slice(at);
  } else {
    const opened = /<html(\s[^>]*)?>/i.exec(doc)!;
    const at = opened.index + opened[0].length;
    doc = doc.slice(0, at) + `<head>${head}</head>` + doc.slice(at);
  }
  return /^\s*<!doctype/i.test(doc) ? doc : `<!doctype html>${doc}`;
}

/** A first page that shows the building blocks working, in the person's language. */
export function starterHtml(lang: "ar" | "en"): string {
  if (lang === "ar") {
    return `<main lang="ar" dir="rtl">
<h1>أسبوعي</h1>
<p class="w-muted">صفحة HTML: اكتبها بنفسك من «المصدر»، أو اطلب من Claude يبني لك أداة أو تقريرًا هنا.</p>
<div class="w-grid" style="--w-min: 160px">
  <div class="w-card w-stat"><b id="done">0</b><span>مهام منجزة</span></div>
  <div class="w-card w-stat"><b id="left">3</b><span>باقية</span></div>
</div>
<div class="w-card">
  <h3>اليوم</h3>
  <label><input type="checkbox" data-task="0"> مراجعة الفصل الثالث</label><br>
  <label><input type="checkbox" data-task="1"> حل الواجب الرابع</label><br>
  <label><input type="checkbox" data-task="2"> إرجاع كتاب المكتبة</label>
  <div class="w-bar" id="bar" style="--value: 0; margin-top: 12px"></div>
</div>
</main>
<script>
  const boxes = [...document.querySelectorAll("[data-task]")];
  const done = new Set((worlds.state && worlds.state.done) || []);
  const show = () => {
    boxes.forEach((b) => (b.checked = done.has(Number(b.dataset.task))));
    document.getElementById("done").textContent = done.size;
    document.getElementById("left").textContent = boxes.length - done.size;
    document.getElementById("bar").style.setProperty("--value", done.size / boxes.length);
  };
  boxes.forEach((b) => b.addEventListener("change", () => {
    const n = Number(b.dataset.task);
    b.checked ? done.add(n) : done.delete(n);
    worlds.save({ done: [...done] });
    show();
  }));
  show();
</script>`;
  }
  return `<h1>My week</h1>
<p class="w-muted">An HTML page: write it yourself under Source, or ask Claude to build a tool or a report here.</p>
<div class="w-grid" style="--w-min: 160px">
  <div class="w-card w-stat"><b id="done">0</b><span>Tasks done</span></div>
  <div class="w-card w-stat"><b id="left">3</b><span>Left</span></div>
</div>
<div class="w-card">
  <h3>Today</h3>
  <label><input type="checkbox" data-task="0"> Review chapter 3</label><br>
  <label><input type="checkbox" data-task="1"> Finish homework 4</label><br>
  <label><input type="checkbox" data-task="2"> Return the library book</label>
  <div class="w-bar" id="bar" style="--value: 0; margin-top: 12px"></div>
</div>
<script>
  const boxes = [...document.querySelectorAll("[data-task]")];
  const done = new Set((worlds.state && worlds.state.done) || []);
  const show = () => {
    boxes.forEach((b) => (b.checked = done.has(Number(b.dataset.task))));
    document.getElementById("done").textContent = done.size;
    document.getElementById("left").textContent = boxes.length - done.size;
    document.getElementById("bar").style.setProperty("--value", done.size / boxes.length);
  };
  boxes.forEach((b) => b.addEventListener("change", () => {
    const n = Number(b.dataset.task);
    b.checked ? done.add(n) : done.delete(n);
    worlds.save({ done: [...done] });
    show();
  }));
  show();
</script>`;
}
