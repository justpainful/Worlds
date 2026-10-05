# Worlds on your own Cloudflare account

Accounts and live sync run as two small Workers on your Cloudflare account. The free plan is enough to start.

```
pnpm cloud:deploy
```

The script:

1. installs the service tools if needed
2. opens the browser once so you can allow Cloudflare access
3. asks for a Resend API key, which is used to email sign-in codes
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

## Email

Without your own domain, Resend's test sender only delivers to the address you signed up to Resend with. To invite other people, add your domain in Resend. Then run the script again with `services/.deploy/state.json` removed, so it asks for the sender address again.
