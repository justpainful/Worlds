# Worlds sync protocol

How shared pages stay in sync between computers. The architecture is in [COLLAB.md](COLLAB.md), the identity side in [contracts/identity.md](contracts/identity.md); this is the wire protocol and the moving parts.

## Pieces

| Where | What |
| --- | --- |
| `services/sync` | Cloudflare Worker. `DocRoom` Durable Object per document, `WorkspaceHub` per workspace (live documents, upload ledger), `UserInbox` per user (notifications), R2 for attachments |
| `src-tauri/src/sync` | Local replica in SQLite (migration 6): snapshot and update log per page, outbox, cursors, attachment upload queue, the guarded block mirror |
| `src/sync` | `WorldsProvider` (connection), `CollabSession` (one shared page), block mirror, comments, attachments, UI |

A page is shared when it has a `workspace_id` (Team workspace) or the testing flag `metadata.sync.shared`. Personal pages never touch any of this.

## Identity and access

- Every request carries an access token: an EdDSA (Ed25519) JWT with claims `{ sub, dev, iat, exp }`, verified against the identity service's JWKS (`GET /.well-known/jwks.json`, URL in `JWKS_URL`). Optional `JWT_ISSUER` and `JWT_AUDIENCE` are checked when set. Keys are cached for 5 minutes and refetched on an unknown `kid`.
- Tokens live 15 minutes. An open connection gets a fresh one with AUTH_REFRESH a minute before expiry (same user and device), so sockets do not reconnect every quarter hour.
- Rights come from the identity service over a Service Binding to its `IdentityRPC` entrypoint: `checkAccess({ userId, workspaceId, docId }) -> { level }` with `level` one of `full`, `edit`, `comment`, `view`, `none`. The document id is the page id.
- Enforcement:
  - on connect: `none` is refused (HTTP 403);
  - on every write: the level is re-checked when the cached answer is older than `ACCESS_TTL_MS` (30 s). `view` may not write, `comment` may write only the comments sub-document, `edit` and `full` may write both;
  - comment writes are also held to authorship: nobody posts as someone else, edits someone else's words, or deletes someone else's thread (except `full`);
  - an expired token closes the socket with 4401.
- Access change events from the identity service arrive as a signed webhook, `POST /internal/events` with `x-worlds-signature: sha256=<hex HMAC-SHA256 of the body with SYNC_WEBHOOK_SECRET>`, and/or through its `REVOCATIONS` queue (the Worker's `queue` handler). `access.changed` and `member.role_changed` re-run `checkAccess` at once for the matching live connections (close on `none`, otherwise push the new level); `member.removed` closes that member's connections in the workspace; `workspace.deleted` closes everyone; `device.revoked` and `session.revoked` close that device's connections in every workspace (each user's inbox object remembers the documents they connected to). Handling is idempotent; unknown event types are acknowledged and ignored.
- `POST /internal/revoke` (header `Authorization: Bearer <INTERNAL_SECRET>`), an operator tool with body `{ userId, workspaceId, docId?, deviceId?, level? }`. Without `docId` it reaches every live document of the workspace. With no `level` (or `none`) the user's sockets close with 4403; with a lower level they stay open and receive the new level. Everyone else re-checks on their next write. Response `{ ok, affected }`.

## WebSocket

`GET /v1/workspaces/:workspaceId/docs/:docId/sync` with `Upgrade: websocket`. Browsers pass the token as a subprotocol: `Sec-WebSocket-Protocol: worlds-sync.v1, bearer.<jwt>`; the server answers `worlds-sync.v1`. Other clients may use `Authorization: Bearer <jwt>`. The text frame `ping` is answered `pong` without waking the object.

Every binary frame is a lib0 `varUint` message type followed by its payload. Two Yjs documents share one connection, chosen by a channel number: `0` content (Tiptap's `default` XML fragment, plus the `attachments` directory map), `1` comments.

| Type | Name | Direction | Payload |
| --- | --- | --- | --- |
| 0 | SYNC | both | `varUint channel`, `varUint kind` (0 step 1, 1 step 2, 2 update), `varUint8Array data` (y-protocols sync) |
| 1 | AWARENESS | both | `varUint8Array` y-protocols awareness update |
| 2 | QUERY_AWARENESS | client to server | none |
| 3 | AUTH_STATE | server to client | `varString level`, `varString userId` |
| 4 | UPDATE | client to server | `varUint batchId`, `varUint channel`, `varUint8Array update` |
| 5 | ACK | server to client | `varUint batchId`, `varUint status` (0 ok, 1 denied, 2 invalid), `varString reason` |
| 6 | NOTICE | server to client | `varString code`, `varString message` |
| 7 | AUTH_REFRESH | client to server | `varString token` (a fresh access token; answered with AUTH_STATE, or closed with 4401 if refused) |

Close codes: 4401 token missing, invalid or expired (refresh the token and reconnect), 4403 access removed (do not reconnect; the client drops its replica of the page), 4413 message too large (limit 4 MB), 4503 access check unavailable (reconnect later).

### Handshake and outbox

1. Server, on accept: AUTH_STATE, then SYNC step 1 (its state vector) for both channels, then the known presence.
2. Client, on open: SYNC step 1 for both channels and its presence.
3. Server answers a step 1 with step 2 (what the client lacks). The client applies it as remote.
4. Client answers the server's step 1 with an UPDATE (not a plain step 2) holding everything the server lacks, remembering the largest outbox id it covered. When the ACK is ok it deletes outbox rows up to that id. This is how offline work drains.
5. Live edits: each local change is written to the local log and the outbox first, then sent as UPDATE; its ACK deletes its outbox row.

The server persists an update in the object's SQLite storage before it broadcasts it or acknowledges it. A refused update (ACK denied) is kept in the outbox marked `rejected` and the client drops and rebuilds that channel's replica from the server; the user sees "Needs attention".

Presence: the server stamps `user.id` with the token's subject (clients cannot pose as someone else), keeps states in memory and removes a socket's states when it closes.

## Durable Object storage (`DocRoom`)

- `updates(seq, channel, data, user_id, created_at)`: accepted updates, in order.
- `snapshots(channel, chunk, upto, data)`: compacted state per channel, split in 1 MB chunks. After `COMPACT_EVERY` updates (500) the log folds into a snapshot, never while updates wait for missing dependencies.
- `versions` and `version_chunks`: versions of the content document with the user ids who contributed since the previous version. A version is cut when the first edit arrives after `VERSION_INTERVAL_MS` (10 min), when the last person leaves, and on request. The newest 200 are kept.
- Objects hibernate between messages; state reloads from storage on wake.

## HTTP

All under `/v1`, `Authorization: Bearer <jwt>`, access checked per request.

| Method and path | Access | Result |
| --- | --- | --- |
| `GET .../docs/:doc/state?channel=comments` | view | Full Yjs state (binary) |
| `GET .../docs/:doc/versions` | view | `{ versions: [{ id, createdAt, label, authors, size }] }` |
| `POST .../docs/:doc/versions` `{ label }` | edit | Cut a version now |
| `GET .../docs/:doc/versions/:id` | view | That version's state (binary) |
| `POST .../docs/:doc/attachments/uploads` `{ sha256, size, mime }` | edit | Upload plan (below) |
| `POST .../docs/:doc/attachments/uploads/:sha256/complete` | edit | Finish a multipart upload |
| `GET .../docs/:doc/attachments/:sha256` | view | `{ size, mime, url, expiresAt }` with a signed download URL |
| `GET /v1/notifications?before=&limit=` | signed in | `{ items, unread }` newest first |
| `POST /v1/notifications/read` `{ ids }` | signed in | Mark read (`ids: null` marks all) |

## Attachments

Objects are keyed by content: `ws/<workspaceId>/sha256/<hex>`, so the same bytes are stored once per workspace and uploads are idempotent.

- The plan answers `complete` (already stored), `single` (one signed `PUT`; R2 verifies the hash) or `multipart` (signed `PUT` URL per missing part, `partSize` 8 MB, `partsDone`). Asking again resumes: only missing parts are listed. Completion re-hashes the stored object and deletes it on mismatch.
- Downloads use the signed URL and support `Range` (206) to resume.
- Signed URLs are HMAC-SHA256 (`SIGNING_SECRET`) over operation, workspace, hash, user, expiry, and for parts the upload id and part number; they last an hour and are only issued after `checkAccess`.
- On the desktop, the content document keeps `attachments: id -> { sha256, size, mime, fileName }`. The computer that has a file uploads it; the others download it, check the hash and store it under the same attachment id (`sync_attachment_store`), so page nodes resolve everywhere.

## Comments sub-document (channel 1)

```
threads: Map<threadId, Map {
  id, anchor { start, end }   // Yjs relative positions in the content document
  quote, createdBy, createdAt,
  resolved, resolvedBy, resolvedAt,
  comments: Array<Map { id, author, body, mentions[], createdAt, editedAt?, deleted? }>
}>
people: Map<userId, { name, color }>   // for mentions; each user writes only their own entry
```

New comments notify mentioned users (`mention`) and earlier participants (`reply`) through their `UserInbox`, only if `checkAccess` says they can open the page. Notifications are idempotent by `commentId:userId`.

## Desktop: local replica and block mirror

Migration 6 adds:

- `sync_docs(page_id, channel, snapshot, snapshot_upto, mirror_rev, mirror_state)`
- `sync_updates(id, page_id, channel, data, origin)` local update log
- `sync_outbox(id, page_id, channel, data, attempts, state, last_error)`
- `sync_cursors(page_id, channel, server_vector, level, synced_at, last_error)`
- `sync_attachment_queue(attachment_id, page_id, workspace_id, sha256, size, status, parts_done, attempts, last_error)`

The block rows stay the readable form of every page. A shared page's session mirrors its document into the rows (debounced) with `sync_mirror_write(blocks, baseRev, state)`. If the rows changed since `baseRev` (Claude through MCP, an automation) nothing is written; the current rows come back and the session folds them into the document: it replays "last mirrored rows to current rows" on a copy of the last mirrored Yjs state and merges that edit, so concurrent typing by others is kept. Then it writes again. MCP writes to a shared page that is not open are folded by the background manager. The first mirror over existing rows keeps them as a version ("Before live sync").

Sharing a page for the first time on a computer: if the server already has the document, its content wins (and the old rows stay restorable); otherwise the document is seeded from the rows.

## Run it locally

```
cd services/sync
pnpm install
cp .dev.vars.example .dev.vars
pnpm dev:identity      # local identity stand-in on 8791 (JWKS, /dev/token, /dev/grant)
pnpm dev               # sync service on 8790
```

With accounts (the real flow): run `services/identity` too (see its contract, section 8), point its `SYNC_WEBHOOK_URL` at `http://localhost:8790/internal/events` with the same `SYNC_WEBHOOK_SECRET`, run this service with its default environment (`wrangler dev --port 8790 --var JWKS_URL:http://localhost:8787/.well-known/jwks.json`), sign in to Worlds (Settings > Account) and set the Live Sync server (Ctrl+Alt+Shift+S on a page) to `http://localhost:8790`. Pages in a Team workspace then sync on their own; the access token comes from the account (`sync_access_token`).

Without accounts (quick testing): `pnpm dev:identity` and `pnpm dev` above, mint a token with `GET http://localhost:8791/dev/token?sub=alex`, open a page, press Ctrl+Alt+Shift+S (Live Sync), enter the server (`http://localhost:8790`), the token and a workspace name, then Share Page. Do the same on a second computer or profile with another `sub` and the same page id.

Tests:

```
cd services/sync && pnpm test                      # Workers runtime: sync, permissions, compaction, attachments
pnpm test                                          # app: provider, mirror, sessions (fake server)
WORLDS_SYNC_E2E=1 pnpm test src/sync/e2e.test.ts   # app against the running local service
```

## Configuration

| Name | Kind | Meaning |
| --- | --- | --- |
| `JWKS_URL` | var | Identity JWKS |
| `JWT_ISSUER`, `JWT_AUDIENCE` | var, optional | Extra token checks |
| `INTERNAL_SECRET` | secret | Bearer for `/internal/revoke` |
| `SYNC_WEBHOOK_SECRET` | secret | HMAC key shared with the identity service for `/internal/events` |
| `SIGNING_SECRET` | secret | HMAC key for signed attachment URLs |
| `ALLOWED_ORIGINS` | var | CORS origins, comma separated or `*` |
| `COMPACT_EVERY`, `VERSION_INTERVAL_MS`, `ACCESS_TTL_MS`, `PART_SIZE` | var | Tuning |
| `IDENTITY` | service binding | The identity service, entrypoint `IdentityRPC` (`checkAccess`) |
| `BLOBS` | R2 | Attachments |
