# Isolated MCP compatibility work

This crate reuses the original Worlds JSON-RPC dispatch, account permission
gate, and Markdown conversion. `scoped_read` exposes only `blocks_read` for a
single caller-selected personal page, with an additional personal-page check
inside the same read transaction. It rejects shared, deleted, ambiguous or
different pages and all writes. The caller must supply an already verified
private database connection and establish its identity and lifetime.

`worlds_mcp_fixture` is a DEBUG-only stdio server with an embedded synthetic
database. It does not accept a database path or real user data. The associated
ClaudeRunner fixture test uses a synthetic provider and this server to exercise
MCP configuration, protocol transport and scope refusal. It does not start
Claude or connect a provider.

This subset is not a replacement for Worlds MCP and is not enabled in the
product. Full tool parity, account and workspace authorization on Apple,
approvals, safe process lifecycle, verified executable identity, access to an
app-owned database and real Claude integration remain open.
