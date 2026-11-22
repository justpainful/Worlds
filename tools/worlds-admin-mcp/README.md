# Worlds dashboard tools for Claude

An MCP server (stdio, no dependencies) that lets Claude read the control
dashboard and propose changes. It never changes anything by itself: every
`propose_*` tool creates a proposal that a person approves on
admin.enterworlds.space (Claude page), with their own account and second check.

1. On admin.enterworlds.space, open Claude and choose New key (owners only).
2. Add the server to Claude Code with that key:

       claude mcp add worlds-admin -e WORLDS_ADMIN_KEY=wak_... -- node tools/worlds-admin-mcp/server.mjs

Reads: worlds_overview, worlds_insights, worlds_find_accounts, worlds_account,
worlds_support_requests, worlds_support_request, worlds_security_log,
worlds_public_content, worlds_suspicious_accounts, worlds_suggestions,
worlds_proposals.

Proposals: propose_reply, propose_ticket_status, propose_note, propose_suspend,
propose_lift_suspension, propose_hide_content, propose_show_content,
propose_suggestion, propose_message.

A key can be revoked at any time from the same page. `WORLDS_IDENTITY_URL`
points the server at another account service (a local one for testing).
