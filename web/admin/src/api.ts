/**
 * The dashboard talks only to the identity service (services/identity/src/routes/admin.ts).
 * The session lives in this browser's localStorage, like Worlds on the web; the
 * service checks the team role and the second check on every request.
 */
export const IDENTITY = ((import.meta.env.VITE_IDENTITY_URL as string | undefined) ?? (import.meta.env.DEV ? "http://localhost:8787" : "https://login.enterworlds.space")).replace(/\/+$/, "");

const KEY = "worlds.admin.session";
const DEVICE = { name: "Worlds dashboard", platform: "admin" };

interface Session {
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
  deviceId: string;
  userId: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

function load(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}
let session: Session | null = load();
function store(s: Session | null) {
  session = s;
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    // A private window may refuse storage; the session then lasts until reload.
  }
  for (const fn of listeners) fn(!!s);
}

const listeners = new Set<(signedIn: boolean) => void>();
export function onSession(fn: (signedIn: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const isSignedIn = () => !!session;

async function raw<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(IDENTITY + path, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "offline", "The service could not be reached.");
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON: keep the text for the message.
  }
  if (!res.ok) {
    const { error, message, ...extra } = json ?? {};
    throw new ApiError(res.status, error ?? "http_error", message ?? text.slice(0, 200), extra);
  }
  return json as T;
}

let refreshing: Promise<void> | null = null;
async function fresh(force = false): Promise<string> {
  if (!session) throw new ApiError(401, "signed_out", "Sign in first.");
  if (!force && session.accessTokenExpiresAt - Date.now() > 60_000) return session.accessToken;
  refreshing ??= (async () => {
    try {
      const t = await raw<Session>("POST", "/auth/refresh", { refreshToken: session!.refreshToken, deviceId: session!.deviceId });
      store({ ...t });
    } catch (e) {
      if (e instanceof ApiError && e.status !== 0) store(null);
      throw e;
    } finally {
      refreshing = null;
    }
  })();
  await refreshing;
  return session!.accessToken;
}

/** A request as the signed-in team member. */
export async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await fresh();
  try {
    return await raw<T>(method, path, body, token);
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401) throw e;
    // The access token was refused (the service changed keys, or the clock is off):
    // renew it once with the refresh token before giving up the session.
    const again = await fresh(true);
    return raw<T>(method, path, body, again).catch((e2) => {
      if (e2 instanceof ApiError && e2.status === 401) store(null);
      throw e2;
    });
  }
}

// ---------------------------------------------------------------------------
// Signing in
// ---------------------------------------------------------------------------

function keep(t: Session) {
  store({ accessToken: t.accessToken, accessTokenExpiresAt: t.accessTokenExpiresAt, refreshToken: t.refreshToken, deviceId: t.deviceId, userId: t.userId });
}

export async function emailStart(email: string, lang: string): Promise<string> {
  const r = await raw<{ challengeId: string }>("POST", "/auth/email/start", { email, lang });
  return r.challengeId;
}

export async function emailSignIn(challengeId: string, code: string): Promise<void> {
  keep(await raw<Session>("POST", "/auth/email/verify", { challengeId, code, create: false, device: DEVICE }));
}

export async function passkeySignIn(): Promise<void> {
  const { challengeId, options } = await raw<{ challengeId: string; options: any }>("POST", "/auth/passkey/login/options", {});
  const response = await getCredential(options);
  keep(await raw<Session>("POST", "/auth/passkey/login/verify", { challengeId, response, device: DEVICE }));
}

export async function signOut(): Promise<void> {
  try {
    if (session) await raw("POST", "/auth/logout", {}, await fresh());
  } catch {
    // Signed out here either way.
  }
  store(null);
}

// ---------------------------------------------------------------------------
// WebAuthn in the browser (base64url JSON on the wire)
// ---------------------------------------------------------------------------

const b64 = {
  decode(s: string): ArrayBuffer {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  },
  encode(buf: ArrayBuffer | null): string | undefined {
    if (!buf) return undefined;
    let s = "";
    for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
};

export const passkeysSupported = () => typeof window !== "undefined" && !!window.PublicKeyCredential;

/** Ask the browser for a passkey answering the service's options. */
export async function getCredential(options: any): Promise<unknown> {
  if (!passkeysSupported()) throw new ApiError(0, "no_webauthn", "This browser cannot use passkeys.");
  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: b64.decode(options.challenge),
    rpId: options.rpId,
    timeout: options.timeout,
    userVerification: options.userVerification,
    allowCredentials: (options.allowCredentials ?? []).map((c: { id: string; type: string; transports?: string[] }) => ({
      id: b64.decode(c.id),
      type: "public-key",
      transports: c.transports as AuthenticatorTransport[] | undefined,
    })),
  };
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
  } catch (e) {
    const name = (e as DOMException)?.name;
    if (name === "NotAllowedError" || name === "AbortError") throw new ApiError(0, "cancelled", "Cancelled.");
    if (name === "SecurityError") throw new ApiError(0, "wrong_origin", "This browser does not allow passkeys from this address yet.");
    throw new ApiError(0, "passkey_failed", String((e as Error)?.message ?? e));
  }
  if (!cred) throw new ApiError(0, "cancelled", "Cancelled.");
  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: b64.encode(cred.rawId),
    type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults(),
    authenticatorAttachment: (cred as { authenticatorAttachment?: string | null }).authenticatorAttachment ?? undefined,
    response: {
      clientDataJSON: b64.encode(r.clientDataJSON),
      authenticatorData: b64.encode(r.authenticatorData),
      signature: b64.encode(r.signature),
      userHandle: b64.encode(r.userHandle),
    },
  };
}

// ---------------------------------------------------------------------------
// Shapes the admin API returns
// ---------------------------------------------------------------------------

export type Role = "owner" | "moderator" | "support";
export type Permission =
  | "users.read"
  | "users.email"
  | "users.edit"
  | "users.edit_email"
  | "users.suspend"
  | "users.ban"
  | "users.devices"
  | "notes"
  | "audit"
  | "stats"
  | "team";

export interface Me {
  user: { id: string; email: string; displayName: string; username: string; avatarUrl: string | null };
  role: Role;
  permissions: Permission[];
  stepUpUntil: number | null;
  hasPasskey: boolean;
}

export type Status = "active" | "suspended" | "banned";

export interface UserItem {
  id: string;
  email: string | null;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  createdAt: number;
  lastSeenAt: number | null;
  devices: number;
  status: Status;
  suspendedUntil: number | null;
  teamRole: Role | null;
}

export interface LogEntry {
  id: string;
  at: number;
  actorUserId: string | null;
  actorKind: string;
  deviceId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  meta: Record<string, unknown>;
  actorName?: string | null;
  actorUsername?: string | null;
  targetName?: string | null;
}

export interface UserDetail extends Omit<UserItem, "devices"> {
  usernameAuto: boolean;
  emailVerifiedAt: number | null;
  updatedAt: number;
  suspension: { until: number | null; banned: boolean; reason: string | null; since: number | null } | null;
  devices: Device[];
  passkeys: { id: string; name: string; synced: boolean; createdAt: number; lastUsedAt: number | null }[];
  workspaces: { id: string; name: string; role: string; owns: boolean; members: number; pages: number; joinedAt: number }[];
  profile: { visible: boolean; avatar: boolean; banner: boolean; publishedAt: number; updatedAt: number } | null;
  published: { slug: string; kind: "page" | "share"; title: string; views: number; expiresAt: number | null; locked: boolean; createdAt: number; updatedAt: number }[];
  mail: { address: string | null; createdAt: number; waiting: number } | null;
  notes: { id: string; body: string; createdAt: number; author: { id: string; name: string | null; username: string | null } | null }[];
  activity: LogEntry[];
}

export interface Device {
  id: string;
  name: string;
  platform: string;
  deviceKey: boolean;
  createdAt: number;
  lastSeenAt: number;
  revokedAt: number | null;
}

export interface Stats {
  at: number;
  users: { total: number; suspended: number; banned: number; withPasskey: number };
  signups: { day: number; week: number; month: number; perDay: { day: number; count: number }[] };
  active: { day: number; week: number; month: number; devices: number };
  platforms: { platform: string; devices: number; users: number }[];
  workspaces: { total: number; shared: number };
  public: { profiles: number; pages: number; shares: number };
  passkeys: number;
}

export interface TeamMember {
  id: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  role: Role;
  fixed: boolean;
  grantedAt: number | null;
}
