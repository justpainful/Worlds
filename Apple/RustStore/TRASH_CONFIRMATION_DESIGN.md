# Personal subtree deletion confirmation

The existing `trash_page` is not sufficient for a confirmation UI. It checks
the root revision and current personal access, but another writer can add or
change a descendant without changing that revision. A confirmation based on
an earlier list could therefore delete a subtree the person did not review.
Keep deletion and recovery UI disabled until the following contract is tested.

1. A read transaction enumerates the complete subtree with cycle detection,
   verifies every page and all visible ancestors are live and personal, and
   rejects missing or shared ancestry and malformed metadata. Bound the number
   of rows and total bytes; reject rather than truncate.
2. The preview shows every affected page and descendant count. It also returns
   an opaque, random operation identifier tied to this private copy. Within a
   consistent snapshot, persist a typed, exact baseline of every page row,
   block, reference, attachment record and relevant version/history record in
   the subtree. Include row identities and ordering; do not parse and reencode
   unknown JSON or convert large integers to floating point. Never expose hidden
   page details merely to explain a rejected shared descendant.
3. On confirmation, open an IMMEDIATE transaction, verify the copy identity,
   active account and page permissions again, reconstruct the same bounded
   baseline and compare it exactly. Detect additions, removals, reparenting,
   changes with identical timestamps and metadata becoming shared. Reject a
   difference without writing anything. Use the original soft-delete operation
   only after the complete comparison and cycle checks pass in that transaction.
4. Commit the resulting deletion, history/change rows and the operation result
   atomically. Repeating the same operation after a lost response must not
   delete newly added descendants or record another history event. A new
   confirmation always requires a fresh baseline. Do not remove attachment
   files during soft delete.
5. Recovery requires a separate preview and compare-and-swap: the original
   restore operation revives nodes with the same deletion timestamp and can
   reparent a root whose parent remains deleted. A timestamp alone does not
   prove which operation deleted a node. Record exact affected IDs and prior
   deletion/parent states atomically at deletion and refuse ambiguous recovery
   or a changed tree. Preserve independently trashed descendants and physical
   attachments. Do not claim exact restoration of sibling order without a
   separate checked operation.

The app's current pathname/inode preflight is not an atomic SQLite identity
guarantee. The design must bind the preview and commit to a stable, authorized
private-copy connection or fail closed. A sidecar snapshot in the same mutable
database is not protection against an adversary with write access to that
database. Tests must use isolated synthetic files and cover mixed ownership,
same-timestamp edits, newly added and reparented descendants, cycles, malformed
metadata, interrupted writes, lost responses, independently deleted children,
attachment retention and rollback of history/index/change records. Apple and
service validation remain separate from Rust unit tests.
