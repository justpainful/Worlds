-- The dashboard locks after 15 minutes without activity (docs/admin/PLAN.md,
-- section 9). One row per dashboard device: when it last made a request. A
-- request after a longer gap signs that device out (src/routes/admin.ts).
CREATE TABLE admin_activity (
  device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  last_at INTEGER NOT NULL
);
