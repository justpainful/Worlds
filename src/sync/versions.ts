/**
 * Shared version history: the sync service cuts versions of a page's
 * document with the people who contributed since the previous one.
 * Restoring applies the old content as a new edit, so nobody's later work
 * disappears from history and every computer converges on the restore.
 */
import * as Y from "yjs";
import { blocksFromY, writeBlocks } from "./mirror";

export interface SharedVersion {
  id: string;
  createdAt: number;
  label: string | null;
  authors: string[];
  size: number;
}

export interface VersionApi {
  serverUrl: string;
  getToken: () => Promise<string | null>;
  workspaceId: string;
  docId: string;
  fetcher?: typeof fetch;
}

async function call(api: VersionApi, path: string, init: RequestInit = {}): Promise<Response> {
  const token = await api.getToken();
  if (!token) throw new Error("Sign in to see shared history");
  const f = api.fetcher ?? fetch.bind(globalThis);
  const url = `${api.serverUrl.replace(/\/+$/, "")}/v1/workspaces/${encodeURIComponent(api.workspaceId)}/docs/${encodeURIComponent(api.docId)}/versions${path}`;
  const r = await f(url, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" } });
  if (!r.ok) throw new Error(r.status === 403 ? "You do not have access to this history" : `History is unavailable (${r.status})`);
  return r;
}

export async function listVersions(api: VersionApi): Promise<SharedVersion[]> {
  return ((await (await call(api, "")).json()) as { versions: SharedVersion[] }).versions;
}

export async function saveVersion(api: VersionApi, label: string | null): Promise<SharedVersion> {
  return (await (await call(api, "", { method: "POST", body: JSON.stringify({ label }) })).json()) as SharedVersion;
}

export async function versionState(api: VersionApi, id: string): Promise<Uint8Array> {
  return new Uint8Array(await (await call(api, `/${encodeURIComponent(id)}`)).arrayBuffer());
}

/** Make `live` hold the content of an old state, as one ordinary edit. */
export function restoreInto(live: Y.Doc, oldState: Uint8Array, origin?: unknown) {
  const old = new Y.Doc();
  Y.applyUpdate(old, oldState);
  writeBlocks(live, blocksFromY(old), origin);
}
