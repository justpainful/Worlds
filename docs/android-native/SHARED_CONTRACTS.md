# Cross-platform contracts under audit

The desktop source and its services own the existing contracts. This file
records Android dependencies; it does not change those contracts.

## Resources

`src/resources/kinds.ts` defines page, document, presentation, drawing,
project, gallery, file and stream resources. They are page-store rows with a
kind. `src/resources/create.tsx` provides initial metadata for documents,
presentations, projects and galleries. File resources reference imported
attachments. Stream resources retain a URL and format. Android has not yet
implemented these models or import paths.

## Identity and access

`docs/contracts/identity.md` and `services/identity` describe the actual
HTTP routes, device-bound refresh and server-enforced access. Access tokens are
short-lived Ed25519 JWTs. The access levels are full, edit, comment, view and
none. Android must not treat a local access check as server authorization.
Passkey and device-key flows are not yet implemented on Android.

## Shared pages

`docs/SYNC_PROTOCOL.md`, `src/sync` and `services/sync` describe the
`worlds-sync.v1` WebSocket protocol. Content and comments are distinct Yjs
documents on channels 0 and 1. Updates use lib0 framing, acknowledgements and
an outbox. Personal pages remain local. Android's envelope codec and local
store do not yet supply a Yjs implementation, connection lifecycle, server
permission handling, attachment transport or revocation handling.

## Drawing collaboration

Drawing scenes use a canonical journal and fenced leases, not the text Yjs
content channel. The server code is in `services/sync/src/drawing-authority.ts`
and `drawing-leases.ts`; desktop persistence is in `src-tauri/src/drawing_sync.rs`.
Android must preserve these contracts and verify current uncommitted desktop
drawing changes before parity claims. No Android drawing sync is implemented.

## Verification boundary

The Android protocol fixtures are generated using the desktop lib0 dependency.
They verify envelope bytes only, not semantic Yjs interoperability. Local
SQLite tables are Android implementation details, not a cross-platform file
format. The current Android branch has made no changes to shared server APIs.
