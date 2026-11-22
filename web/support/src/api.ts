/** The support site talks to the identity service's /support API (services/identity/src/routes/support.ts). */
export const IDENTITY = ((import.meta.env.VITE_IDENTITY_URL as string | undefined) ?? (import.meta.env.DEV ? "http://localhost:8787" : "https://login.enterworlds.space")).replace(/\/+$/, "");

const KEY = "worlds.support.session";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

interface Session {
  token: string;
  email: string;
  expiresAt: number;
}

function load(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as Session | null;
    return s && s.expiresAt > Date.now() ? s : null;
  } catch {
    return null;
  }
}
let session = load();
const subs = new Set<() => void>();
function store(s: Session | null) {
  session = s;
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    // This visit only.
  }
  for (const f of subs) f();
}
export const onSession = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};
export const currentEmail = () => session?.email ?? null;

export async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(IDENTITY + path, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(session ? { "x-support-session": session.token } : {}) },
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
    // Not JSON.
  }
  if (!res.ok) {
    if (res.status === 401 && session) store(null);
    throw new ApiError(res.status, json?.error ?? "http_error", json?.message ?? text.slice(0, 200));
  }
  return json as T;
}

export async function startEmail(email: string, lang: string): Promise<string> {
  return (await call<{ challengeId: string }>("POST", "/auth/email/start", { email, lang })).challengeId;
}

export async function confirmEmail(challengeId: string, code: string): Promise<void> {
  const s = await call<Session>("POST", "/support/session", { challengeId, code });
  store(s);
}

export async function signOut(): Promise<void> {
  try {
    await call("POST", "/support/session/end", {});
  } catch {
    // Gone here either way.
  }
  store(null);
}

export async function upload(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return (await call<{ key: string }>("POST", "/support/files", { mime: file.type, data: btoa(bin) })).key;
}

export async function picture(key: string): Promise<string> {
  const res = await fetch(`${IDENTITY}/support/files/${key}`, { headers: session ? { "x-support-session": session.token } : {} });
  if (!res.ok) throw new ApiError(res.status, "http_error", String(res.status));
  return URL.createObjectURL(await res.blob());
}

export type Kind = "problem" | "account" | "recovery" | "deletion" | "report" | "security" | "suggestion" | "other";
export type Status = "open" | "waiting" | "working" | "solved" | "closed";

export interface Request {
  id: string;
  number: number;
  ref: string;
  kind: Kind;
  subject: string;
  fields: Record<string, string>;
  status: Status;
  rating: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Message {
  id: string;
  author: "person" | "team" | "system";
  body: string;
  files: string[];
  via: string;
  createdAt: number;
}
