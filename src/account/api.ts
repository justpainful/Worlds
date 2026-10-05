import { invoke } from "@tauri-apps/api/core";

/** Access levels on a page, strongest first. */
export type Level = "full" | "edit" | "comment" | "view" | "none";
export type Role = "owner" | "admin" | "member" | "guest";

export interface Account {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  deviceId: string;
  deviceName: string;
  serverUrl: string;
  status: "active" | "expired";
  signedInAt: number;
  lastSyncAt: number | null;
  lastError: string | null;
}

export interface Workspace {
  id: string;
  name: string;
  role: Role;
  ownerId: string | null;
  defaultLevel: Level;
  memberCount: number;
}

export interface AccountView {
  configured: boolean;
  serverUrl: string | null;
  status: "signed_out" | "active" | "expired";
  account: Account | null;
  activeWorkspaceId: string | null;
  workspaces: Workspace[];
  offline: boolean;
  /** Present after a sync that failed. */
  error?: string;
  errorCode?: string;
  created?: boolean;
}

export interface Member {
  userId: string;
  displayName: string;
  email: string | null;
  role: Role;
}

export interface Group {
  id: string;
  name: string;
  memberIds: string[];
}

export interface Invite {
  id: string;
  role: Role;
  createdAt: number;
  expiresAt: number;
  maxUses: number | null;
  uses: number;
  revokedAt: number | null;
  active: boolean;
  /** Links made from a page's Share sheet. */
  pageId?: string | null;
  level?: Level | null;
  /** Only right after creation. */
  url?: string;
}

export interface Device {
  id: string;
  name: string;
  platform: string;
  createdAt: number;
  lastSeenAt: number;
  current: boolean;
}

export interface Passkey {
  id: string;
  name: string;
  synced: boolean;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface PermissionEntry {
  principalType: "user" | "group" | "workspace";
  principalId: string;
  level: Level;
  pageId: string;
  inherited: boolean;
}

export interface PagePermissions {
  pageId: string;
  myLevel: Level;
  inherit: boolean;
  mirrored: boolean;
  entries: PermissionEntry[];
}

export interface PageSharing {
  workspace: Workspace | null;
  level: Level;
  permissions?: PagePermissions;
  members?: Member[];
  groups?: Group[];
  error?: string;
  errorCode?: string;
}

export interface AuditRow {
  id: string;
  at: number;
  actorUserId: string | null;
  actorKind: "user" | "ai-on-behalf-of-user" | "automation" | "system";
  action: string;
  targetType: string | null;
  targetId: string | null;
  meta: Record<string, unknown>;
}

export interface InvitePreview {
  valid: boolean;
  reason?: string;
  message?: string;
  workspace?: { id: string; name: string };
  role?: Role;
  expiresAt?: number;
}

function call<T>(action: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>("account", { action, args: args ?? {} });
}

/** Every call goes through one Rust command; local ones never wait on the network. */
export const accountApi = {
  state: () => call<AccountView>("state"),
  pageLevel: (pageId: string) => call<Level>("pageLevel", { pageId }),
  pageWorkspaces: () => call<Record<string, string>>("pageWorkspaces"),
  setActiveWorkspace: (workspaceId: string | null) => call<AccountView>("setActiveWorkspace", { workspaceId }),
  setServer: (url: string) => call<AccountView>("setServer", { url }),

  emailStart: (email: string) => call<{ challengeId: string; expiresAt: number }>("emailStart", { email }),
  emailVerify: (challengeId: string, code: string, displayName?: string) => call<AccountView>("emailVerify", { challengeId, code, displayName }),
  passkeySignIn: () => call<AccountView>("passkeySignIn"),
  passkeyAdd: () => call<{ opened: boolean }>("passkeyAdd"),
  signOut: () => call<AccountView>("signOut"),
  sync: () => call<AccountView>("sync"),

  updateProfile: (displayName: string) => call<{ displayName: string }>("updateProfile", { displayName }),
  devices: () => call<Device[]>("devices"),
  revokeDevice: (deviceId: string) => call<unknown>("revokeDevice", { deviceId }),
  passkeys: () => call<Passkey[]>("passkeys"),
  removePasskey: (passkeyId: string) => call<unknown>("removePasskey", { passkeyId }),

  createWorkspace: (name: string) => call<AccountView>("createWorkspace", { name }),
  renameWorkspace: (workspaceId: string, name: string) => call<AccountView>("renameWorkspace", { workspaceId, name }),
  deleteWorkspace: (workspaceId: string) => call<AccountView>("deleteWorkspace", { workspaceId }),
  invitePreview: (link: string) => call<InvitePreview>("invitePreview", { link }),
  join: (link: string) => call<AccountView>("join", { link }),
  members: (workspaceId: string) => call<{ members: Member[]; offline: boolean }>("members", { workspaceId }),
  setRole: (workspaceId: string, userId: string, role: Role) => call<{ members: Member[] }>("setRole", { workspaceId, userId, role }),
  removeMember: (workspaceId: string, userId: string) => call<{ members: Member[] }>("removeMember", { workspaceId, userId }),
  leave: (workspaceId: string) => call<AccountView>("leave", { workspaceId }),
  transfer: (workspaceId: string, userId: string) => call<{ members: Member[] }>("transfer", { workspaceId, userId }),
  groups: (workspaceId: string) => call<Group[]>("groups", { workspaceId }),
  createGroup: (workspaceId: string, name: string) => call<Group>("createGroup", { workspaceId, name }),
  deleteGroup: (workspaceId: string, groupId: string) => call<unknown>("deleteGroup", { workspaceId, groupId }),
  setGroupMembers: (workspaceId: string, groupId: string, userIds: string[]) => call<unknown>("setGroupMembers", { workspaceId, groupId, userIds }),
  invites: (workspaceId: string, pageId?: string) => call<Invite[]>("invites", { workspaceId, pageId }),
  createInvite: (workspaceId: string, opts: { role: Role; expiresInHours: number; maxUses: number | null; pageId?: string; level?: Level }) =>
    call<Invite & { url: string }>("createInvite", { workspaceId, ...opts }),
  revokeInvite: (workspaceId: string, inviteId: string) => call<unknown>("revokeInvite", { workspaceId, inviteId }),
  audit: (workspaceId: string) => call<AuditRow[]>("audit", { workspaceId }),

  pageSharing: (pageId: string) => call<PageSharing>("pageSharing", { pageId }),
  setPagePermission: (pageId: string, principalType: PermissionEntry["principalType"], principalId: string, level: Level) =>
    call<PagePermissions>("setPagePermission", { pageId, principalType, principalId, level }),
  removePagePermission: (pageId: string, principalType: PermissionEntry["principalType"], principalId: string) =>
    call<PagePermissions>("removePagePermission", { pageId, principalType, principalId }),
  setPageInherit: (pageId: string, inherit: boolean) => call<PagePermissions>("setPageInherit", { pageId, inherit }),
  movePage: (pageId: string, workspaceId: string | null) => call<AccountView>("movePage", { pageId, workspaceId }),
};

export const LEVEL_LABEL: Record<Level, string> = {
  full: "Full access",
  edit: "Can edit",
  comment: "Can comment",
  view: "Can view",
  none: "No access",
};

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  guest: "Guest",
};

export const ROLE_HINT: Record<Role, string> = {
  owner: "Everything, including deleting the workspace",
  admin: "Manages people, groups and every page",
  member: "Works on shared pages and adds new ones",
  guest: "Only the pages shared with them",
};
