# Worlds collaboration module

## What the app uses

The Apple app opens shared pages through this module (Account, Shared pages, in `Apple/App/SharedPagesView.swift`). `CollaborationHost.makeReadOnlySession` builds a `CollaborationSession` over an `EphemeralReadOnlyStore`: it keeps the server's updates in memory for one session, refuses local updates, has no outbox and writes nothing to disk. Before any token is used, the host checks that the endpoint is the origin the person approved for this account and workspace (`SyncEndpointProposal`, kept in memory until the app closes) and that the identity service currently grants the account access to the page; the session then refuses a server that reports another account. `readOnlySnapshot()` returns every block (`NativeCRDTDocument.readProjection()`, which, unlike `plainProjection()`, accepts headings, lists and empty paragraphs) and the pack item's fields (`packFields()`), only after authentication and the initial sync. A viewer still answers the server's sync step with an empty update, which the sync Worker accepts from read-only access.

For an account the identity service lists with edit access, `CollaborationHost.makeLiveSession` uses an `EphemeralSessionStore` instead: also memory only, but with an outbox that only this session writes to, so every queued row is this account's own change. `setPackFields(request:)` prepares the change on the current server state (`NativeCRDTDocument.preparePackFields`, Rust `prepare_pack_fields`), and requires an authenticated connection that reports edit access and has finished its initial sync; the update then takes the ordinary `appendLocal` path. A local write now reconnects at once to send it, instead of counting as a failed connection and backing off. A change the server has not acknowledged is lost when the session ends; the app waits for `pendingCount() == 0` before calling it saved.

Not connected: editing text, comments, presence, offline copies and the SQLite store below. `CollaborationHost.makeSession` still refuses the SQLite store because its legacy outbox cannot prove who queued a row. CI builds the XCFramework (`collaboration-xcframework` in `.github/workflows/apple-platforms.yml`), runs the Rust tests and this package's Swift tests, and links the module into the app on macOS, iPhone and iPad.

## Module

SwiftPM exposes it when its generated XCFramework exists. CI must set `WORLDS_REQUIRE_COLLABORATION=1` so absence of the artifact fails package resolution. It depends on `WorldsSyncWire` and the generated `WorldsRustCollaboration.xcframework`. Generate that artifact on a Mac with Xcode and the five installed Rust targets using `Apple/RustCollaboration/scripts/build-apple.sh`. It outputs `Apple/WorldsCore/Artifacts/WorldsRustCollaboration.xcframework`, which the package declares as a conditional binary target. The script refuses to overwrite an existing artifact. Its headers sit in a `WorldsRustCollaboration` folder inside the framework so its module map does not collide with WorldsRustStore's when the app links both.

`NativeCRDTDocument` wraps the Rust handle and copies returned buffers. `CollaborationSession` implements two-channel initial state-vector exchange, authentication by bearer header, outbox watermark acknowledgement, local persistence before transmission, reconnect and revocation stop. The caller must run exactly one session per page, supply an access-token provider and call `refreshAuthentication` before token expiry. Local changes reconnect to force a state-vector handshake. No automatic JWT expiry timer or heartbeat is implemented. The default WebSocket transport uses URLSession and must be reviewed for redirect and endpoint policy before production.

The session accepts a new raw local update only while its current connection
has authenticated and reports write access for that channel. This conservative
rule disables new raw offline edits but retains already durable outbox entries.
The server still makes the authoritative decision; access can change while a
local SQLite write is in flight, and an earlier server frame is not an atomic
permit. An isolated fixture exercises a downgrade and pending outbox retention;
it does not prove live-service permission propagation.
Before appending a raw local update, the session also applies it to a temporary
yrs document so malformed wire data cannot be inserted into its durable log.
This is not semantic authorization and does not cover callers that write
directly to the experimental SQLite store.
On a receive failure, the session clears the connection's local permission
before awaiting socket close status. An isolated suspended-close fixture checks
that a concurrent local update is denied and does not alter the outbox.
If the local store rejects account or workspace identity, the session stops
instead of retrying as a network failure. It leaves pending entries untouched;
reopening them requires a separately authorized account and recovery flow.
An explicit token refresh checks that the same authenticated connection still
exists after the token provider returns; a stopped or replaced socket does not
receive that delayed token. This does not schedule token refresh automatically.
If an update acknowledgement does not arrive within 30 seconds, the session
closes the connection and renegotiates state vectors. The timeout never deletes
the durable outbox; only a successful acknowledgement does so. Slow services
may reconnect unnecessarily, and the isolated timeout fixture uses a synthetic
socket rather than proving behavior against the live service.
Local awareness sends are serialized; an in-flight announcement completes
before a subsequent removal, and stale queued sends are discarded when the
presence version or connection changes. A blocked socket send can delay that
removal. Peers or services may retain information already received; this is
not a guarantee of erasure or an enabled product privacy control.

A `CollaborationStore` implementation must persist local replica updates and outbox rows atomically. It must record remote updates, return the largest pending row ID, acknowledge through that ID, and atomically preserve complete rejected CRDT state with its rejected entries. `SQLiteCollaborationStore` implements this contract through the Rust C ABI against existing Worlds schema versions 10 and 11; it is not connected to the app. If a write is rejected, networking stops after archival; recovery, server-state replacement and user review are not implemented. No claim of read-only permission enforcement is made by the client. Server authority remains required.

Presence, editing Tiptap XML, local update generation, block mirroring, attachment sync, notifications, access change handling and complete session status are not implemented. JWT refresh scheduling and ping/pong behavior differ from the desktop client. Multi-process synchronization and full crash recovery are not established. Swift compilation, static library linking, Apple architectures and device operation remain unverified on this Windows host. The Swift tests contain real Yjs fixtures and a scripted in-process socket, but have not run on this host. Existing Rust fixture tests passed separately; that does not establish WebSocket interoperability.



`LiveWorkerTests/testLiveSwiftSessionsConvergeReconnectAndArchiveRefusal` exercises the Swift sessions with the real local Worker and test identity when `WORLDS_REQUIRE_LIVE_SERVICE=1`. It refuses any service URL except `ws://127.0.0.1:18790` and requires local editor/viewer tokens in the environment. The test creates independent copies of the original-schema SQLite fixture. It has not yet run on macOS and must not be reported as passing until CI supplies evidence.

The WebSocket transport now ignores text messages, including the Worker's pong,
instead of treating them as a closed connection. A local Worker integration
case sends ping and then requests awareness; it has not yet run after this
change. Endpoint base paths containing percent escapes, backslashes, repeated
separators or dot segments are refused before constructing a request carrying a
bearer token. These checks do not implement network heartbeat scheduling or
resolve the remaining collaboration authorization and recovery limitations.

On a rejected update, the session waits for any in-flight local store write
before requesting an archive. The Rust store holds an immediate SQLite
transaction and merges the caller's state, the durable replica log, and any
existing archive with the same ID before clearing the live replica. Malformed
updates, oversized results and failed resets abort the transaction, leaving the
live log and pending outbox intact. Rust fixture tests cover a stale caller
snapshot, unresolved causal updates, an archive retry and an injected rollback;
a Swift integration case uses a real SQLite fixture and scripted socket. These
tests do not establish recovery UX, restart policy or Apple device behavior.

The collaboration store handle is released with
`worlds_collaboration_store_free`. Previously it shared the exported C symbol
`worlds_store_free` with the unrelated personal-store JSON allocator, despite
different pointer types. The renamed interface removes that collision; both
XCFrameworks must be rebuilt together. A combined-link test is prepared but
requires an Apple CI run. The Worker job that crashed only linked the
collaboration artifact, so the collision alone does not establish its cause.
