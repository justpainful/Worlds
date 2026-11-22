-- Account deletion with 30 days to change one's mind, the workspace trash, and
-- names the team keeps for itself (docs/admin/PLAN.md, phase 3).

-- While deletion_due_at is set the account is hidden (profile, published pages,
-- mail) and every device was signed out; signing in again lets the person cancel.
-- At deletion_due_at the cron erases it for good.
ALTER TABLE users ADD COLUMN deletion_requested_at INTEGER;
ALTER TABLE users ADD COLUMN deletion_due_at INTEGER;
ALTER TABLE users ADD COLUMN deletion_by TEXT;
CREATE INDEX users_deletion ON users(deletion_due_at);

-- A deleted workspace waits 30 days before its content is erased.
ALTER TABLE workspaces ADD COLUMN deleted_at INTEGER;
ALTER TABLE workspaces ADD COLUMN deleted_by TEXT;
CREATE INDEX workspaces_deleted ON workspaces(deleted_at);

-- Usernames nobody may take, beyond the fixed list in src/lib/usernames.ts.
CREATE TABLE reserved_names (
  name TEXT PRIMARY KEY,
  reason TEXT,
  added_by TEXT,
  added_at INTEGER NOT NULL
);

-- Words not allowed in usernames, display names and public profiles (folded, lowercase).
CREATE TABLE banned_words (
  word TEXT PRIMARY KEY,
  added_by TEXT,
  added_at INTEGER NOT NULL
);
