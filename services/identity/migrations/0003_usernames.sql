-- Every account has a username (3 to 20 characters, stored lowercase).
-- username_auto = 1 while it is one the system chose, so the app may replace
-- it with the person's own handle the first time they link a profile.
ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN username_auto INTEGER NOT NULL DEFAULT 0;

-- Accounts made before usernames existed get one now.
UPDATE users SET username = 'user' || lower(substr(replace(id, '-', ''), 1, 10)), username_auto = 1 WHERE username IS NULL;

CREATE UNIQUE INDEX users_username ON users (username);
