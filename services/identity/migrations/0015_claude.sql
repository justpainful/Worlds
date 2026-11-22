-- Dashboard tools for Claude (docs/admin/PLAN.md, phase 8).

-- A key an owner makes for Claude's MCP server. It reads the dashboard as that
-- owner, and can only propose changes; only a hash is kept.
CREATE TABLE admin_keys (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);

-- A change Claude proposed. Someone on the team approves it in the dashboard,
-- which then makes the change with their own rights and second check.
CREATE TABLE admin_proposals (
  id TEXT PRIMARY KEY,
  key_id TEXT,
  action TEXT NOT NULL,
  payload TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at INTEGER NOT NULL,
  decided_by TEXT,
  decided_at INTEGER,
  result TEXT
);
CREATE INDEX admin_proposals_status ON admin_proposals(status, created_at);
