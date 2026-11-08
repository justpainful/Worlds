# Experimental rejected archive review

This isolated view lists rejected snapshots from the original SQLite schema and
extracts visible drawing comments authored by the current account. Copying a
selected comment requires an explicit action and current export permission.
Nothing is replayed, merged, removed or sent to the service.

The host must provide an `ArchiveAuthority` that validates current remote
permission and account identity. No such production adapter is included, and
cached store rights alone do not qualify. Reads check the supplied permission
before and after SQLite access and verify it matches the store binding. Export
permission defaults to false and must be derived from the real drawing policy.
The native extraction currently refuses snapshots larger than 4 MiB; the source
supports up to 64 MiB. Ordering ties and invalid-data behavior require further
compatibility work. No
atomicity is claimed between the final remote permission check and display or
clipboard write. The view refreshes when the scene becomes active, but no live
revocation subscription is implemented. It is not linked to the product.

Tests use a disposable database and synthetic authority. Apple compilation,
actual clipboard behavior, screen layouts, service authorization and visual
review must pass before any product integration.
