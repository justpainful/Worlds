# Experimental local gallery file import

This bridge accepts an independent `LocalProjectCopy`; it does not copy existing
attachments from the source database and never synchronizes back to it. The
host must retain the exact inputs and operation UUID for retry and reload after
success. A matching completed operation returns its original result; reusing
the UUID with different inputs is refused. The source URL's security scope is
held for the native call. Cancellation before the commit boundary rolls back
the database transaction and removes the proven staging file. If commit has
already begun, cancellation cannot override its outcome; retry with the same
operation UUID if the caller cannot determine the result. New records store the
source filename and file identity, not its full path. Older experimental records
may still contain a path. A security-scoped source selected through a real Apple
file picker has not yet been verified.

The destination directory must remain a private, stable app-owned container.
Path validation and SQLite opening are not atomic against a same-user process
that can replace files or directories. Empty unregistered staging directories
can remain after interruption. This module is not enabled in the application
and requires Apple integration tests and independent review.
