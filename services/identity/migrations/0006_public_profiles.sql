-- Public profiles: what a person chooses to show at profile.<domain>/@username.
-- One row per account. Hidden (visible = 0) reads exactly like no profile at all.
-- data is the published profile as JSON (name, bio, links, blocks...); images
-- live in the PROFILE_FILES bucket under p/<user id>/ and are named in data as
-- "file:<key>", with avatar_key and banner_key for the two main ones.
CREATE TABLE public_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  visible INTEGER NOT NULL DEFAULT 1,
  data TEXT NOT NULL DEFAULT '{}',
  avatar_key TEXT,
  banner_key TEXT,
  published_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
