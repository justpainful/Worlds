# HTML pages

An HTML page is a Worlds page whose content is one HTML document. Worlds shows it rendered, in its own sandbox, under a base stylesheet that makes plain semantic HTML look like the rest of Worlds. It is for things blocks cannot do well: a calculator, a tracker with its own logic, a designed one-page report, a small interactive explainer.

The rules below are what `html_pages_write` checks. Hard rules are refused with the reason; design rules come back as warnings. `html_pages_rules` returns this file.

## Hard rules (refused)

1. **One self-contained document, at most 1 MB.** Write a full document (`<!doctype html>`, `<html>`, `<head>`, `<body>`) or just the body content; Worlds wraps a fragment.
2. **Nothing from the network.** No `<script src>`, no `<link rel="stylesheet">` or `@import` of a URL, no `<img>`, `<video>`, `<audio>`, `<source>` or CSS `url()` pointing at `http:`, `https:` or `//`. Images are inline SVG or `data:` URIs. The page cannot fetch anything at all: the sandbox blocks the network.
3. **No embedding or navigation tricks.** No `<iframe>`, `<frame>`, `<object>`, `<embed>`, `<base>`, `<meta http-equiv>` or `<form action>`.
4. **Scripts are inline only.** They run in a sandbox with no network, no cookies or storage, and no access to Worlds or other pages. To keep data, use `worlds.save()` (below).

## How the page talks to Worlds

The base runtime adds a small `worlds` object:

- `worlds.state`: the JSON the page last saved, or `null`.
- `worlds.save(value)`: keeps a JSON value (up to 256 KB) with the page, so a tracker or calculator remembers its inputs. Viewers who cannot edit the page can use it, but nothing is saved for them.
- `worlds.lang`: `"ar"` or `"en"`, the app's language.

Links: `<a href="https://...">` opens in the browser after the person clicks. `<a href="worlds://page/PAGE_ID">` opens another Worlds page.

## Design rules (warnings)

Worlds draws the page; the page brings its content. Write semantic HTML first: `h1` to `h3`, `p`, `ul`/`ol`, `table`, `figure`, `details`, `blockquote`, `code`, `button`, `input`, `select`, `label`, `progress`, `meter`. They are already styled like Worlds.

1. **Colours come from the tokens**, never hard-coded: `--w-text`, `--w-text-2`, `--w-text-3`, `--w-surface`, `--w-surface-2`, `--w-line`, `--w-accent`, `--w-good`, `--w-warn`, `--w-bad`. A handful of hex colours for data (chart series) is fine.
2. **Use the building blocks** before writing layout CSS:
   - `.w-grid`: cards in columns that wrap (`style="--w-min: 220px"` sets the narrowest column).
   - `.w-card`: a raised group; `.w-card > h3` is its title.
   - `.w-stat`: a figure with its label: `<div class="w-stat"><b>87</b><span>Biology</span></div>`.
   - `.w-badge` with `.is-good`, `.is-warn` or `.is-bad`.
   - `.w-callout` (with the same three states) for a note that must be seen.
   - `.w-bar`: a progress bar, `<div class="w-bar" style="--value: 0.6"></div>`.
   - `.w-row`: items in a line with even gaps; `.w-muted`: secondary text; `.w-num`: tabular figures.
3. **It works from 360 px to the full page width.** No fixed widths wider than the screen, no `100vh` and no `position: fixed`: the page grows with its content inside Worlds.
4. **Arabic is written right to left.** Put `lang="ar" dir="rtl"` on `<html>` (Worlds adds it when the app is in Arabic and the page sets none), use logical properties (`margin-inline-start`, `text-align: start`), and never `letter-spacing` or `text-transform` on Arabic.
5. **Quiet by default.** No decorative gradients, glows, heavy shadows or animated backgrounds; motion only to show a change, and none under reduced motion. One accent colour.
6. **Real content.** No placeholder text, made-up figures or fake testimonials.

## How it works

- The source lives in the page's metadata (`metadata.html.source`), with the saved state in `metadata.html.state`. Writes from the app or from Claude snapshot the page first, so a change can be undone from the page's history.
- The desktop serves the page from the `whtml:` protocol with `default-src 'none'`, inline scripts and styles only, and the iframe is sandboxed with `allow-scripts` alone (an opaque origin). Fonts are served by the same protocol.
- The base stylesheet and runtime are `src/htmlpage/base.css` and `src/htmlpage/runtime.js`, shared by the desktop protocol and the web version.
