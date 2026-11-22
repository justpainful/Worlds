-- Numbers for the dashboard (docs/admin/PLAN.md, phase 7). Nothing here holds
-- page content, and no IP addresses: a country comes from Cloudflare's own
-- lookup of the request and is kept as two letters.

ALTER TABLE devices ADD COLUMN app_version TEXT;
ALTER TABLE devices ADD COLUMN country TEXT;

-- The days an account was active (a sign-in or a session refresh), for
-- daily and monthly activity and for how many come back.
CREATE TABLE activity_days (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);
CREATE INDEX activity_days_day ON activity_days(day);

-- Every email the service tried to send: what kind, through whom, and whether
-- it went. Not the address and not the content.
CREATE TABLE email_log (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  provider TEXT,
  ok INTEGER NOT NULL,
  error TEXT
);
CREATE INDEX email_log_at ON email_log(at);

-- Counts a device sends once a day when its owner agreed to it: how many
-- pages and blocks, which features and packs are in use. No content, no titles.
CREATE TABLE usage_reports (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  day INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (device_id, day)
);
CREATE INDEX usage_reports_day ON usage_reports(day);

-- Answers from slow outside sources (GitHub releases, Cloudflare analytics), kept an hour.
CREATE TABLE stats_cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  at INTEGER NOT NULL
);
