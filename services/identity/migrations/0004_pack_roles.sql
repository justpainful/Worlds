-- Pack roles (docs/PACKS.md, Roles): each member's role in each pack a
-- workspace uses. restricted = 1 when that role does not see some fields;
-- those fields live in the item's hidden document, which such a member
-- cannot open. Owners and admins always can.
CREATE TABLE pack_roles (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  pack_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  restricted INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, user_id, pack_id)
);
