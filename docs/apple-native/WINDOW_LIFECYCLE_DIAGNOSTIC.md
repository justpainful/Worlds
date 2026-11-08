# macOS window lifecycle diagnostic

The opt-in UI test diagnostic requires DEBUG, macOS and the explicit build flag
WORLDS_UI_WINDOW_DIAGNOSTICS. The application additionally requires a fixture
launch argument and a UUID token supplied by XCTest. Ordinary Debug and release
builds do not install this diagnostic application delegate.

XCTest creates a private temporary directory exclusively. The application writes
only lifecycle event names, window counts, visibility, key and minimized state,
and application active, hidden and modal flags. It does not record window titles,
paths, page IDs or document contents. It stops its timer and observers and closes
the file after 15 seconds. XCTest attaches the trace on failure and deletes the
file through the pinned directory using no-follow and checks its type, owner,
link count, mode and size before attaching it. Cleanup checks the file identity
before unlinking it and removes the original directory only if it is empty and
still has the expected owner, device and inode.

This is a diagnostic, not a window recovery mechanism. If the test runner and
application resolve different temporary directories, the attachment reports that
the trace is unavailable. The identity check followed by removal is not atomic
against another process with the same account and access to the parent directory.
It has not been built or exercised on Apple yet.
