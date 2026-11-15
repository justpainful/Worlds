/**
 * Accounts in Worlds on the web (go.enterworlds.space): the real identity
 * service over HTTPS, so a person can create an account, get the code by
 * email and sign in from a browser. The pages themselves stay in the tab
 * (the web version has no local database), so sharing and sync stay in the
 * apps; those actions say so instead of pretending.
 *
 * The session lives in sessionStorage: it ends when the tab closes, like the
 * rest of the web version. The browser has no device key, so the service
 * treats it as a device without one.
 */
import type { Account, AccountView, Device, Workspace } from "./api";
import { tr } from "../i18n/ui";

type Args = Record<string, any>;

interface Session {
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
  deviceId: string;
  userId: string;
  signedInAt: number;
}

interface UserView {
  id: string;
  email: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
}

const KEY = "worlds.web.session";
export const IDENTITY_URL = (import.meta.env.VITE_IDENTITY_URL as string | undefined)?.replace(/\/+$/, "") ?? "";

const DEVICE = { name: "Worlds on the web", platform: "web" };
let me: UserView | null = null;
let workspaces: Workspace[] = [];
let activeWorkspaceId: string | null = null;

function load(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}
function store(s: Session | null) {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    // Private windows can refuse storage; the session then lasts until reload.
  }
}
let session: Session | null = load();

/** The service's error as a sentence the person can act on. */
async function failure(res: Response): Promise<never> {
  let message = `The account service answered ${res.status}.`;
  try {
    const body = (await res.json()) as { message?: string };
    if (body.message) message = body.message;
  } catch {
    // keep the status line
  }
  throw tr(message);
}

async function request<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
  if (auth) await fresh();
  let res: Response;
  try {
    res = await fetch(IDENTITY_URL + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(auth && session ? { authorization: `Bearer ${session.accessToken}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw tr("Worlds could not reach the account service. Check your connection.");
  }
  if (res.status === 401 && auth) {
    signOutLocally();
    throw tr("You were signed out. Sign in again.");
  }
  if (!res.ok) return failure(res);
  return (await res.json()) as T;
}

/** Refresh the access token a minute before it runs out. */
async function fresh() {
  if (!session || session.accessTokenExpiresAt - Date.now() > 60_000) return;
  const res = await fetch(IDENTITY_URL + "/auth/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: session.refreshToken, deviceId: session.deviceId }),
  }).catch(() => null);
  if (!res || !res.ok) {
    signOutLocally();
    return;
  }
  const t = (await res.json()) as Omit<Session, "signedInAt">;
  session = { ...session, ...t };
  store(session);
}

function signOutLocally() {
  session = null;
  me = null;
  workspaces = [];
  activeWorkspaceId = null;
  store(null);
}

function account(): Account | null {
  if (!session || !me) return null;
  return {
    userId: me.id,
    email: me.email,
    displayName: me.displayName,
    avatarUrl: me.avatarUrl,
    deviceId: session.deviceId,
    deviceName: DEVICE.name,
    serverUrl: IDENTITY_URL,
    status: "active",
    signedInAt: session.signedInAt,
    lastSyncAt: Date.now(),
    lastError: null,
  };
}

function view(extra: Partial<AccountView> = {}): AccountView {
  const a = account();
  return {
    configured: true,
    serverUrl: IDENTITY_URL,
    status: a ? "active" : "signed_out",
    account: a,
    activeWorkspaceId,
    workspaces,
    offline: false,
    ...extra,
  };
}

async function refreshAll(): Promise<AccountView> {
  if (!session) return view();
  me = await request<UserView>("GET", "/me");
  workspaces = (await request<Omit<Workspace, "memberCount"> & { memberCount: number }[]>("GET", "/workspaces")) as unknown as Workspace[];
  if (activeWorkspaceId && !workspaces.some((w) => w.id === activeWorkspaceId)) activeWorkspaceId = null;
  return view();
}

const onlyInApp = () => {
  throw tr("Sharing and teams work in the Worlds app. On the web, pages stay in this tab.");
};

/** Answers the account actions the web version supports; null for the rest. */
export async function webAccount(action: string, a: Args): Promise<unknown> {
  switch (action) {
    case "state":
    case "sync":
      try {
        return await refreshAll();
      } catch (e) {
        return view({ error: String(e) });
      }
    case "setServer":
      return view();
    case "emailStart":
      return request("POST", "/auth/email/start", { email: a.email, lang: a.lang }, false);
    case "emailVerify": {
      const t = await request<Omit<Session, "signedInAt"> & { user: UserView; created: boolean }>(
        "POST",
        "/auth/email/verify",
        { challengeId: a.challengeId, code: a.code, displayName: a.displayName, device: DEVICE },
        false,
      );
      session = {
        accessToken: t.accessToken,
        accessTokenExpiresAt: t.accessTokenExpiresAt,
        refreshToken: t.refreshToken,
        deviceId: t.deviceId,
        userId: t.userId,
        signedInAt: Date.now(),
      };
      store(session);
      me = t.user;
      await refreshAll().catch(() => undefined);
      return view({ created: t.created });
    }
    case "signOut":
      await request("POST", "/auth/logout").catch(() => undefined);
      signOutLocally();
      return view();
    case "updateProfile": {
      const patch: Record<string, unknown> = {};
      if (a.displayName !== undefined) patch.displayName = a.displayName;
      if (a.username !== undefined) patch.username = a.username;
      me = await request<UserView>("PATCH", "/me", patch);
      return { displayName: me.displayName, username: me.username };
    }
    case "checkUsername": {
      const name = encodeURIComponent(String(a.username ?? a.name ?? ""));
      return request("GET", `/auth/username/${name}`, undefined, false);
    }
    case "devices": {
      const list = await request<Omit<Device, "current">[]>("GET", "/me/devices");
      return list.map((d) => ({ ...d, current: d.id === session?.deviceId }));
    }
    case "setActiveWorkspace":
      activeWorkspaceId = a.workspaceId ?? null;
      return view();
    case "createWorkspace":
      await request("POST", "/workspaces", { name: a.name });
      return refreshAll();
    case "pageLevel":
      return "full";
    case "pageWorkspaces":
      return {};
    case "passkeySignIn":
    case "passkeyAdd":
      throw tr("Passkeys work in the Worlds app. On the web, sign in with the email code.");
    default:
      return onlyInApp();
  }
}
