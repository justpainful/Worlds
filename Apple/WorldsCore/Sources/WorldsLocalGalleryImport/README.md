# Experimental local gallery file import

This bridge accepts an independent `LocalProjectCopy`; it does not copy existing
attachments from the source database and never synchronizes back to it. The
host must retain the exact inputs and operation UUID for retry and reload after
success. A matching completed operation returns its original result; reusing
the UUID with different inputs is refused. The source URL's security scope is
held for the native call. A running native import is not cancellable.
The private copy records the source path and file identity with the operation
to detect changed retry inputs; those details persist in its SQLite database.

The destination directory must remain a private, stable app-owned container.
Path validation and SQLite opening are not atomic against a same-user process
that can replace files or directories. Empty unregistered staging directories
can remain after interruption. This module is not enabled in the application
and requires Apple integration tests and independent review.
