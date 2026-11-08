# Experimental rejected archive review

This isolated view lists and reads rejected snapshots from the original SQLite
schema and allows a user to copy a fresh snapshot as base64-encoded Yjs bytes.
These bytes are not reconstructed document text. Nothing is replayed, merged,
removed or sent to the service. The user must explicitly choose Copy.

The host must provide an `ArchiveAuthority` that validates current remote
permission and account identity. No such production adapter is included, and
cached store rights alone do not qualify. Reads check the supplied permission
before and after SQLite access and verify it matches the store binding. No
atomicity is claimed between the final remote permission check and display or
clipboard write. The view refreshes when the scene becomes active, but no live
revocation subscription is implemented. It is not linked to the product.

Tests use a disposable database and synthetic authority. Apple compilation,
actual clipboard behavior, screen layouts, service authorization and visual
review must pass before any product integration.
