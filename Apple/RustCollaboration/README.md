# Worlds Rust collaboration core

This crate wraps `yrs` 0.28.1 with a C ABI for Yjs v1 update decoding, application, state vectors and differential state updates. `yrs` is pinned in Cargo.toml and Cargo.lock. The source project uses Yjs 13.6.33 for the fixtures. Each document has a mutex, and the C ABI transfers output buffers to the caller, who must free them exactly once. `include/worlds_collaboration.h` defines the interface. Invalid C pointers and use-after-free cannot be made safe by this interface. Never free a document while a call is in progress. A panic is caught at the ABI boundary; a poisoned document must be discarded. Inputs are limited to 64 MiB, which is not a full defense against hostile or memory-intensive updates.

Tests under `tests/interop.rs` load actual Yjs fixtures including rich-text XML, compare state vectors, merge concurrent edits in both orders, check idempotency and apply an out-of-order update. `tests/generate-fixtures.cjs` creates these fixtures using the existing Worlds `yjs` installation. `examples/export.rs` and `tests/verify-rust.cjs` check the reverse direction by applying a yrs-generated update in Yjs. Execute these commands with Yjs resolvable by Node:

```
cargo test --locked
cargo run --locked --example export -- path/to/rust-update.bin
node tests/verify-rust.cjs path/to/rust-update.bin
```

The last recorded run was on Windows x86_64, Rust 1.97.1, Node 24.18.0, with the source checkout's Yjs 13.6.33. Four Rust integration tests passed and Yjs accepted the generated update. Apple targets, Swift linkage and Apple ABI have not been built or tested.

The ABI currently creates empty documents, applies binary updates and emits state vectors or diffs. It does not yet expose editing or structured inspection of the Tiptap/Yjs XML tree. A Swift editor cannot create or modify document content through this interface alone. The test fixture checks one formatted XML sample, not complete schema or formatting fidelity. Native editor mapping, comments, undo, origin metadata, durable storage, outbox and rejected-update recovery remain to be implemented and tested.

This crate does not implement WebSocket transport, awareness or presence, permission enforcement, attachments, authentication, event delivery, collaboration UX, or the existing block mirror/fold logic. Do not treat it as completed collaboration. In particular, independent concurrency and ordering tests against the live Worlds service and the complete editor schema are still needed. Only one Apple-platform module should own each handle, and any Swift wrapper must copy returned data before freeing it.

## SQLite sync store

`src/store.rs` operates against existing schema versions 10 and 11 without creating or migrating a database. It persists local update and outbox rows in one transaction, reads snapshots and ordered updates, acknowledges only the selected channel through a watermark, and archives rejected causal state while marking pending rows rejected and clearing the active replica. The caller pins a page, account and workspace; each operation checks the active local account, workspace, drawing binding and locally cached page permissions. These checks are not proof of current server authorization. The backend must still enforce access, and no app integration is enabled.

Four SQLite integration tests passed on Windows using a minimal schema fixture: reopening after append, channel-scoped acknowledgement, rejected snapshot ownership, injected rollback failure and changed account or cached permissions. These tests do not use a full production database. The rejection operation currently requires cached view access, so a rights revocation can leave changes pending instead of archiving them; it must not be presented as full original recovery parity. The store currently has no C ABI or Swift adapter and is not wired to `CollaborationSession`. This protects the app from unvalidated database writes while the integration remains unfinished. No isolated WebSocket service was tested in this pass.
