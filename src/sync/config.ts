/**
 * Where sync talks to and as whom.
 *
 * The accounts work plugs in here with `configureSync({ getToken, user,
 * serverUrl })`. Until then the app's defaults (appConfig.ts) read two
 * settings, which is enough to test two PCs against a sync service:
 *   sync.serverUrl  e.g. http://localhost:8790
 *   sync.devToken   an access token minted by the identity service
 */

export interface SyncUser {
  id: string;
  name: string;
  color: string;
}

export interface SyncConfig {
  serverUrl: () => string | null;
  getToken: (refresh?: boolean) => Promise<string | null>;
  user: () => SyncUser;
}

const COLORS = ["#64a8ff", "#4cd38a", "#ff9f50", "#b28dff", "#f582c0", "#f2c94c", "#5ac8fa", "#ff6f6f"];

export function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

/** The `sub` claim of a JWT, without verifying it (the server does). */
export function tokenSubject(token: string | null | undefined): string | null {
  if (!token) return null;
  try {
    const part = token.split(".")[1];
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((part.length + 3) % 4));
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === "string" ? sub : null;
  } catch {
    return null;
  }
}

const defaults: SyncConfig = {
  serverUrl: () => null,
  getToken: async () => null,
  user: () => ({ id: "me", name: "You", color: colorFor("me") }),
};

let base: Partial<SyncConfig> = {};
let custom: Partial<SyncConfig> = {};

/** App defaults (settings-backed); `configureSync` still wins over them. */
export function setDefaultSyncConfig(c: Partial<SyncConfig>) {
  base = c;
}
const watchers = new Set<() => void>();

/** Replace parts of the sync configuration (the accounts module calls this). */
export function configureSync(c: Partial<SyncConfig>) {
  custom = { ...custom, ...c };
  for (const w of watchers) w();
}

export function onSyncConfigChange(fn: () => void): () => void {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

export function syncConfig(): SyncConfig {
  return { ...defaults, ...base, ...custom };
}
