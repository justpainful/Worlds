-- One row for each check of one address. Kept for 91 days.
CREATE TABLE checks (
  service TEXT NOT NULL,
  at INTEGER NOT NULL,      -- unix seconds, rounded down to the minute
  ok INTEGER NOT NULL,      -- 1 when the answer was right
  ms INTEGER NOT NULL,      -- time to the answer
  code INTEGER NOT NULL     -- HTTP status, 0 when there was no answer
);
CREATE INDEX checks_service_at ON checks (service, at);
CREATE INDEX checks_at ON checks (at);
