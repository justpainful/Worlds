/**
 * Browser preview only (`pnpm dev`, then open with ?mock): answers the
 * `account` command with an in-memory account so the account UI can be
 * tried without the desktop app or a server. Never active in the app.
 */
import type { AccountView, Group, Invite, Level, Member, PermissionEntry, Role } from "./api";

type Args = Record<string, any>;

const t0 = Date.now();
let view: AccountView = {
  configured: true,
  serverUrl: "http://localhost:8787",
  status: "signed_out",
  account: null,
  activeWorkspaceId: null,
  workspaces: [],
  offline: false,
};
const pageWs: Record<string, string> = {};
const perms: Record<string, { inherit: boolean; entries: PermissionEntry[] }> = {};
const members: Member[] = [
  { userId: "u-ada", displayName: "Ada Lovelace", email: "ada@example.com", role: "owner" },
  { userId: "u-grace", displayName: "Grace Hopper", email: "grace@example.com", role: "member" },
  { userId: "u-alan", displayName: "Alan Turing", email: "alan@example.com", role: "guest" },
];
const groups: Group[] = [{ id: "g-design", name: "Design", memberIds: ["u-grace"] }];
const invites: Invite[] = [];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const signIn = (created: boolean): AccountView => {
  view = {
    ...view,
    status: "active",
    account: {
      userId: "u-ada",
      email: "ada@example.com",
      displayName: "Ada Lovelace",
      avatarUrl: null,
      deviceId: "d-1",
      deviceName: "Worlds on DESKTOP",
      serverUrl: "http://localhost:8787",
      status: "active",
      signedInAt: Date.now(),
      lastSyncAt: Date.now(),
      lastError: null,
    },
    workspaces: [{ id: "ws-studio", name: "Studio", role: "owner", ownerId: "u-ada", defaultLevel: "edit", memberCount: members.length }],
  };
  return { ...view, created };
};

async function account(action: string, a: Args): Promise<unknown> {
  switch (action) {
    case "state":
    case "sync":
      return view;
    case "pageLevel":
      return "full";
    case "pageWorkspaces":
      return { ...pageWs };
    case "setActiveWorkspace":
      view = { ...view, activeWorkspaceId: a.workspaceId ?? null };
      return view;
    case "setServer":
      view = { ...view, serverUrl: a.url };
      return view;
    case "emailStart":
      await wait(400);
      return { challengeId: "c-1", expiresAt: Date.now() + 600_000 };
    case "emailVerify":
      await wait(500);
      if (a.code !== "123456") throw "That code is not right. (In this preview the code is 123456.)";
      return signIn(true);
    case "passkeySignIn":
      await wait(1600);
      return signIn(false);
    case "passkeyAdd":
      return { opened: true };
    case "signOut":
      view = { ...view, status: "signed_out", account: null, workspaces: [], activeWorkspaceId: null };
      return view;
    case "updateProfile":
      if (view.account) view = { ...view, account: { ...view.account, displayName: a.displayName } };
      return { displayName: a.displayName };
    case "devices":
      return [
        { id: "d-1", name: "Worlds on DESKTOP", platform: "windows", createdAt: t0 - 86_400_000 * 20, lastSeenAt: Date.now(), current: true },
        { id: "d-2", name: "Worlds on LAPTOP", platform: "windows", createdAt: t0 - 86_400_000 * 3, lastSeenAt: t0 - 7_200_000, current: false },
      ];
    case "revokeDevice":
    case "removePasskey":
      return { ok: true };
    case "passkeys":
      return [{ id: "pk-1", name: "Windows Hello", synced: false, createdAt: t0 - 86_400_000 * 20, lastUsedAt: t0 - 3_600_000 }];
    case "createWorkspace": {
      const w = { id: `ws-${Date.now()}`, name: a.name, role: "owner" as Role, ownerId: "u-ada", defaultLevel: "edit" as Level, memberCount: 1 };
      view = { ...view, workspaces: [...view.workspaces, w], activeWorkspaceId: w.id };
      return view;
    }
    case "invitePreview":
      return /wi_/.test(a.link)
        ? { valid: true, workspace: { id: "ws-lab", name: "Lab" }, role: "member", expiresAt: Date.now() + 86_400_000 }
        : { valid: false, message: "This invite link is not valid." };
    case "join": {
      const w = { id: "ws-lab", name: "Lab", role: "member" as Role, ownerId: "u-x", defaultLevel: "edit" as Level, memberCount: 4 };
      view = { ...view, workspaces: [...view.workspaces.filter((x) => x.id !== w.id), w], activeWorkspaceId: w.id };
      return view;
    }
    case "members":
      return { members, offline: false };
    case "setRole": {
      const m = members.find((x) => x.userId === a.userId);
      if (m) m.role = a.role;
      return { members };
    }
    case "removeMember":
      members.splice(
        members.findIndex((x) => x.userId === a.userId),
        1,
      );
      return { members };
    case "leave":
    case "deleteWorkspace":
      view = { ...view, workspaces: view.workspaces.filter((w) => w.id !== a.workspaceId), activeWorkspaceId: null };
      return view;
    case "transfer":
      return { members };
    case "groups":
      return groups;
    case "createGroup": {
      const g = { id: `g-${Date.now()}`, name: a.name, memberIds: [] };
      groups.push(g);
      return g;
    }
    case "deleteGroup":
      groups.splice(
        groups.findIndex((g) => g.id === a.groupId),
        1,
      );
      return { ok: true };
    case "setGroupMembers": {
      const g = groups.find((x) => x.id === a.groupId);
      if (g) g.memberIds = a.userIds;
      return { ok: true };
    }
    case "invites":
      return invites.filter((i) => (a.pageId ? i.pageId === a.pageId : true));
    case "createInvite": {
      const inv: Invite = {
        id: `i-${Date.now()}`,
        role: a.role,
        createdAt: Date.now(),
        expiresAt: Date.now() + a.expiresInHours * 3_600_000,
        maxUses: a.maxUses,
        uses: 0,
        revokedAt: null,
        active: true,
        pageId: a.pageId ?? null,
        level: a.level ?? null,
        url: "http://localhost:8787/join/wi_previewpreview",
      };
      invites.unshift(inv);
      return inv;
    }
    case "revokeInvite": {
      const i = invites.find((x) => x.id === a.inviteId);
      if (i) i.active = false;
      return { ok: true };
    }
    case "audit":
      return [
        {
          id: "a1",
          at: Date.now() - 60_000,
          actorUserId: "u-ada",
          actorKind: "ai-on-behalf-of-user",
          action: "permission.set",
          targetType: "page",
          targetId: null,
          meta: {},
        },
        {
          id: "a2",
          at: Date.now() - 3_600_000,
          actorUserId: "u-grace",
          actorKind: "user",
          action: "member.joined",
          targetType: "invite",
          targetId: null,
          meta: {},
        },
        {
          id: "a3",
          at: Date.now() - 7_200_000,
          actorUserId: "u-ada",
          actorKind: "user",
          action: "workspace.created",
          targetType: "workspace",
          targetId: null,
          meta: {},
        },
      ];
    case "pageSharing": {
      const ws = view.workspaces.find((w) => w.id === pageWs[a.pageId]) ?? null;
      if (!ws) return { workspace: null, level: "full" };
      const p = (perms[a.pageId] ??= {
        inherit: true,
        entries: [{ principalType: "group", principalId: "g-design", level: "edit", pageId: a.pageId, inherited: false }],
      });
      return {
        workspace: ws,
        level: "full",
        permissions: { pageId: a.pageId, myLevel: "full", inherit: p.inherit, mirrored: true, entries: p.entries },
        members,
        groups,
      };
    }
    case "setPagePermission":
    case "removePagePermission":
    case "setPageInherit": {
      const p = (perms[a.pageId] ??= { inherit: true, entries: [] });
      if (action === "setPageInherit") p.inherit = a.inherit;
      else {
        p.entries = p.entries.filter((e) => !(e.principalType === a.principalType && e.principalId === a.principalId));
        if (action === "setPagePermission")
          p.entries.push({ principalType: a.principalType, principalId: a.principalId, level: a.level, pageId: a.pageId, inherited: false });
      }
      return { pageId: a.pageId, myLevel: "full", inherit: p.inherit, mirrored: true, entries: p.entries };
    }
    case "movePage":
      if (a.workspaceId) pageWs[a.pageId] = a.workspaceId;
      else delete pageWs[a.pageId];
      return view;
  }
  throw `unknown account action ${action}`;
}

const w = window as any;
if (import.meta.env.DEV && w.__WORLDS_MOCK__ && w.__TAURI_INTERNALS__) {
  const original = w.__TAURI_INTERNALS__.invoke;
  w.__TAURI_INTERNALS__.invoke = (cmd: string, args: any, opts: unknown) =>
    cmd === "account" ? account(args.action, args.args ?? {}) : original(cmd, args, opts);
}
