# Worlds control dashboard

admin.enterworlds.space, for the team only. Plan: docs/admin/PLAN.md.

- Static React page; everything comes from the identity service's `/admin` API
  (services/identity/src/routes/admin.ts), which checks the team role and the second
  check on every request.
- Sign in with a passkey (WebAuthn related origins: login.enterworlds.space serves
  `/.well-known/webauthn` naming this origin) or an email code. The dashboard never creates
  accounts.
- Owners: the account ids in `ADMIN_OWNERS` (services/.deploy/state.json `adminOwners`).
  Owners add moderators and support from the Team page.

Local: start `admin-identity` and `admin-ui` from .claude/launch.json (local D1 with
made-up accounts; sign-in codes print in the service log).

Build and deploy (deploy needs the owner's yes):

    npx vite build --config web/admin/vite.config.ts
    npx wrangler deploy -c web/admin/wrangler.toml
