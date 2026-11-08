# Android architecture status

The independent Android directory contains three early libraries. `core/sync`
implements the binary envelope described in `docs/SYNC_PROTOCOL.md`.
`core/stylus` provides a MotionEvent adapter and a platform-independent event
router. `core/content` stores personal resources and ordered ProseMirror JSON
blocks. None of these libraries is connected to an application yet.

The content store supports creation, rename, moving, metadata and instructions,
ordered block saves, substring search and subtree trash and restore. Writes use
a revision check to reject stale saves. Unknown JSON attributes are preserved,
and a block ID already owned by another page is rejected instead of stolen.
`InlineEditing` supports UTF-16 range replacement and mark changes in paragraph
and heading blocks containing only text and hard breaks. It preserves other
marks and block data, and rejects unsupported inline nodes before any save.
These operations are not wired to an editor, and they do not support mentions,
tables, lists, selection across blocks, collaboration or composition input.
Local versions retain title, metadata, instructions and blocks, with an automatic
checkpoint at the start of an editing interval and a checkpoint before restore.
Resource operations also append a local activity record in the same transaction.
This is an internal Android database, not the desktop SQLite format or an import
format. Version snapshots do not yet cover icons, covers or attachments; history
does not include the desktop's actor and operation details. Backups, complete
metadata indexing, desktop FTS ranking and collaboration are also absent. Its
separate revision-based writes must not be used as a substitute for the shared
Yjs document.

Sync payloads are opaque bytes. `AndroidSyncStore` adds a scoped SQLite replica
log and outbox, transactional append and rejection archive, bounded
acknowledgement, revocation cleanup and generation-checked snapshot compaction.
Six Android instrumentation tests passed on an API 35 emulator, including failure rollback
and account isolation. It is not connected to a sync session. Yjs,
authentication, WebSocket transport, access
revocation and drawing's separate journal and lease protocol are absent. The
desktop contracts remain authoritative. No shared server or desktop files were
changed.

The store cannot authorize reads or cancel writers. A future session manager
must stop network and local writers, serialize access changes, enforce current
server rights before exposing archives, and then invoke the revocation purge.
The generation fence protects compaction after a reset, but it does not make a
late caller's append safe. Do not use this store as a complete revocation flow.

Run `Android/run-core-checks.ps1` with JDK 17 or later, Kotlin CLI, Node 24,
installed desktop dependencies containing lib0 and an Android SDK jar. The
fixture generator loads the desktop TypeScript protocol functions directly for
messages with desktop encoders. Pass `-DesktopRoot` and `-AndroidJar` if those
are not in their default locations.
These checks do not replace Gradle, instrumentation, integration or hardware
tests.
