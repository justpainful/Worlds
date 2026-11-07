# Pages, editor and assets: focused source audit

Snapshot: original Windows checkout at `185ee9a1019c8b7bc685d22dabf1b699579189cc`, including local uncommitted changes. Apple observations refer to the active native worktree. This is a focused source audit, not an exhaustive inventory or a runtime verification. File references below are repository-relative. Do not interpret source inspection as a successful test or as feature parity.

## Page loading and identity

`src/views/PageView.tsx:33-45` waits for outstanding local saves using `whenSaved(pageId)` before fetching `api.page(pageId, true)`. A monotonically increasing request ticket suppresses responses for previous navigations. Loading and retrieval errors have distinct UI paths. The native reader must preserve those ordering and error semantics where relevant, rather than infer that a displayed list is a complete editor.

`src/editor/PageEditor.tsx:64-80` constructs a ProseMirror document from block rows, resolving page mention labels. `src/editor/extensions/blockIds.ts` gives top-level blocks stable identifiers; IDs are not incidental display state. Page rows, block JSON, ordering and metadata are defined and queried by `src-tauri/src/db.rs`, `src-tauri/src/store/mod.rs` and `src-tauri/src/store/pages.rs`. A full page also carries related information such as backlinks, attachments and breadcrumbs. Native status: **Partially Implemented**, with actual breadth and end-to-end behavior requiring verification.

## Editor and local save path

`src/editor/PageEditor.tsx:185-191,235-239` configures the document-specific extension set, binds editability to collaboration state and schedules a save 450 ms after updates. The extension configuration also covers lists, tables, text marks, mentions and numerous custom block types. The slash menu and insertion handlers are in `src/editor/slashItems.ts` and `src/editor/media.ts`; their existence is not evidence that native editing supports each of them.

`src/editor/PageEditor.tsx:270-302` sends blocks plus the last synchronized timestamp through `api.saveBlocks`; it handles remapped block IDs and reports errors. `src-tauri/src/commands.rs:164-184` takes a history snapshot, checks the base timestamp and saves in a transaction. `src-tauri/src/store/blocks.rs` manages block IDs, insertion, updates, deletion, order, reference rebuilding and indexing. Native status: **Partially Implemented**. `Apple/WorldsCore/Package.swift` declares `WorldsRichText`, `WorldsNativeEditor` and a conditional `WorldsEditorPersistence`; their presence does not establish equivalent saving, attachment handling or UI access for every block. Unsupported structures must not be silently discarded.

## Conflicts and history

`src/editor/PageEditor.tsx:311-359` fetches the latest page on a save conflict and invokes the three-way merge in `src/editor/merge.ts`. The merge is based on block identity and baseline content: local changes take precedence where both sides edited the same block, while unrelated remote changes can be retained. This is not a character-level merge and the same-block policy may overwrite the other version. Replacing editor content avoids adding that replacement to undo history and attempts to retain the selection. This is source behavior, not a live concurrency test.

The original save guard in `src-tauri/src/commands.rs:164-184` compares timestamps; order-only updates and equal timestamp granularity make timestamp alone an insufficient proof of conflict safety. The native checked-save path needs its own integration and compatibility evidence; it should not be described as complete editor parity merely because its guard can be stronger. History snapshots in the original are a separate behavior from editor undo. Native status: **Partially Implemented**, full history and collaboration compatibility not established here.

## Shared pages and permissions

`src/sync/useCollab.tsx` chooses between ordinary personal block saving and the collaborative session for shared pages. Shared editing waits for readiness and derives editor editability from the session permission level; the collaborative path uses Yjs and awareness rather than merely posting block snapshots. `src/sync/session.ts:98-123,153-169,208-243` constructs the provider and awareness, sets user presence, handles file synchronization, closes and flushes the session. `src/sync/session.ts:380-399` connects attachment synchronization to Tauri commands. `src/sync/provider.ts` handles network synchronization. Preserve protocol, persistence, reconnect behavior, awareness and authorization, not only document text.

Command wrappers such as `src-tauri/src/commands.rs:86-142,164-184` call local store operations. Separately, `src-tauri/src/account/permissions.rs` implements guards for MCP tool calls. These observations do not establish a complete end-to-end security analysis; authorization must be traced through each entry point and sync service. Native status: **Blocked with Documented Reason** for claiming full shared editing parity: compatible live collaboration, service authorization and end-to-end tests have not been demonstrated by this audit. Personal database access must not become a bypass for shared-page permissions.

## Projects

`src/resources/views/ProjectView.tsx:32-67,83-100` reads project metadata and updates status, start and due dates, description and links through page metadata. `src/resources/views/ProjectView.tsx:50-53,136-165` distinguishes children from links to resources elsewhere; unlinking does not move the target. Deleted linked pages are filtered, and the picker avoids existing links and direct children. `childrenOf` in `src/state/store.ts` determines the actual child filtering and ordering. Native status: **Partially Implemented**: `WorldsProjects` and conditional `WorldsResourceRepositories` exist in the Swift package, but their presence alone does not verify all metadata, activity, conflict, permissions and interface workflows.

## Galleries and attachments

`src/resources/views/GalleryView.tsx:47-70` models gallery items as ordered `galleryItem` blocks and persists the complete ordered list using `api.saveBlocks`; a conflict reloads the source. `src/resources/views/GalleryView.tsx:85,145` imports assets and removes an item from the gallery. Removing that block is not proof that the underlying attachment file is deleted. Preserve ordering, original attributes, file references and conflict semantics.

`src-tauri/src/store/attachments.rs:20,43-45,98` limits imports to 1 GiB, derives a short extension and resolves stored attachment paths. Related IPC commands are in `src-tauri/src/commands.rs`, and local URLs in `src/lib/api.ts`. Path normalization alone must not be assumed to prove all sandbox and symlink boundaries. `src/editor/media.ts` handles editor file drops and pastes, which are distinct from gallery imports. Native status: **Partially Implemented**: `WorldsGallery`, `WorldsMedia`, `WorldsMediaViews` and `WorldsOfficePreview` are package targets; supported formats, file access lifetime, save behavior and real-device previews must be verified individually. Do not count gallery removal as attachment deletion or Office preview as editing.

## Other resource routes and scope

`src/resources/views/ResourceView.tsx` dispatches resource kinds including document, presentation, project, gallery, file, drawing and stream. `src/resources/deck/model.ts` defines presentation slide content and element properties; `src/resources/views/PresentationView.tsx` owns presentation behavior. These paths are identified here but not audited end to end. Drawing details are recorded separately in `docs/apple-native/DRAWING_PARITY.md`. AI, templates, search, exports, all permission paths, migration and all error states remain outside the verified coverage of this focused report.

## Provenance and verification limits

The original checkout has uncommitted changes, particularly in drawing and related routing/API files. Findings from those files must be attributed to the local working tree, not automatically to the published commit. The Apple worktree is changing concurrently; target declarations can change and are not proof of successful builds or integration. No runtime, simulator, device, visual, permission or compatibility test was performed for this audit. A complete matrix and an accurate completion percentage require enumerating every original behavior and validating the corresponding native workflow, including failure and conflict cases.
