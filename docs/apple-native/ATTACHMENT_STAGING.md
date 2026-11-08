# Independent-copy attachment staging

The Windows store records attachments in SQLite and writes their files below
the sibling `attachments` directory, normally as `month/id.extension`. The
current Apple database backup copies attachment rows but not the files.

`Apple/RustStore/src/attachment_staging.rs` is an internal, unexposed staging
component. It reads the existing v11 database in a read transaction, refuses
unowned, shared, deleted or ambiguous attachment records, validates relative
paths and sizes, and copies into a fresh private directory. On Unix it opens
the source through descriptor-relative no-follow traversal, rejects hard links,
and verifies file metadata before and after copying. It creates destination
files exclusively and syncs them. An `.incomplete` marker remains until all
files have copied; normal errors remove the staging directory. File, total
byte and record limits are enforced. Staging fails closed on other platforms.

This is not an integrated attachment import. It does not prove that the
chosen attachment directory belongs to the original database or that the
database backup and files represent a single point in time. It has no complete
audit of references embedded in all Worlds block and drawing formats, does not
copy shared or unowned/profile files, and cannot detect every same-user
concurrent modification. A crash can leave an incomplete directory. There is
no atomic publication tying this directory to an existing copied database,
power-loss durability guarantee for directory entries, user recovery flow,
security-scoped Apple caller or FFI. Do not show staged files in the product or
claim that the local-copy attachment set is complete.

Windows tests exercise record authorization and path validation only. Unix
fixture tests for successful copy, rollback, symlinks and hard links are written
but require an Apple or other Unix runner; no user files are used.

`attachment_bundle.rs` is a second, still unexposed experiment that stages a
database and personal attachments from one source folder. It compares source
directory, database, WAL, attachment-directory and file identities and file
metadata around the copy, refuses staging inside the source, and publishes a
completed directory with a no-replace atomic rename on Apple and Linux. On a
normal error it removes the private staging directory. These checks detect the
fixture changes they cover; they do not bind SQLite's actual open descriptor
to the checked descriptor or rule out an adversarial swap and restoration
between checks, and they do not establish an atomic snapshot across SQLite and
the filesystem. A same-user process with container access is outside the
trust boundary. Directory entry durability after power loss is not established.
The experiment remains unavailable to FFI and the application.

The common Unix source and test code passed `cargo check --tests` for an
Android target; this does not compile the Apple-specific `renamex_np` branch
or run the tests. Apple compilation and execution remain required.
