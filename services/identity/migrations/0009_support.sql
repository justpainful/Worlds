-- Support at support.enterworlds.space, and support@enterworlds.space (docs/admin/PLAN.md, phase 2).

-- One request. `number` is what people see (W-1001); `reply_key` threads email
-- replies sent to support+<reply_key>@<domain>. A security report is private:
-- only owners see it.
CREATE TABLE support_tickets (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  name TEXT,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  fields TEXT NOT NULL DEFAULT '{}',
  lang TEXT NOT NULL DEFAULT 'ar',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'waiting', 'working', 'solved', 'closed')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  assignee_id TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  private INTEGER NOT NULL DEFAULT 0,
  reply_key TEXT NOT NULL UNIQUE,
  rating INTEGER,
  via TEXT NOT NULL DEFAULT 'web',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  first_reply_at INTEGER,
  closed_at INTEGER
);
CREATE INDEX support_tickets_status ON support_tickets(status, updated_at);
CREATE INDEX support_tickets_user ON support_tickets(user_id);
CREATE INDEX support_tickets_email ON support_tickets(email);

-- author: person (who asked), team (a reply they see), note (team only), system.
CREATE TABLE support_messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author TEXT NOT NULL CHECK (author IN ('person', 'team', 'note', 'system')),
  author_id TEXT,
  body TEXT NOT NULL,
  files TEXT NOT NULL DEFAULT '[]',
  via TEXT NOT NULL DEFAULT 'web',
  created_at INTEGER NOT NULL
);
CREATE INDEX support_messages_ticket ON support_messages(ticket_id, created_at);

-- Pictures attached to requests, in the files bucket under s/<id>.
CREATE TABLE support_files (
  key TEXT PRIMARY KEY,
  ticket_id TEXT REFERENCES support_tickets(id) ON DELETE CASCADE,
  owner TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Someone who confirmed their email on the support site (with or without an
-- account) gets a session for "My requests". Only a hash is kept.
CREATE TABLE support_sessions (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
