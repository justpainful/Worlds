-- Which version of the terms of use, privacy policy and content policy each
-- account accepted, and when (lib/terms.ts). Accounts made before have none.
ALTER TABLE users ADD COLUMN terms_version TEXT;
ALTER TABLE users ADD COLUMN terms_accepted_at INTEGER;
