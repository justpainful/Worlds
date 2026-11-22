-- Suggestions and votes, the public roadmap, testers, short surveys, and
-- messages from the team (docs/admin/PLAN.md, phase 5).

-- An idea someone sent. It shows on the public board and roadmap only once the
-- team approves it (public = 1). status follows it from new to shipped.
CREATE TABLE suggestions (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  email TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  lang TEXT NOT NULL DEFAULT 'ar',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'planned', 'working', 'shipped', 'declined', 'duplicate')),
  public INTEGER NOT NULL DEFAULT 0,
  shipped_in TEXT,
  merged_into TEXT,
  team_note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX suggestions_status ON suggestions(public, status, updated_at);

-- One vote per person: "u:<user id>" or "e:<email>" for people without an account.
CREATE TABLE suggestion_votes (
  suggestion_id TEXT NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
  voter TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (suggestion_id, voter)
);

CREATE TABLE testers (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('applied', 'accepted', 'removed')),
  platforms TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  applied_at INTEGER NOT NULL,
  decided_at INTEGER,
  decided_by TEXT
);

-- One question shown in the app. choices empty means a free answer.
CREATE TABLE surveys (
  id TEXT PRIMARY KEY,
  question_ar TEXT NOT NULL,
  question_en TEXT NOT NULL,
  choices TEXT NOT NULL DEFAULT '[]',
  audience TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'testers')),
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  ends_at INTEGER
);
CREATE TABLE survey_answers (
  survey_id TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  choice INTEGER,
  text TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (survey_id, user_id)
);

-- A conversation the team starts with one person, answered in the app.
CREATE TABLE team_threads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  started_by TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX team_threads_user ON team_threads(user_id, updated_at);
CREATE TABLE team_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES team_threads(id) ON DELETE CASCADE,
  author TEXT NOT NULL CHECK (author IN ('team', 'person')),
  author_id TEXT,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX team_messages_thread ON team_messages(thread_id, created_at);
