/**
 * Worlds on the web, signed in: the workspace in this browser is also kept
 * on the person's account (services/sync/src/vault.ts), so it opens on any
 * browser they sign in to. Signed out, the browser copy alone is used.
 *
 * On sign-in the two copies are merged (mergeSnapshots: each page keeps its
 * latest change), then every save here is sent a few seconds later with the
 * revision it was based on. If another device saved in between, the newer
 * copy is fetched, merged and sent again, so neither device overwrites the
 * other. Attached files go up and come down on their own.
 */
import { accessToken, onSessionChange, signedInUser } from "../account/webAccount";
import { adoptFile, fileBlobUrl, fileMeta, mergeSnapshots, missingFiles, onWorkspaceSaved, restore, snapshot, type Snapshot } from "../dev/mockTauri";
import { saveSnapshot } from "./persist";

const SYNC_URL = (import.meta.env.VITE_SYNC_URL as string | undefined)?.replace(/\/+$/, "") ?? "";

const etagKey = (user: string) => `worlds.web.vault.${user}.etag`;
const sentKey = (user: string) => `worlds.web.vault.${user}.files`;
const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    // private window
  }
};

let user: string | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let busy = false;
let again = false;

async function call(path: string, init: RequestInit = {}): Promise<Response | null> {
  const token = await accessToken();
  if (!token || !SYNC_URL) return null;
  try {
    return await fetch(SYNC_URL + path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } });
  } catch {
    return null; // offline: the browser copy is safe, the next save tries again
  }
}

/** Puts a merged copy in place, saves it here, and tells the open views to read it again. */
async function adopt(merged: Snapshot, changedPages: boolean) {
  restore(merged);
  await saveSnapshot(merged);
  if (changedPages) {
    const { useStore } = await import("../state/store");
    await useStore.getState().refreshPages();
  }
}

const pageStamp = (s: Snapshot) =>
  Object.values(s.pages ?? {})
    .map((p: any) => `${p.id}:${p.updatedAt}:${p.deletedAt ?? ""}`)
    .sort()
    .join("|");

async function pull(): Promise<{ remote: Snapshot | null; etag: string | null } | null> {
  const res = await call("/v1/vault");
  if (!res) return null;
  if (res.status === 404) return { remote: null, etag: null };
  if (!res.ok) return null;
  return { remote: (await res.json()) as Snapshot, etag: res.headers.get("etag") };
}

/** Send this browser's copy, merging first whenever the account has a newer one. */
async function push(): Promise<void> {
  if (!user) return;
  if (busy) {
    again = true;
    return;
  }
  busy = true;
  try {
    for (let attempt = 0; attempt < 3 && user; attempt++) {
      const local = snapshot();
      const res = await call("/v1/vault", {
        method: "PUT",
        headers: { "content-type": "application/json", "if-match": read(etagKey(user)) ?? "none" },
        body: JSON.stringify(local),
      });
      if (!res) return;
      if (res.ok) {
        write(etagKey(user), ((await res.json()) as { etag: string }).etag);
        await sendFiles();
        return;
      }
      if (res.status !== 412) return;
      // Another device saved first: take its changes, then try again.
      const got = await pull();
      if (!got) return;
      if (got.remote) {
        const before = pageStamp(local);
        const merged = mergeSnapshots(snapshot(), got.remote);
        await adopt(merged, pageStamp(merged) !== before);
      }
      if (got.etag) write(etagKey(user), got.etag);
      else write(etagKey(user), "none");
    }
  } finally {
    busy = false;
    if (again) {
      again = false;
      schedule();
    }
  }
}

function schedule() {
  if (!user) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void push();
  }, 2500);
}

/** Upload the files the account does not have yet. */
async function sendFiles() {
  if (!user) return;
  const sent = new Set<string>(JSON.parse(read(sentKey(user)) ?? "[]"));
  for (const fid of Object.keys(snapshot().fileInfo ?? {})) {
    if (sent.has(fid)) continue;
    const url = fileBlobUrl(fid);
    if (!url) continue;
    const blob = await fetch(url).then((r) => r.blob()).catch(() => null);
    if (!blob) continue;
    const res = await call(`/v1/vault/files/${encodeURIComponent(fid)}`, { method: "PUT", headers: { "content-type": fileMeta(fid)?.mime ?? blob.type }, body: blob });
    if (res?.ok) {
      sent.add(fid);
      write(sentKey(user), JSON.stringify([...sent]));
    }
  }
}

/** Fetch the files the workspace lists but this browser does not hold. */
async function fetchFiles() {
  for (const fid of missingFiles()) {
    const res = await call(`/v1/vault/files/${encodeURIComponent(fid)}`);
    if (res?.ok) adoptFile(fid, await res.blob());
  }
}

/** Signed in: merge this browser with the account, then keep them together. */
async function start(userId: string) {
  user = userId;
  const got = await pull();
  if (!got || user !== userId) return;
  if (got.remote) {
    const local = snapshot();
    const merged = mergeSnapshots(local, got.remote);
    await adopt(merged, pageStamp(merged) !== pageStamp(local));
    await fetchFiles();
  }
  if (got.etag) write(etagKey(userId), got.etag);
  await push();
}

/** Starts keeping the workspace on the account whenever someone is signed in. */
export function startVault(): void {
  if (!SYNC_URL) return;
  onWorkspaceSaved(() => schedule());
  onSessionChange((id) => {
    if (id) void start(id);
    else {
      user = null;
      if (pushTimer) clearTimeout(pushTimer);
    }
  });
  const existing = signedInUser();
  if (existing) void start(existing);
}
