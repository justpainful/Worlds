# Experimental outbox ownership

This Rust-only experiment is not connected to the Apple session or product.
The optional `native_sync_outbox_owner_v1` table is created only by an explicit
call. Its creation does not modify or claim existing Worlds outbox rows. New
rows written through `append_owned` bind the account, workspace, page, channel,
payload and creation time in the same SQLite transaction as the original log
and outbox insertion. A mismatch, an unbound row or a different owner blocks
watermark and acknowledgement. The latter removes only verified rows through
the selected watermark, with its binding, in one transaction.

Legacy writers are unchanged and produce unbound rows. Legacy queue consumers
do not honor this side table, and a version-10/11 database is not automatically
migrated. This table is local bookkeeping, not a server authorization, a secure
boundary against another process with database write access, or evidence of
ownership of Yjs snapshots and update history. In particular, the full document
may include updates from another account even if its pending queue is bound.
Do not attach this API to any network sender until document provenance, legacy
writer interoperability, rejection recovery, account changes, and server
authorization have been designed and verified. Never assign legacy rows to the
current account merely because it is active. No existing rows are deleted or
claimed during setup.
