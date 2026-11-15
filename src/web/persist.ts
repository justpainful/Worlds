/**
 * Worlds on the web keeps its data in the browser (IndexedDB), like the apps
 * keep theirs in worlds.db: the whole workspace as one snapshot, and each
 * attached file as its own blob. Nothing here talks to a server; a signed-in
 * person's copy on their account is handled by vault.ts on top of this.
 */

const DB = "worlds-web";
const VERSION = 1;
const STATE = "state";
const FILES = "files";
const KEY = "workspace";

let opened: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STATE)) d.createObjectStore(STATE);
      if (!d.objectStoreNames.contains(FILES)) d.createObjectStore(FILES);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opened;
}

function run<T>(store: string, mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(store, mode);
        const req = work(tx.objectStore(store));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

/** The saved workspace, or null on a first visit (or when the browser keeps nothing). */
export async function loadSnapshot<T>(): Promise<T | null> {
  try {
    return ((await run(STATE, "readonly", (s) => s.get(KEY))) as T | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function saveSnapshot(value: unknown): Promise<void> {
  await run(STATE, "readwrite", (s) => s.put(value, KEY));
}

export async function saveFile(id: string, blob: Blob): Promise<void> {
  await run(FILES, "readwrite", (s) => s.put(blob, id));
}

/** Every saved file, so the pages can show them again after a reload. */
export async function loadFiles(): Promise<Map<string, Blob>> {
  const out = new Map<string, Blob>();
  try {
    const d = await db();
    await new Promise<void>((resolve, reject) => {
      const req = d.transaction(FILES, "readonly").objectStore(FILES).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve();
        out.set(String(cursor.key), cursor.value as Blob);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    // A private window may refuse storage: the session still works, it just does not stay.
  }
  return out;
}

/** Ask the browser not to clear this site's data when space runs low. */
export function askToKeep(): void {
  try {
    void navigator.storage?.persist?.();
  } catch {
    // not supported
  }
}

/** Everything gone: signing out of a shared computer, or starting over. */
export async function clearAll(): Promise<void> {
  await run(STATE, "readwrite", (s) => s.clear());
  await run(FILES, "readwrite", (s) => s.clear());
}
