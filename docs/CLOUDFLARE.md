# Worlds on your own Cloudflare account

Accounts and live sync run as two small Workers on your Cloudflare account. The free plan is enough to start.

```
pnpm cloud:deploy
```

With a domain on the same Cloudflare account (the official one is `enterworlds.space`):

```
pnpm cloud:deploy --domain enterworlds.space
```

| Address | What answers there |
|---|---|
| `login.<domain>` | the account service: sign-in, passkeys, workspaces, invites |
| `connect.<domain>` | the sync service: live pages and attachments |
| `go.<domain>` | Worlds in the browser (deployed separately, see `docs/web/DESIGN.md`) |
| `<domain>` | the landing page (`web/`) |

The domain is remembered in `services/.deploy/state.json`, so later runs need no flag.

### Domain on another Cloudflare account

A custom domain can only point at a Worker on its own account. When the domain sits on a different account than the services (as enterworlds.space does), keep them apart:

```
pnpm cloud:deploy --domain enterworlds.space --edge-account <the domain account's id>
```

The services stay on their account and their `workers.dev` addresses. `services/edge` goes on the domain's account: it forwards `login.<domain>` and `connect.<domain>` to them unchanged (WebSockets included), and sends the sign-in codes from `no-reply@<domain>` through Cloudflare Email Service, which the account service reaches as its `EMAIL_WEBHOOK_URL`. The edge passes the visitor's IP with a shared secret (`EDGE_SECRET`), so sign-in rate limits still count per person. The Cloudflare user signed in to Wrangler must be a member of both accounts (Manage Account, Members); the services' account is remembered as `servicesAccount`.

The script:

1. installs the service tools if needed
2. opens the browser once so you can allow Cloudflare access
3. sets up email for sign-in codes: with a domain, it turns on Cloudflare Email Sending and sends from `no-reply@<domain>`, and asks for an optional Resend key as the fallback; without one, it asks for a Resend key
4. makes the keys and keeps them in `services/.deploy/` (git-ignored)
5. creates the D1 database and its tables
6. deploys the account service
7. creates the R2 bucket for attachments
8. deploys the sync service
9. connects the two services
10. saves both addresses in Worlds on this PC

You can run it again at any time. It reuses what already exists and keeps the same keys, so nobody is signed out.

## What you may be asked to do in the Cloudflare dashboard

- **Pick a workers.dev name.** A new account needs one before its first deploy. Choose any name under Workers & Pages.
- **Turn on R2.** Choose R2 and press Enable. It is free up to 10 GB.
- **Wait for the domain.** A domain just added to Cloudflare must show Active before `login.` and `connect.` answer.

## Email

Sign-in codes go out through the first provider that accepts them:

1. **Cloudflare Email Service** through the Worker's `send_email` binding, from `no-reply@<domain>`. No API key; the domain gets its SPF and DKIM records when Email Sending is turned on.
2. **Any HTTP endpoint**, when `EMAIL_WEBHOOK_URL` is set (on enterworlds.space, Cloudflare Email Service through `services/edge`, which needs the Workers Paid plan on the domain's account).
3. **Resend**, when `RESEND_API_KEY` is set (free, 100 a day).
4. **Brevo**, when `BREVO_API_KEY` is set (free, 300 a day).

Without a paid plan, Resend and Brevo together carry about 400 codes a day. Verify the domain with both (Resend: Domains; Brevo: Senders, Domains), then run the script once with `--domain-verified` so both send from `no-reply@<domain>`; until then Resend uses its test sender. The script asks for both keys, hidden, when run in a terminal.

So one provider's daily limit or outage never stops sign-in. The email is written in the language the app asks for (`lang: "ar"` or `"en"`), else the device's language.

Without your own domain, Resend's test sender only delivers to the address you signed up to Resend with. To invite other people, add your domain in Resend. Then run the script again with `services/.deploy/state.json` removed, so it asks for the sender address again.

## Moving to a new domain

Passkeys belong to the address of the account service. After moving from `workers.dev` to `login.<domain>`, people sign in once with the email code and add a passkey again. The `workers.dev` address keeps answering, so apps that still point there keep working until they move.
