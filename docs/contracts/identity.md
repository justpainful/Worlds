# Identity service contract

The identity service (`services/identity`, a Cloudflare Worker named `worlds-identity`) owns accounts, devices, sessions, workspaces, members, groups, invites, page permissions and the audit log. It never stores page content. This document is the contract the sync service and the desktop app build against. Change it only together with the code and its tests.

## 1. Access tokens

- Format: JWT, header `{ "alg": "EdDSA", "typ": "JWT", "kid": "<key id>" }`, signed with Ed25519.
- Claims, exactly: `{ "sub": "<userId>", "dev": "<deviceId>", "iat": <seconds>, "exp": <seconds> }`. Lifetime is 15 minutes (`ACCESS_TOKEN_TTL_SECONDS`, at most one hour).
- Public keys: `GET /.well-known/jwks.json` returns `{ "keys": [{ "kty": "OKP", "crv": "Ed25519", "x", "kid", "alg": "EdDSA", "use": "sig" }] }`. During rotation the previous key is listed too. Cache for up to 5 minutes; refetch on an unknown `kid`.
- Verifying (sync service): check the signature with the key matching `kid`, require `alg` `EdDSA`, require `exp` in the future. A valid token proves the user and device at issue time only. Revocation reaches the sync service as an event (section 4), so live sessions must also listen for events.

## 2. Service Binding RPC

Bind the identity Worker into the sync Worker with a named entrypoint:

```toml
[[services]]
binding = "IDENTITY"
service = "worlds-identity"
entrypoint = "IdentityRPC"
```

```ts
type Level = "full" | "edit" | "comment" | "view" | "none";

interface IdentityRPC {
  checkAccess(args: { userId: string; workspaceId: string; docId: string }): Promise<{ level: Level }>;
  listDocs(args: { userId: string; workspaceId: string }): Promise<{ docId: string; level: Level }[]>;
}
```

- `docId` is the page id (the same id the desktop app uses for the page row).
- `checkAccess` answers for any doc id. A page the app has not mirrored yet resolves as a top-level page (Members get the workspace default, Guests get `none`).
- `listDocs` returns every mirrored page where the level is not `none`.
- A user who is not a member of the workspace gets `none` / `[]`. Malformed arguments also give `none` / `[]`; the methods never throw for authorization reasons.
- What each level allows on the sync side: `view` receives updates only; `comment` may also send comment operations; `edit` and `full` may send document updates; only `full` may change sharing (that happens here, not in sync).

## 3. Permission rules

1. Workspace roles: Owner, Admin, Member, Guest. Owner and Admin have `full` on every page.
2. Entries on a page are for a user, a group, or everyone in the workspace (`principalType: "workspace"`, `principalId: "*"`), each with one of `full`, `edit`, `comment`, `view`, `none`.
3. Entries are inherited down the page tree. Walking from the page to the root, the nearest entry per principal applies. A page marked restricted (`inherit = false`) is the last page considered.
4. The nearest entry for the user themself wins outright, so it can lower access as well as raise it.
5. Otherwise the level is the highest of: the nearest entry of each of the user's groups, and for Members the nearest workspace-wide entry, or the workspace default level (`edit` unless changed) when the walk reached the root without a restriction.
6. Guests get only what is shared with them or their groups, and at most `edit`.

## 4. Access change events

Every change that can reduce or move access writes an event to the outbox in the same D1 batch as the change, then delivers it at least once to the `REVOCATIONS` queue when bound, and/or as a `POST` to `SYNC_WEBHOOK_URL`. A cron retries undelivered events every five minutes. Consumers must be idempotent (use `id`).

Envelope: `{ "id": "<uuid>", "at": <epoch ms>, "type": "...", ...fields }`.

| type | fields | sync service should |
| --- | --- | --- |
| `access.changed` | `workspaceId`, `docIds: string[] or null` (null: whole workspace), `userIds: string[] or null` (null: anyone) | re-run `checkAccess` for matching live connections; close or downgrade them |
| `member.removed` | `workspaceId`, `userId` | close that user's connections in the workspace |
| `member.role_changed` | `workspaceId`, `userId`, `role` | re-check that user's connections in the workspace |
| `workspace.deleted` | `workspaceId` | close every connection in the workspace |
| `device.revoked` | `userId`, `deviceId` | close every connection authenticated with that `dev` |
| `session.revoked` | `userId`, `deviceId`, `sessionId` | close connections of that device (refresh token theft was detected) |

Webhook requests carry `content-type: application/json`, `x-worlds-event-id: <id>` and, when `SYNC_WEBHOOK_SECRET` is set, `x-worlds-signature: sha256=<hex HMAC-SHA256 of the raw body>`. Answer any 2xx to acknowledge.

## 5. HTTP API (desktop app)

All bodies are JSON. Errors are `{ "error": "<code>", "message": "<human text>" }` with a 4xx status. Authenticated routes take `Authorization: Bearer <access token>`. The optional header `X-Worlds-Actor: user | ai-on-behalf-of-user | automation` labels who is really acting; it is recorded in the audit log.

### Sign-in

| Method and path | Body | Result |
| --- | --- | --- |
| `POST /auth/email/start` | `{ email }` | `{ challengeId, expiresAt }`. A 6 digit code is emailed. Same answer whether or not an account exists. 5 per email per hour |
| `POST /auth/email/verify` | `{ challengeId, code, displayName?, device }` | tokens + `user` + `created`. Creates the account on first use. Codes expire after 10 minutes; 5 wrong tries end the code |
| `POST /auth/passkey/login/options` | `{}` | `{ challengeId, options }` for `navigator.credentials.get` |
| `POST /auth/passkey/login/verify` | `{ challengeId, response, device }` or `{ challengeId, response, handoff: { codeChallenge } }` | tokens, or `{ code }` for the browser handoff |
| `POST /auth/token` | `{ code, codeVerifier, device }` | tokens. PKCE S256: `codeChallenge = base64url(sha256(codeVerifier))` |
| `POST /auth/passkey/ticket` | (auth) | `{ ticket, url }`: open `url` in a browser to add a passkey |
| `POST /auth/passkey/register/options` | `{ ticket }` or auth | `{ challengeId, options }` |
| `POST /auth/passkey/register/verify` | `{ challengeId, response, ticket?, name? }` | `{ ok, passkey }` |
| `POST /auth/refresh` | `{ refreshToken, deviceId, ts, signature }` | new tokens (the refresh token rotates) |
| `POST /auth/logout` | (auth) | signs this device out (revokes it) |

`device` is `{ name, platform?, publicKey? }`, where `publicKey` is a raw Ed25519 key in base64url. When a device has a key, refresh requires `signature = Ed25519(deviceKey, "worlds-refresh.v1:<deviceId>:<ts>:<hex sha256(refreshToken)>")` with `ts` (epoch ms) within five minutes. Presenting a rotated-out refresh token revokes the session.

Tokens: `{ accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt, userId, deviceId }` (times in epoch ms).

Desktop passkey flow: the app listens on a loopback port, opens `GET /passkey?mode=signin&redirect_uri=http://<loopback>:<port>/callback&state=<random>&code_challenge=<S256>` in the system browser, receives `?code&state` on the loopback, and calls `POST /auth/token`.

### Account and devices

`GET /me`, `PATCH /me { displayName?, avatarUrl? }`, `GET /me/devices`, `PATCH /me/devices/:id { name }`, `DELETE /me/devices/:id` (revoke: its sessions end at once), `GET /me/passkeys`, `DELETE /me/passkeys/:id`, `GET /me/audit`.

### Workspaces

| Method and path | Who | Notes |
| --- | --- | --- |
| `POST /workspaces { name }` | anyone signed in | caller becomes Owner |
| `GET /workspaces` | | the caller's workspaces with `role` |
| `GET, PATCH, DELETE /workspaces/:id` | read: members; `PATCH { name?, defaultLevel? }`: Owner, Admin; delete: Owner | non-members get 404 |
| `GET /workspaces/:id/members` | members | |
| `PATCH /workspaces/:id/members/:userId { role }` | Owner: anyone but themself; Admin: between Member and Guest | `owner` only by transfer |
| `DELETE /workspaces/:id/members/:userId` | Owner: anyone else; Admin: Members and Guests; self: leave | |
| `POST /workspaces/:id/leave` | anyone but the Owner | |
| `POST /workspaces/:id/transfer { userId }` | Owner | old Owner becomes Admin |
| `GET, POST /workspaces/:id/groups`, `PATCH, DELETE /workspaces/:id/groups/:gid`, `PUT /workspaces/:id/groups/:gid/members { userIds }` | write: Owner, Admin | |
| `POST /workspaces/:id/invites { role, expiresInHours?, maxUses?, pageId?, level? }` | Owner (any role but owner), Admin (member, guest); with `pageId`: anyone with full access on the page may invite a guest | default 7 days, at most 30 days. A page link also grants `level` on that page when accepted |
| `GET /workspaces/:id/invites[?pageId]`, `DELETE /workspaces/:id/invites/:inviteId` | Owner, Admin; with `pageId`: full access on the page; delete: also whoever made the link | revocation is immediate |
| `GET /invites/:token` | anyone | preview: `{ valid, workspace, role, expiresAt }` or `{ valid: false, reason }` |
| `POST /invites/:token/accept` | signed in | |
| `PUT /workspaces/:id/tree { nodes: [{ id, parentId }], removed?: [id] }` | per node | upserts; unmentioned pages stay. Adding needs edit on the parent (Members may add top-level pages), moving needs edit on page and new parent, removing needs full. Returns `{ applied, rejected: [{ id, reason }] }` |
| `GET /workspaces/:id/access` | members | `{ role, defaultLevel, docs: [{ docId, level }] }` for every mirrored page, `none` included, for offline caching |
| `GET /workspaces/:id/pages/:pageId/permissions` | view on the page | `{ myLevel, inherit, mirrored, entries: [{ principalType, principalId, level, pageId, inherited }] }` |
| `PUT /workspaces/:id/pages/:pageId/permissions { principalType, principalId, level }` | full on the page | |
| `DELETE /workspaces/:id/pages/:pageId/permissions/:type/:principalId` | full on the page | |
| `PATCH /workspaces/:id/pages/:pageId { inherit }` | full on the page | restricting adds a full entry for the caller |
| `GET /workspaces/:id/audit` | Owner, Admin | |

## 6. Audit log

Every security-relevant action writes one row: `{ id, at, workspaceId, actorUserId, actorKind: "user" | "ai-on-behalf-of-user" | "automation" | "system", deviceId, action, targetType, targetId, meta }`. Actions include `account.created`, `auth.signed_in`, `auth.signed_out`, `auth.email_code_sent`, `auth.email_code_failed`, `auth.passkey_failed`, `auth.refresh_reuse_detected`, `passkey.added`, `passkey.removed`, `device.revoked`, `workspace.created`, `workspace.updated`, `workspace.deleted`, `workspace.ownership_transferred`, `member.joined`, `member.left`, `member.removed`, `member.role_changed`, `group.created`, `group.renamed`, `group.deleted`, `group.members_changed`, `invite.created`, `invite.revoked`, `tree.changed`, `permission.set`, `permission.removed`, `page.restricted`, `page.inherit_restored`.

## 7. Personal workspace

The Personal workspace exists only on the device. It is never sent to this service: its pages have `workspace_id = NULL` locally and are not mirrored.

## 8. Running it

```
cd services/identity
pnpm install
pnpm test                         # Vitest inside the Workers runtime (Miniflare)
pnpm db:migrate:local             # create the local D1 schema
pnpm dev                          # http://localhost:8787, codes are printed to the console
```

`pnpm dev` uses an ephemeral signing key unless `.dev.vars` sets `JWT_PRIVATE_JWK` (print one with `pnpm keygen`). For production: create the D1 database and paste its id into `wrangler.toml`, run `pnpm db:migrate:remote`, set the secrets listed at the bottom of `wrangler.toml`, set `ENVIRONMENT` to `production` and the WebAuthn variables to the deployed domain, then `pnpm run deploy`. In the desktop app, Settings > Account > Server sets the base URL.
