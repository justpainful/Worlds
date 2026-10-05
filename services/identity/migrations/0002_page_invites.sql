-- Invite links made from a page's Share sheet also grant access to that page.
ALTER TABLE invites ADD COLUMN page_id TEXT;
ALTER TABLE invites ADD COLUMN page_level TEXT;
CREATE INDEX invites_page ON invites(workspace_id, page_id);
