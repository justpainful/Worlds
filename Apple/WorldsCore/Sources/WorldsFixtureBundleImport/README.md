# Debug-only attachment bundle fixture bridge

This exposes the existing experimental bundle importer only for paths inside
the operating system's temporary directory and only in debug builds. The host
must create an isolated 0700 destination and synthetic source. It holds source
security scope during the native call. The copied bundle is explicitly named
`worlds-unverified-bundle-*` and is not accepted by the normal copy inventory.

Source database and attachment directory cannot be proven to belong together
by their names or simultaneous path checks. Files can be replaced between
checks, and SQLite, WAL and attachments do not share one atomic snapshot.
Testing this bridge does not authorize product use or prove source provenance.
