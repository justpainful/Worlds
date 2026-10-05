-- Worlds identity: accounts, passkeys, devices, sessions, workspaces, permissions, audit.
-- Times are epoch milliseconds. Secrets (codes, refresh tokens, invite tokens) are stored as SHA-256 hashes only.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,              -- lowercased
  display_name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  email_verified_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,                     -- credential id (base64url)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,                -- COSE public key (base64url)
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '[]',
  device_type TEXT,
  backed_up INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL DEFAULT 'Passkey',
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX passkeys_user ON passkeys(user_id);

-- A device is one signed-in installation of Worlds. Revoking it ends its sessions.
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT '',
  public_key TEXT,                         -- Ed25519 raw key (base64url); refresh requests are signed with it
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX devices_user ON devices(user_id);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  refresh_hash TEXT NOT NULL UNIQUE,
  previous_hash TEXT,                      -- the rotated-out token; presenting it again revokes the session
  created_at INTEGER NOT NULL,
  refreshed_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  revoke_reason TEXT
);
CREATE INDEX sessions_device ON sessions(device_id);
CREATE INDEX sessions_previous ON sessions(previous_hash);

CREATE TABLE email_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX email_codes_email ON email_codes(email, created_at);

CREATE TABLE webauthn_challenges (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                      -- register | authenticate
  challenge TEXT NOT NULL,
  user_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);

-- Browser to app handoff (RFC 8252 style). 'signin': a one-time code the app
-- exchanges with its PKCE verifier. 'add-passkey': a ticket that lets the
-- browser page add a passkey to the signed-in account.
CREATE TABLE handoffs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  secret_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_challenge TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  default_level TEXT NOT NULL DEFAULT 'edit', -- what Members get on pages without overrides
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,                      -- owner | admin | member | guest
  joined_at INTEGER NOT NULL,
  invited_by TEXT,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX members_user ON members(user_id);

CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (workspace_id, name)
);

CREATE TABLE group_members (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX group_members_user ON group_members(user_id);

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  max_uses INTEGER,                        -- NULL: unlimited until expiry
  uses INTEGER NOT NULL DEFAULT 0,
  revoked_at INTEGER
);
CREATE INDEX invites_workspace ON invites(workspace_id);

-- Mirror of the page tree, for permission inheritance only (no content).
CREATE TABLE pages (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  parent_id TEXT,
  inherit INTEGER NOT NULL DEFAULT 1,      -- 0: ignore permissions set above this page
  created_by TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, id)
);
CREATE INDEX pages_parent ON pages(workspace_id, parent_id);

CREATE TABLE page_permissions (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,            -- user | group | workspace
  principal_id TEXT NOT NULL,              -- user id, group id, or '*' for everyone in the workspace
  level TEXT NOT NULL,                     -- full | edit | comment | view | none
  granted_by TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, page_id, principal_type, principal_id)
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  workspace_id TEXT,
  actor_user_id TEXT,
  actor_kind TEXT NOT NULL,                -- user | ai-on-behalf-of-user | automation | system
  device_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  meta TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_workspace ON audit_log(workspace_id, at);
CREATE INDEX audit_actor ON audit_log(actor_user_id, at);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

-- Access change events for the sync service, delivered at least once.
CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  delivered_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX outbox_pending ON outbox(delivered_at, created_at);
