# Worlds collaboration: accounts, permissions, sync

Decided 2026-10-04. Worlds stays local-first: every device keeps a full replica and works offline. The server owns identity, permissions and sync, nothing else.

## Decisions

| Topic | Decision |
| --- | --- |
| Backend | Cloudflare: Workers (API), D1 (accounts, workspaces, ACL, audit), Durable Objects (one per page document, live sync), R2 (attachments) |
| Privacy model | Server-enforced permissions; TLS in transit, encryption at rest. No end-to-end encryption for shared workspaces |
| Sign-in | Passkeys (Windows Hello) first; email one-time code for a new device and recovery. Built in-house on Workers, no paid auth vendor |
| Discord | The owner's own bot stays tied to the owner's account. Other people connect their own bot to their own workspace; bots are never shared |
| Personal space | 100% local, never synced, unless the user moves a page into a shared workspace |

## Cost (starting out)

All on free tiers: Workers free, D1 free, Durable Objects with SQLite storage on the free plan, R2 10 GB free. Passkeys cost nothing. Email codes: a free transactional tier (for example Resend, 3,000 a month) until volume needs more. Moving to Workers Paid ($5 a month) only when limits are reached.

## Model

- **Account**: id, display name, avatar, banner, verified flag (reuses the profile), passkeys, recovery email.
- **Workspace**: Personal (local only) or Team. Members with roles: Owner, Admin, Member, Guest.
- **Page permissions**: Full access, Can edit, Can comment, Can view. Inherited down the page tree, overridable per page. Groups (for example "Design"). Invite links with expiry and role. Audit log of who changed what and when.
- **Enforcement**: the Durable Object for a page checks the connection's rights on join and on every update: viewers receive but cannot send, commenters may only send comment ops, editors send document updates. The API never returns a page a user cannot view.
- **Revocation**: the server stops syncing at once; the client deletes that workspace's local replica on its next connection.

## Local replica

- Pages become Yjs documents (Tiptap has first-party Yjs support). SQLite stores the update log plus periodic snapshots per page.
- Every row carries workspace_id, created_by, updated_by; ids become UUIDv7 instead of sequential integers.
- Edits apply locally first, queue in an outbox while offline, and merge without conflicts when the connection returns.
- Markdown and JSON views stay as derived data for search, MCP and Discord rendering.

## Collaboration features

Live cursors and selections, who is on the page, comments with mentions, notifications, history per author with restore, suggestion mode, page and workspace activity.

## Claude, MCP, automations

Claude acts with the signed-in user's rights: it cannot read or change a page the user cannot, and its edits are attributed to it inside the shared document. Automations and Discord sends belong to a workspace and respect its permissions.

## Phases

1. **Local foundation** (no server): UUIDs, workspace and author fields, pages converted to Yjs with a backed-up migration. The app behaves exactly as today.
2. **Accounts and server**: Worker API, passkeys and email codes, workspaces, members, invites.
3. **Live sync**: Durable Object per page, presence, offline outbox.
4. **Permissions UI**: share sheet, page-level rights, groups, guests, links, audit log.
5. **Collaboration**: comments, mentions, notifications, history per author, suggestions.
6. **Claude, MCP, automations and Discord** under permissions; per-workspace bot connections.
