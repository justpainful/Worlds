-- Limits for one account (docs/admin/PLAN.md, section 7): the size of the web
-- copy of the workspace and of each file, raised or lowered by the team.
-- No row means the defaults in src/lib/limits.ts.
CREATE TABLE account_limits (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  web_copy_mb INTEGER,
  file_mb INTEGER,
  note TEXT,
  updated_by TEXT,
  updated_at INTEGER NOT NULL
);
