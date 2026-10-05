import type { Role } from "./api";

// The same rules the identity service enforces (services/identity/src/domain/roles.ts).
// The UI uses them only to hide controls that would be refused anyway.

const manager = (r: Role | undefined) => r === "owner" || r === "admin";

export function canInvite(actor: Role | undefined, role: Role): boolean {
  if (role === "owner") return false;
  if (actor === "owner") return true;
  if (actor === "admin") return role === "member" || role === "guest";
  return false;
}

export function canChangeRole(actor: Role | undefined, target: Role, next: Role, isSelf: boolean): boolean {
  if (isSelf || next === "owner" || target === "owner") return false;
  if (actor === "owner") return true;
  if (actor === "admin") return (target === "member" || target === "guest") && (next === "member" || next === "guest");
  return false;
}

export function canRemove(actor: Role | undefined, target: Role, isSelf: boolean): boolean {
  if (isSelf || target === "owner") return false;
  if (actor === "owner") return true;
  if (actor === "admin") return target === "member" || target === "guest";
  return false;
}

export const canManage = manager;
