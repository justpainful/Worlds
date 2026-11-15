# enterworlds.space

| Address | What | Source | Deploy |
|---|---|---|---|
| `enterworlds.space` | the landing page | `web/site/` (plain HTML, CSS and one small script) | `npx wrangler deploy -c web/wrangler.toml` |
| `go.enterworlds.space` | Worlds in the browser, with the sample workspace | the app, built by `pnpm build:demo` into `dist-demo/` | `pnpm build:demo`, then `npx wrangler deploy -c web/go.wrangler.toml` |
| `login.enterworlds.space` | the account service | `services/identity` | `pnpm cloud:deploy --domain enterworlds.space` |
| `connect.enterworlds.space` | the sync service | `services/sync` | same command |

All four are Workers on the Cloudflare account that holds the domain. The two web ones serve static files only. The domain must show Active in Cloudflare first.

## The landing page

Design decisions are locked in [docs/web/DESIGN.md](../docs/web/DESIGN.md): the site is a Worlds page, with the workspace tree as navigation and today's Gregorian and Hijri date at the top. Arabic is the default (`/`), English is at `/en/`.

- No framework and no build step. About 38 KB of HTML, CSS and JS, plus the fonts (Instrument Sans, IBM Plex Sans Arabic, IBM Plex Mono; SIL Open Font License, see `site/fonts/LICENSE.txt`).
- `site/_headers` sets a strict Content Security Policy: everything is served from the site itself, with no inline styles or scripts.
- Try it locally with any static server rooted at `web/site`, for example `python -m http.server 1438 --directory web/site`.
- Before shipping a change, run the design scan: `python ~/.claude/skills/antislop/scripts/slop_scan.py web/site` (zero banned items).
