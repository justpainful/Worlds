# Isolated page history experiment

The experimental history sheet reads actual history rows from a synthetic local
copy. It checks that the page is live and personal inside the same SQLite read
transaction. It exposes summary, actor and time only, with a limit of 200 rows.
It does not implement history undo or version restoration.

A page being personal now does not establish that its existing history entries
were created while it was personal. The source history schema does not associate
an ACL or owner with each entry. For this reason the sheet is limited to the
specific synthetic copy created by the UI test fixture and requires DEBUG,
WORLDS_EXPERIMENTAL_LOCAL_COPY and WORLDS_EXPERIMENTAL_LOCAL_HISTORY. It must not
be exposed for user copies until history provenance and access rules are resolved.
The transaction is a point-in-time authorization check, not an ongoing lease.
Apple UI, accessibility and service tests remain outstanding.
