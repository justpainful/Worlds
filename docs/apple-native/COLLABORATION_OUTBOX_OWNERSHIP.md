# Collaboration outbox ownership

Status: blocked for product activation. The isolated collaboration harness is not a user-data workflow.

The original `src-tauri/src/sync/mod.rs` schema stores pending updates by page and channel, without an account owner. `src-tauri/src/account/state.rs` clears account and workspace records on sign-out, but does not remove the sync outbox. The Apple `SyncStore` checks that the active account matches the user passed when the store is opened; it cannot establish which account originally created an existing outbox entry. The optional drawing sync owner is not proof of ownership of ordinary Yjs outbox entries.

A temporary isolated Rust probe created a pending update as account `u`, changed the active account to a different account with the same cached workspace membership, and opened a new `SyncStore` for that account. `max_pending` returned the earlier update. The probe used a synthetic SQLite fixture, ran on Windows, and was removed after the check. It demonstrates the missing binding; it does not exercise a live service or establish what happened to any user data.

Server authorization checks the currently authenticated account. It cannot determine whether an ownerless local update was originally authored by another account. Therefore the existing experimental session must not be connected to user data: a new session could attribute an old pending update to a different account.

Possible conservative implementation paths require further design and tests:

1. Create an account-bound native replica in an application-owned database and write the account identity and each new update atomically. Do not silently import ownerless pending updates into it.
2. Introduce a versioned ownership record tied to a proven account and database lineage. Establish the binding only before the first update is written, with transactionally enforced account checks. This requires a compatibility and migration review before changing a Worlds database.
3. For existing ownerless updates, stop automatic transmission and retain the original database and outbox unchanged. Offer a separately authorized inspection or export workflow if its ownership can be established. Never infer ownership from the currently signed-in account alone.

For either implementation, test account switches, sign-out, interrupted writes, owner mismatch, retained pending bytes, database replacement, concurrent sessions, service rejection, and recovery. A test-only bypass must not be present in product builds. Failing closed on every existing ownerless pending row is safe but also blocks legitimate reconnects; it does not establish feature parity or restore those edits.
