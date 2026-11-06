# Live references and independent snapshots

F02.03, F02.04, F02.05, F02.06 and F02.09 use source IDs for live cards and explicit copies for frozen cards. Live titles, excerpts, task counts and thumbnail attachment IDs stay in a private renderer cache. They never enter the scene or operation journal. Safe field changes render inside the existing box. Source updates never resize artwork automatically.

## Layout review

The links inspector opens a before/after layout sheet with two actual renderer canvases. It proposes a bounded card size and accepts exact width and height from 80 to 4096 pixels. Preview scenes contain render-only snapshot copies; they are never dispatched. Apply changes only dimensions, the geometry box used for reflow and the numeric accepted source timestamp. It produces one author-reversible edit. Cancel changes no files, artwork or operations.

The sheet reauthorizes its source every five seconds and on reconnect or window focus. Revalidation hides both private previews. A changed source, lost rights, offline shared source, moved/relinked/deleted/locked card or changed frame/layer refuses Apply. Apply acquires the normal node reservation and checks source content and node dependencies again. The operation uses `requiresBase` so an offline rebase cannot apply a layout to a different source binding. Permissions are checked again by native source authorization; a local copy of a title is not permission to freeze it.

## Source state

The native resolver checks View access independently of the containing drawing and independently of editable-project export policy. Shared references obtain fresh Worker authorization without holding the database mutex during networking. A missing, deleted or denied source has the same unavailable response and no title, excerpt, image ID or source ID. Native connection failures and an offline hint for shared sources produce a separate offline state. Personal local references remain readable offline.

The renderer clears private data before revalidation and discards superseded or disposed responses. Offline/unavailable states retain only the time of the last successful check and the last observed modification time. Reconnect, offline and window-focus events invalidate current displays. The editor otherwise refreshes live sources every 15 seconds. This is bounded revalidation, not an instantaneous remote revocation subscription. The picker also clears and rechecks results; its native authorization runs with concurrency two and excludes shared results when offline.

The inspector separates current source modification, last successful check and snapshot capture time. A frozen card retains its explicit owned content while displaying the original source's missing or offline status independently. Its capture date remains visible.

## Snapshot and repair

Freeze reads the current authorized source, materializes an independent destination-owned attachment identity for a thumbnail, checks the source again, and applies one fenced journal edit. Immutable bytes can be shared on disk between owned attachment identities. Source loss does not remove the destination identity or require access to the original page to render/export the frozen copy.

Returning to live refuses an unavailable source and preserves the frozen copy. Relink requires a currently accessible replacement, retains the card's stable node ID and geometry, and clears copied snapshot content from the live node. Freeze, relink and return-to-live use the existing node reservation and strict base guard. Author Undo restores the previous state, including an owned snapshot after source loss. An interrupted freeze can leave an unreferenced destination-owned attachment row if copying finishes before the final stale check; it does not alter the drawing. This existing attachment materialization path has no automatic orphan collector here.

## Evidence

- `npx vitest run src/drawing/references.test.ts src/drawing/referenceLayout.test.ts`: 12 passing checks. These cover private data removal, offline timestamps, late privileged responses, current-read deduplication, ephemeral comparison scenes, layout Undo, changed/locked/missing dependencies, invalid dimensions and snapshot field separation.
- `cargo test --lib drawing_references::tests -- --nocapture`: three passing entries, including one isolated child helper. Native checks cover source rights, linked task return regions, exact embedded regions, real PNG ownership, source deletion/purge, removal of the old attachment identity, independent destination bytes, relink and author Undo.
- `qa/native-reference-snapshot.json`: the native owned-file receipt. The isolated fixture explicitly removes the detached old attachment record after source purge; it does not delete the immutable file used by the independently owned destination.
- `qa/native-reference-authority.json`: five checks through two actual Rust processes and the local Worker. Source View remains independent of project-export Full policy, offline results expose no content, revocation defeats cached View, restored View recovers the preview and another account's token is refused.
- `scripts/drawing-references-smoke.html?mock`: real React controls and renderer exercise layout cancel/apply/Undo/stale, freeze/delete, unavailable-source status, failed return-to-live, relink, offline hiding and reconnect. The root reviewer recorded 10 passing checks in `qa/browser-reference-workflow.json` with an empty browser console.
- Typecheck, native compilation, antislop scan and long-dash scan passed. The two new/changed UI components have no automated antislop findings.

The native/Worker fixture supplies ordinary page identities and cached metadata as page-tree synchronization does. It verifies the source authorization boundary, not general page-tree delivery. Native installed file dialogs, physical second-device behavior and every file/resource-kind visual combination are outside this evidence. Existing region-to-task and live/pinned embed APIs were preserved; this change does not claim new full native visual acceptance for F02.01 or F02.08.
