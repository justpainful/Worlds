/** Workspace roles and page access levels, plus the pure rules that govern them. */

export const ROLES = ["owner", "admin", "member", "guest"] as const;
export type Role = (typeof ROLES)[number];

export const LEVELS = ["none", "view", "comment", "edit", "full"] as const;
export type Level = (typeof LEVELS)[number];
/** Levels a page entry may carry ("none" is used to restrict). */
export const GRANTABLE: Level[] = ["full", "edit", "comment", "view", "none"];

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

export function isLevel(v: unknown): v is Level {
  return typeof v === "string" && (LEVELS as readonly string[]).includes(v);
}

export function rank(l: Level): number {
  return LEVELS.indexOf(l);
}

export function atLeast(have: Level, need: Level): boolean {
  return rank(have) >= rank(need);
}

export function maxLevel(levels: Level[]): Level {
  return levels.reduce<Level>((m, l) => (rank(l) > rank(m) ? l : m), "none");
}

const isManager = (r: Role) => r === "owner" || r === "admin";

/** Who may create an invite link for a given role. */
export function canInvite(actor: Role, inviteRole: Role): boolean {
  if (inviteRole === "owner") return false;
  if (actor === "owner") return true;
  if (actor === "admin") return inviteRole === "member" || inviteRole === "guest";
  return false;
}

/** Changing someone else's role. Ownership only moves by transfer. */
export function canChangeRole(actor: Role, target: Role, next: Role, isSelf: boolean): boolean {
  if (isSelf || next === "owner" || target === "owner") return false;
  if (actor === "owner") return true;
  if (actor === "admin") return (target === "member" || target === "guest") && (next === "member" || next === "guest");
  return false;
}

/** Removing a member (not yourself: that is leaving). */
export function canRemove(actor: Role, target: Role, isSelf: boolean): boolean {
  if (isSelf || target === "owner") return false;
  if (actor === "owner") return true;
  if (actor === "admin") return target === "member" || target === "guest";
  return false;
}

/** Anyone but the owner may leave; the owner transfers ownership first. */
export function canLeave(role: Role): boolean {
  return role !== "owner";
}

export const canManageWorkspace = isManager;
export const canManageGroups = isManager;
export const canReadAudit = isManager;
export const canManageInvites = isManager;
