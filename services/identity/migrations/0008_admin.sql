-- The control dashboard at admin.enterworlds.space (docs/admin/PLAN.md, phase 1).

-- Team roles. Owners named in the ADMIN_OWNERS setting are owners without a row
-- here and cannot be removed from the dashboard.
CREATE TABLE admin_roles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'moderator', 'support')),
  granted_by TEXT,
  granted_at INTEGER NOT NULL
);

-- A suspension lasts until suspended_until (epoch ms). A ban is a suspension
-- with no end (banned = 1). Lifting one clears all four columns.
ALTER TABLE users ADD COLUMN suspended_until INTEGER;
ALTER TABLE users ADD COLUMN suspended_at INTEGER;
ALTER TABLE users ADD COLUMN suspend_reason TEXT;
ALTER TABLE users ADD COLUMN banned INTEGER NOT NULL DEFAULT 0;

-- Private notes the team writes on an account. The person never sees them.
CREATE TABLE admin_notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id TEXT,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX admin_notes_user ON admin_notes(user_id, created_at);

-- A second check with a passkey (or an email code) before risky actions.
-- One row per dashboard device; it lasts a few minutes.
CREATE TABLE admin_stepups (
  device_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  method TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- The security log is read by account and by target from the dashboard.
CREATE INDEX audit_target ON audit_log(target_type, target_id, at);
CREATE INDEX audit_at ON audit_log(at);
CREATE INDEX devices_seen ON devices(last_seen_at);
CREATE INDEX users_created ON users(created_at);
