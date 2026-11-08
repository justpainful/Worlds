# Experimental MCP authorization gate

This isolated library exercises a narrow host authorization model using the
original Worlds permission guard inside SQLite transactions. Requests are bound
to an account, copy, server, run and page; a write requires a one-use approval
for the exact arguments. Cancellation invalidates pending approvals. The tests
use synthetic databases and verify local permission changes, account changes,
approval replay, and rollback when an original guarded operation touches an
unauthorized page.

This is not yet an authorization boundary and must not be connected to the
product. `RunBinding` identifiers are supplied by a trusted host; they do not
prove an executable, child process or SQLite file identity. `CurrentAuthority`
must be backed by an authenticated current service response for shared pages
and independently verified copy ownership for personal pages. A local check
cannot make a remote permission decision atomic with a later SQLite write.
The caller must run only audited original tool implementations, because a
malicious closure can write outside the original change-log contract. UI consent,
per-tool approval presentation, in-flight cancellation, process termination, service-to-host transport,
cross-process identity, and real Apple integration remain unimplemented.

No tool is enabled for the released app by this library. The supported test
surface is intentionally limited to `blocks_read` and `pages_rename`.
