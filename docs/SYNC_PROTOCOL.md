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

### Drawing lease authority

`GET /v1/workspaces/:workspaceId/docs/:docId/drawing/leases` lists active lease target, owner/device, fence and expiry to authorized viewers. It never includes acquisition nonces or tokens.

`POST` on the same path requires edit/full rights and an authenticated device. The JSON request is one of:

- `{ action: "acquire", target: "node:<id>", requestId: "<random retry nonce>" }`
- `{ action: "renew", target, token, fence }`
- `{ action: "release", target, token, fence }`

Targets may use node/layer/frame/order prefixes. Expiry is 15 seconds on the server clock. Repeating an acquisition nonce on the same authenticated device returns its still-live lease. New ownership gets a strictly greater persisted fence. An expired/replaced token cannot renew or release a newer lease. Acquisition checks identity independently and refuses access changes which race its validation. Capacity is bounded. Rooms holding HTTP leases remain discoverable by workspace and user revocation even without a WebSocket.

Signed device/session revocations also persist a per-user token denial record: device revocation stays permanent for that device ID, while session revocation rejects tokens issued at/before the event and allows a later authenticated session. HTTP authentication checks this record, so closing sockets cannot be bypassed with the old token. Repeated older events do not move the cutoff backwards.

The lease endpoint and canonical drawing journal are implemented and tested. Protected artwork writes carry current lease proofs. Existing text Yjs messages do not synchronize drawing scenes.

### Canonical drawing journal and native replica

`GET .../drawing/state?generation=<uuid>&after=<revision>` returns the full checkpoint, or operations after the acknowledged revision when the generation matches. Every response carries the freshly checked access level. `PUT .../drawing/state` seeds a missing drawing from a validated local journal; it preserves history while mapping the importing local author to the authenticated account. Other imported authors retain explicit imported provenance. `POST .../drawing/operations` validates and appends one authenticated operation, optional captured preconditions, current fenced lease proofs and immutable original/version directory additions.

The DocRoom stores seed and operation JSON in bounded SQLite binary chunks and reconstructs its cache after eviction. Immutable receipts make retries idempotent even after an acknowledgement is lost. Independent new elements merge their stacking order; existing-field edits can rebase only while the captured fields retain their expected values. A conflicting property, reused identifier, replaced generation or rewritten immutable history is refused. Frame/layer/root leases cover their protected elements, including newly inserted elements. Rights, device/session revocation and access epochs are checked for drawing HTTP requests independently of text sockets.

Original directory entries name SHA-256, byte size, MIME and filename. Writes cannot reference a missing R2 object. Pinned version scenes and their transitive original/version dependencies are validated before accepting the journal. The desktop uploads originals through the existing authenticated attachment protocol, verifies downloaded bytes and establishes native page ownership before accepting references. Attachment IDs already owned by another local resource cause a recoverable conflict instead of exposing or replacing that resource's original.

Desktop migration 9 adds drawing_sync_state, drawing_sync_outbox, drawing_sync_recoveries and drawing_sync_originals. Local edits enter the SQLite drawing journal and sync outbox in one transaction. Native checkpoint acceptance checks the expected local revision, canonical history, original ownership/checksums and author mapping; it removes acknowledged operations and conditionally reapplies the remaining local queue. Conflicts retain the local document, queue and incoming checkpoint. A renderer-session gate serializes native checkpoints and local writes while rebasing pointer input received during the checkpoint. Checkpoints themselves are serialized, including simultaneous requests while the writer is idle.

The drawing manager starts at application readiness, resumes pending drawings without an open editor, uses a shared stream across panes, reacts to MCP writes and sharing changes, and retires drained closed pages. It stops old transports before switching account/server settings and never obtains a new account token for an old transport. The editor exposes local/offline/pending/synchronized/conflict/read-only states and hides cached artwork after an access denial.

Explicit recovery fetches a fresh authorized checkpoint, then serializes the renderer/native writers. A durable stable nonce protects retries. One native transaction archives both original journals and queues, creates a separate unshared drawing with independently owned originals/pinned dependencies, keeps the previous native scene as a named version, and adopts the shared checkpoint only after the copy is durable. Failed recovery rolls back its copy and outbox removal. Renderer-only input stays retained until both native commit and local recovery-record replacement succeed. Source View rights and account identity apply to recovery and retry.

Worker/transport and SQLite/reopen regression tests pass. `cargo build --example drawing_replica` inside src-tauri, then `node scripts/drawing-native-smoke.mjs` at the repository root, runs two real isolated native replicas with the actual TS transport and local Workers, including restart/original transfer/undo/conflict recovery/revocation and live drawing collaboration. This headless integration has passed; native multi-computer UI acceptance has not been performed. Shared library metadata, transient in-progress artwork previews, gesture-start lease UX, explicit export policy and drawing-specific version restore remain unfinished.

### Drawing comments and ephemeral collaboration

DrawingLiveSession uses the existing provider's durable comments channel and authenticated awareness without the text block mirror. A drawing comment anchor is `{kind:"drawing", frameId, nodeId, u, v, region:{x,y,w,h}, fallback:{x,y}}`: region coordinates are relative to the frame, node u/v follow its transform, and the fallback remains usable after a target disappears. Text comments keep their existing relative-position anchors. Drawing anchors and CRDT map/array structure are validated by the server; comments/replies/mentions/resolve retain the existing author/role rules and notification checks. Notification navigation opens the drawing's actual thread and region.

Awareness's `drawing` field carries frame/cursor/tool/selection/camera/follow and an optional shared camera location and colored laser chunk. It never enters the scene, original directory or durable update log. Coordinates, sample count, colors and width/opacity/lifetime are bounded; sending is throttled to 25Hz. The server forces the real authenticated user ID and refuses another user/device claiming an owned client ID. A reconnect on the same authenticated device transfers that client ID so the previous socket's eventual close cannot erase the replacement's presence. Read, awareness and awareness-query messages now revalidate access through the same cached/revocation-aware authority as writes. Receivers expire a remote laser even if its final release packet is lost.

Failed local CRDT appends remain in memory and block synchronization from claiming success or sending the unsaved state. The provider retries a full causal CRDT checkpoint before reconnecting. Drawing sessions pause networking immediately on close/account changes and retain their document until outstanding local persistence succeeds. Refused comment changes remain in the existing rejected outbox; the UI shows attention and can reconnect to accepted state, but a rejected-comment review/export screen remains unfinished.

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

## Transient drawing previews and gesture handoff

Drawing awareness can include a bounded draft: stroke, shape or a movement of existing IDs. Drafts are never sent to the canonical journal, generic durable outbox, saved versions, portable project or export renderer. Receivers use local receipt time, a new sequence and a three-second expiry; idle presence heartbeats cannot resurrect an expired draft. The final committed element ID suppresses its older preview. Stroke previews use at most 128 whole-path samples and a validated paint-work budget; the durable stroke retains its complete samples.

The server strips artwork drafts from view/comment members. Movement previews require an active lease owned by the authenticated user and device for every moved element. New-stroke/shape previews respect locked layers and another owner's overlapping scopes. Presence contains no lease token or acquisition nonce.

A desktop move gesture acquires its reservation before applying the visible transformation. Its private proof is shared with the operation transport and held until exact final operation IDs have been accepted into the native canonical checkpoint, or a bounded acknowledgement hold ends. Refcounts preserve overlapping local gestures and requests; an earlier release finishes before reacquisition. A four-second renewal cadence and twelve-second local validity margin guard the server's fifteen-second fencing lease. Unavailable networking is an explicit offline-local state, while denied or replaced ownership aborts the gesture. Public listings show owner/target/fence/expiry without private proofs. Headless two-native-process integration covers contention, acknowledgement handoff, transient previews and cleanup; native multi-pane UI acceptance remains separate.

## Version restore and refused comment archives

A version restore is one ordinary operation with a versionRestore receipt naming its saved target, exact preview revision and previous-state version. The previous scene and new edit commit in one native SQLite transaction. A retry uses the same restore/backup ID; current access is checked again. Shared restore uses a root lease and refuses any post-preview revision, including independent additions. Restore undo is author-only through the existing journal and root scope. Originals and transitive pins are checked before restoration.

Migration 10 adds owned sync_rejected_snapshots. When a write is refused, the provider pauses old networking and archives the full causal channel state before resetting it. Archival, pending-outbox rejection and active-replica reset are one native transaction. Late local input updates that archive before reset is emitted. Failed archival keeps the old state and memory, blocks success and retries. Rejected archives never enter the outgoing queue. Read/list commands recheck page View access and the bound account; the drawing UI also hides review on a fresh live revocation. The review UI exports only the current owner's visible comment text or explicitly creates a fresh authorized discussion. It never reapplies the refused CRDT. Raw refused entries predating the archive feature remain preserved; their missing old causal context is not assumed recoverable.

The database open path now refuses an older-schema migration if its central pre-migration backup fails. This covers MCP/background entry points as well as startup. A newer schema requires a newer app. Existing startup recovery can also keep its own pre-migration copy.

## Independent drawing export policy

Authenticated GET/PUT drawing/export-policy reads or changes a separate revisioned policy for images, editable projects/library files, and owned refused-comment text. The default minimum is View for each class. Only current Full members can update it. Updates carry requestId, expectedRevision and all three rules; immutable receipts reject request-ID reuse and stale revisions. The policy and its receipts are stored independently of the canonical scene, artwork journal, versions and undo.

POST drawing/export-authorize rechecks the authenticated device/session and primary page role, policy class, optional canonical generation and independently referenced source pages. Sources are bounded and checked through identity in batches, then the primary access is checked again. An internal source-only class authorizes source reading, never native output. A nondefault personal initial policy requires Full when it first enters shared authority; ordinary artwork initialization cannot overwrite an already configured policy.

Native image/project/TXT saving receives a length-prefixed JSON context followed by the exact prepared artifact bytes. The context includes a transient token only when shared pages/sources require it. It validates limits, frame/region/annotation scope, project originals/transitive pins, archive ownership and bound account/current configured server. Redirects are disabled; server responses must identify the same bound user. A fresh authoritative check runs before a final local binding/source recheck and same-directory atomic file write. Rejection preserves the existing destination. Tokens are not persisted or included in output. Personal exports without shared dependencies work offline. Shared policy cache and personal initial rules have separate storage, so a default server read cannot erase pre-share rules.

This secures managed direct-save and clipboard-check paths. Managed duplicate/template/experiment/library publication, insertion and materialization now also use the project rule. Native copy planning gathers the exact source scenes, transitive pins and relevant original owners, then releases the database lock while obtaining current authorization. An in-memory permit binds those scenes, account/server/source checks, source revision hashes and a sixty-second lifetime to one operation. It is never serialized or cached as a future save permit. New shared drawing descendants discovered after planning cannot inherit another source's permit. Personal copying without shared dependencies stays offline. Generic file/image originals need fresh View access; only originals actually being copied are inspected.

The stdio MCP path performs the same planning and native authorization before its guarded transaction, using the signed-in account or explicitly configured development session. Copy policy is checked before any page, saved version, library row or attachment owner is created. Template creation/use and library-template instantiation are complete transactions, including final metadata and initial scene storage; storage failure leaves no empty drawing. Duplicated descendants retain their resource kinds. A new identity inherits destination workspace rights and drops the source's explicit personal sync flag and scoped policy cache, so an authorized personal copy stays independent after source revocation. Existing live references still require their own current source access.

These are managed application copy controls, not DRM against reconstructing content a reader is already allowed to inspect. Shared library metadata transport, native GUI/file-dialog/Windows clipboard acceptance and the remaining full drawing gates stay open.

Persistent stroke validation now bounds actual pigment work, including spray particles, crayon/pencil granules and oil bristles; mask strokes share a total work budget. TS, Worker scene validation and Rust use matching conservative accounting. Transient previews use the same accounting with their smaller awareness budget. Rendering streams deterministic dabs into at most sixteen new 512px tile surfaces per batch rather than retaining all pigment particles. A locally limited gesture keeps its painted samples for release and one ordinary undoable operation and tells the user to start another stroke. This is a resource guard, not measured hardware-performance acceptance.


### Durable sampled-pixel read preconditions

Destructive drawing pixel edits carry an optional `pixelGuard` on the edit operation. It identifies a frame, current-layer or visible-layer scope and the exact expected frame/layers/source nodes, outside anchor targets, mask definitions and original-asset metadata. It includes source-layer membership, so a newly arrived stroke invalidates a queued erase even though the erase itself inserts new raster nodes. The metadata is bounded to32MiB. It does not rewrite source content or add a new scene entity.

TS append/canonical validation, the authoritative Worker and native apply/offline rebase validate this read precondition before accepting the new edit. A mismatch keeps the local edit for explicit recovery. Unrelated-layer additions can still rebase. Historical author Undo replays enabled edits without checking an obsolete source read again. Layer fences remain required for guarded source layers; a layer insertion at a nonappend position also reserves layer order.

Drawing state replies, including missing-state errors and initialization, advertise `capabilities.pixelSourceGuards:2`. A current client refuses to transmit guarded edits or initialize guarded history when a service does not advertise support; work remains local. This prevents an older service from silently treating a destructive pixel edit as an independent addition. The capability is service behavior, not durable artwork or export policy. Deployment, mixed-version/native UI and offline acceptance remain part of the drawing release audit.

Pixel source guard capability2 adds optional expected.ancestors in document layer order when sampled layers have parents outside expected.layers. All ancestor metadata is compared and leased. Flat guards keep their version1 wire shape; clients retain ancestor-aware edits locally until the service advertises2. Older nested receipts lacking their required ancestors are rejected.

Immutable library publications use capabilities.libraryPublications:1 beside pixelSourceGuards:2. Publication descriptors travel inside saved-version scenes, are bound to the actual document and version before persistence, and cannot claim owner/workspace access. Unsupported clients keep outgoing publications local; incoming unsupported/corrupt directories are refused before original downloads or native checkpoint writes. See docs/drawing/LIBRARY-SYNC.md for schema, limits, migration and acceptance evidence.

Source-dependent edits such as visible-layer merge may carry `requiresBase:true`. These edits reserve `drawing:root` and require an exact revision match before any canonical rebasing. TS, the Worker authority and native apply/offline replay reject stale bases without dropping the pending edit. State replies advertise `capabilities.strictDrawingBase:1`; unsupported outgoing and incoming histories are refused before attachment transfer or checkpoint installation. The flag is valid only on edit operations and has no false-valued form. Author Undo replays accepted artwork without rechecking this historical precondition.
