# Project editing database identity

Project writing remains disconnected from the application. The current
`NativePersonalStore` acquires security-scoped access for each request, passes
the URL path to Rust, then releases access. `open_existing` opens a new SQLite
connection for that path for each operation. Full metadata and revision CAS
protect against certain concurrent changes within the selected database, but
do not bind an editing session to one database file.

The isolated Rust test
`resource_ops::tests::path_bridge_does_not_bind_draft_to_database_identity`
demonstrates the gap: after reading a project, it substitutes another database
with the same project baseline at the path. Saving succeeds against the second
database. This was reproduced on Windows, not on an Apple device. The test uses
copies of a synthetic fixture and does not access user data.

## Requirements before enabling project writes

* Keep security-scoped access alive from session establishment until the last
  SQLite operation finishes, including cancellation and error paths. Handle
  whether access was actually granted without treating a false return alone as
  conclusive denial for URLs that require no scope.
* Bind the session to the intended database and enforce identity at the point
  SQLite opens it. A separate `stat` before a path-based open is insufficient:
  the path or an ancestor can change between those steps.
* Preserve SQLite locking and the relationship between the main database and
  its journal, WAL and shared-memory files. A held file descriptor or an
  open SQLite connection by itself is not evidence that path substitution of
  sidecars is safely handled. Do not use a file-descriptor path as a shortcut
  without establishing those semantics on all supported Apple platforms.
* Keep a single serialized session connection and run authorization checks,
  complete metadata CAS and the write in the same immediate transaction.
  Account authorization and shared workspace permissions need independent
  validation; a security scope grants file access, not application privileges.
* Establish the supported trust boundary for the parent directory and other
  processes. A directory descriptor with relative opens or a reviewed SQLite
  VFS may be appropriate, but neither has been implemented or verified here.
* Exercise database and sidecar replacement, symlinks, parent renames, WAL
  recovery, concurrent writers, scope expiry, cancellation and restarts on
  macOS and iOS simulators and real devices as applicable. Validate that data
  is never silently written to a substituted database, and retain recoverable
  drafts on failure.

No proposed mechanism in this document is an implemented security guarantee.

## SQLite VFS and descriptor evaluation

SQLite's [corruption documentation](https://www.sqlite.org/howtocorrupt.html)
warns that renaming an open database can cause distinct databases to share a
journal or WAL. Its [WAL documentation](https://www.sqlite.org/wal.html)
identifies the WAL as part of persistent database state. Opening only the main
file via a descriptor does not establish safe naming, locking and ownership of
the sidecars. A custom VFS would need to enforce the same trust boundary for
all SQLite file and shared-memory operations, preserve interprocess locking,
and interoperate with every existing Worlds connection. This is not implemented
or verified on Apple.

The Unix-only diagnostic
`identity_probe_rejects_swapped_main_wal_and_shm_before_write` holds an isolated
WAL connection and detects independently replaced main, WAL and SHM files
before issuing a write, then restores the test files. It is not yet run on
Apple. Path checks can race with replacement after the check and do not prove
that a VFS operates on the checked objects; the diagnostic is not a production
guard or a reason to enable writes.

## Isolated import prototype

`Apple/RustStore/src/isolated_import.rs` contains an experimental
SQLite Backup implementation. It opens the selected source read-only, copies
committed database state including WAL contents into a new random directory,
checks SQLite integrity, version 11 and a subset of project-related columns,
and never overwrites an existing destination. Rust tests on Windows cover a
committed WAL edit, a project edit confined to the copy, cleanup after an
injected error, and rejection of an unsupported schema.

The caller must provide a trusted, app-owned container and keep the source's
security scope active during the entire operation; neither is enforced by the
prototype. A read-only SQLite connection can still need access to WAL/SHM
sidecars, and opening an externally mutable source has not been hardened
against concurrent path replacement. Tests do not establish that every source
sidecar stays byte-for-byte unchanged. Cleanup after normal errors is best
effort; termination or power loss can leave an unpublished partial directory.
The copy includes all database rows, including shared data, so personal ACL
checks remain necessary. Attachment files are not imported. The snapshot is
independent and has no synchronization, merge, writeback or conflict handling
with the original. Full schema validation, Apple container isolation, backup
under interruption and concurrent writes, security scope lifetime, file
protection, and Apple device behavior require implementation and verification
before exposing it as a product workflow. An experimental FFI request and the
`WorldsLocalImport` Swift coordinator now exist, but are not connected to the
app. The coordinator creates its parent in Application Support, holds a source
security scope through the backup call, validates the returned location and
rechecks SQLite integrity and a subset of the schema. It checks the destination
root's owner and rejects group or other permission bits. These pathname checks
are not atomic against replacement. A `.incomplete` marker identifies a
partially created copy until verification succeeds; it does not authorize
deletion of a potentially active import. Cancellation or validation
failure after a successful backup can also leave an orphan copy; no unsafe
recursive cleanup of unknown directories is attempted. Swift integration
tests, including committed WAL from a live connection, await an Apple run.
An experimental inventory can reopen a copy by UUID after restarting and
reports the number of rejected candidates, including incomplete or damaged
copies. It does not retain or reopen the original source URL. Every restored
copy is revalidated, but this is not a substitute for per-project personal
access checks. Inventory and restoration tests also await an Apple run.
