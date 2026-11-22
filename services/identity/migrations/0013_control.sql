-- Controls over the whole service (docs/admin/PLAN.md, phase 6).

-- One JSON value per setting: signups, maintenance, minVersion, publishing, incident.
CREATE TABLE service_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT,
  updated_at INTEGER NOT NULL
);

-- A feature switched on for nobody, everyone, testers, a share of people, or named accounts.
CREATE TABLE feature_flags (
  key TEXT PRIMARY KEY,
  description TEXT,
  mode TEXT NOT NULL DEFAULT 'off' CHECK (mode IN ('off', 'all', 'testers', 'percent', 'users')),
  percent INTEGER NOT NULL DEFAULT 0,
  users TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);

-- A short message in the app and on the web, for some platforms and versions, for a while.
CREATE TABLE announcements (
  id TEXT PRIMARY KEY,
  text_ar TEXT NOT NULL,
  text_en TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warning', 'critical')),
  link TEXT,
  platforms TEXT NOT NULL DEFAULT '[]',
  min_version TEXT,
  max_version TEXT,
  starts_at INTEGER,
  ends_at INTEGER,
  dismissible INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at INTEGER NOT NULL
);

-- While sign-up is by invitation: codes (only a hash is kept) and the waiting list.
CREATE TABLE signup_invites (
  code_hash TEXT PRIMARY KEY,
  label TEXT,
  max_uses INTEGER NOT NULL DEFAULT 1,
  uses INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  created_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE waitlist (
  email TEXT PRIMARY KEY,
  lang TEXT NOT NULL DEFAULT 'ar',
  created_at INTEGER NOT NULL,
  invited_at INTEGER
);

-- Emails and whole mail domains that may not sign up or ask for codes.
CREATE TABLE blocked_emails (
  value TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('email', 'domain')),
  reason TEXT,
  added_by TEXT,
  added_at INTEGER NOT NULL
);
