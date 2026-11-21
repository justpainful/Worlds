-- Worlds 1.0: pages published to the web, share links, and an email inbox.

-- A page published at profile.<domain>/@username/<slug>, or (with a random
-- slug and an optional password and end date) a share link at /s/<slug>.
CREATE TABLE published_pages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('page', 'share')),
  title TEXT NOT NULL,
  html TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'en',
  password_hash TEXT,
  expires_at INTEGER,
  views INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX published_pages_slug ON published_pages(kind, user_id, slug);
CREATE UNIQUE INDEX published_shares ON published_pages(slug) WHERE kind = 'share';

-- Mail to <key>@<inbox domain> waits here until the person's Worlds picks it up.
CREATE TABLE mail_addresses (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE mail_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  picked_at INTEGER
);
CREATE INDEX mail_items_user ON mail_items(user_id, picked_at);
