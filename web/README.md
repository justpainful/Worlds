# enterworlds.space

| Address | What | Source | Deploy |
|---|---|---|---|
| `enterworlds.space` | the site: front page, apps, docs, tools, support, privacy, terms | `web/content/` built into `web/site/` by `node web/build-site.mjs` | `node web/build-site.mjs`, then `npx wrangler deploy -c web/wrangler.toml` |
| `app.enterworlds.space` | Worlds on the web, with real accounts and the workspace kept on the account | the app, built by `pnpm build:demo` into `dist-demo/` | `pnpm build:demo`, then `npx wrangler deploy -c web/app.wrangler.toml` |
| `demo.enterworlds.space` | the demo: the sample workspace, no accounts | the app, built by `pnpm build:sample` into `dist-sample/` | `pnpm build:sample`, then `npx wrangler deploy -c web/demo.wrangler.toml` |
| `go.enterworlds.space` | the old address of the web app, now a redirect to `app.` | `web/go/index.js` | `npx wrangler deploy -c web/go/wrangler.toml` |
| `changelog.enterworlds.space` | every release with every change, a page and a map banner for each | `web/changelog/releases/` built into `web/changelog/site/` by `node web/changelog/build.mjs` | `node web/changelog/build.mjs`, then `npx wrangler deploy -c web/changelog/wrangler.toml` |
| `status.enterworlds.space` | checks every address every five minutes and keeps 90 days | `services/status` | `node services/status/deploy.mjs --account <the domain's account id>` |
| `login.enterworlds.space` | the account service | `services/identity` | `pnpm cloud:deploy --domain enterworlds.space` |
| `connect.enterworlds.space` | the sync service | `services/sync` | same command |

All are Workers on the Cloudflare account that holds the domain (see docs/CLOUDFLARE.md for the edge in front of the services). The site, app and demo serve static files only. The domain must show Active in Cloudflare first.

## The site

Design decisions are locked in [docs/web/DESIGN.md](../docs/web/DESIGN.md): the site is laid out like the Worlds book, with `puts "Hello, Worlds!"` written by hand on the front page. Arabic is the default (`/`), English is at `/en/`.

- Pages are HTML fragments in `web/content/{ar,en}` (see `web/content/README.md`). `node web/build-site.mjs` wraps them in the layout, writes `web/site/`, and fails on a dash, a broken internal link, an image without its size, or a page missing in one language. Never edit the generated pages by hand; `site.css`, `site.js`, `fonts/` and `media/` are hand-made.
- The handwriting is `web/content/hello.svg`, made by the scripts in `web/hello/` from a script font that is not in the repository.
- No framework. The fonts (Instrument Sans, IBM Plex Sans Arabic, IBM Plex Mono) are under the SIL Open Font License, see `site/fonts/LICENSE.txt`.
- `site/_headers` sets a strict Content Security Policy: everything is served from the site itself, with no inline styles or scripts.
- Try it locally with any static server rooted at `web/site`, for example `python -m http.server 1438 --directory web/site`.
- Before shipping a change, run the design scan: `python ~/.claude/skills/antislop/scripts/slop_scan.py web/site` (zero banned items).
