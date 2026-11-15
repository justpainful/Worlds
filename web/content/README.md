# Site content (enterworlds.space)

Every page of the site except the generated layout lives here as an HTML fragment, once in Arabic and once in English:

- `ar/<path>.html` is served at `/<path>/` (Arabic is the main language, `dir="rtl"`).
- `en/<path>.html` is served at `/en/<path>/`.
- `ar/index.html` and `en/index.html` are the front pages.

`node web/build-site.mjs` wraps each fragment in the layout (header, docs sidebar, footer) and writes it to `web/site/`. The docs sidebar comes from `nav.json`. Never edit the generated files in `web/site/` by hand.

## A fragment

```html
<!--
title: Install on Windows
description: One sentence for search results and link previews.
-->
<h1>Install on Windows</h1>
<p class="lead">One or two sentences: what this page gets you.</p>
...
```

- Start with `<h1>`, then `<p class="lead">`. Use `<h2>` for sections and `<h3>` inside them; give every `<h2>` an `id` in English kebab case (the same id in both languages) so the page can be linked.
- Links inside the site are absolute: `/docs/install/windows/` in Arabic files and `/en/docs/install/windows/` in English ones. External links are full `https://` URLs.
- No inline `style`, no `<script>`, no classes other than the ones below.

## Building blocks (styled by `web/site/site.css`)

| Markup | Use |
| --- | --- |
| `<ol class="steps"><li><h3>Step title</h3><p>...</p></li></ol>` | Numbered steps. Each step can hold paragraphs, a figure, a callout. |
| `<figure class="shot"><img src="/media/book/p10.webp" alt="..." width="1600" height="1000" loading="lazy"><figcaption>...</figcaption></figure>` | A real screenshot from the app. Always set `width`, `height` and a real `alt`. |
| `<figure class="sketch"><svg viewBox="0 0 640 360" role="img" aria-label="...">...</svg><figcaption>...</figcaption></figure>` | A drawn diagram of a system dialog or a step we cannot screenshot (Windows SmartScreen, macOS Open, Android settings). See "Sketches". |
| `<div class="callout"><p>...</p></div>` | A note that must be seen. `class="callout warn"` for a warning. |
| `<dl class="facts"><div><dt>File</dt><dd>...</dd></div>...</dl>` | Short label and value pairs: file name, size, requirements. |
| `<table>` with `<thead>` | Comparisons (platform by feature, shortcut by action). |
| `<kbd>Ctrl</kbd> + <kbd>K</kbd>` | Keys. |
| `<code>` and `<pre><code>` | File names, paths, commands, code. |
| `<ul class="index"><li><a href="..."><strong>Title</strong><span>One line</span></a></li></ul>` | A list of pages to go to next. |

## Sketches

Inline SVG with `viewBox="0 0 640 360"`. Draw only rectangles, rounded rectangles, lines, circles and `<text>`. Colours come from these classes, never from hex values, so the sketch follows light and dark mode:

- `k-win`: a window or dialog (fill and border). `k-bar`: a title bar or toolbar strip.
- `k-field`: an input, toggle track or list row. `k-btn`: an ordinary button. `k-primary`: the main button (filled).
- `k-text` (main text, 15 to 18 px), `k-muted` (secondary text, 12 to 14 px), `k-on` (text on `k-primary`).
- `k-ring`: the thing to click (a 3 px outline, no fill). `k-num` + `k-numtext`: a numbered marker (circle and its digit) next to a ring.
- `k-line`: a hairline.

Keep text in sketches in the page's language, short, and true to what the system really shows (Windows and macOS dialogs show English or Arabic depending on the system; write the words the reader will see in their language and mention the other in the text). Add `font-family="inherit"` on the `<svg>`.

## Writing

- Arabic first, plain and direct, for a student or a small business owner. English says the same thing.
- Only what is true in the code and the released builds. If something is not built yet, say so plainly or leave it out.
- No em dashes or en dashes anywhere. Use a comma, a colon or a new sentence.
- No marketing phrases ("seamless", "powerful", "unlock", "سلس", "قوي", "ثوري").
- In Arabic, write numbers and versions as they appear in the app (Latin digits), and keep product names, file names and buttons in their real spelling.
