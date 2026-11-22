-- Public content the team reviews (docs/admin/PLAN.md, phase 4).

-- Hidden by the team (team_hidden = 1), apart from the owner's own choice to
-- show or hide it. team_reason says why; 'reports' means it was hidden by
-- itself after reports from several people and waits for review.
ALTER TABLE public_profiles ADD COLUMN team_hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public_profiles ADD COLUMN team_reason TEXT;
ALTER TABLE published_pages ADD COLUMN team_hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE published_pages ADD COLUMN team_reason TEXT;

-- Accounts the team looked at in "Suspicious accounts" and left alone.
CREATE TABLE suspicious_reviews (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  reviewed_by TEXT,
  reviewed_at INTEGER NOT NULL
);
