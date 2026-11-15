/**
 * One person's workspace as Worlds on the web saves it (src/dev/mockTauri.ts
 * holds it; persist.ts and vault.ts store it), and the rule that makes one of
 * two copies of it.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface Snapshot {
  v: 1;
  savedAt: number;
  purged?: Record<string, number>;
  pages: Record<string, any>;
  blocks: Record<string, any[]>;
  metadata: Record<string, any>;
  drawings: Record<string, any>;
  drawingLibrary: Record<string, any[]>;
  drawingVersions: Record<string, any[]>;
  exportPolicies: Record<string, any>;
  settings: Record<string, unknown>;
  profile: any;
  chats: any[];
  chatMessages: Record<string, any[]>;
  fileInfo: Record<string, { name: string; mime: string; size: number; kind: string; pageId: string | null; createdAt: number }>;
}

/**
 * Two copies of one person's workspace (this browser and their account, or
 * two devices) become one: each page keeps whichever copy changed it last,
 * with its blocks, fields and drawing; pages deleted for good stay deleted;
 * conversations and files are combined; settings and profile come from the
 * copy saved most recently.
 */
export function mergeSnapshots(a: Snapshot, b: Snapshot): Snapshot {
  const newer = (a.savedAt ?? 0) >= (b.savedAt ?? 0) ? a : b;
  const older = newer === a ? b : a;
  const out = structuredClone(newer) as Snapshot;
  for (const k of ["pages", "blocks", "metadata", "drawings", "drawingLibrary", "drawingVersions", "exportPolicies", "chatMessages", "fileInfo"] as const) (out as any)[k] ??= {};
  out.chats ??= [];
  out.purged = { ...(older.purged ?? {}), ...(newer.purged ?? {}) };
  const stamp = (p: any) => Math.max(p?.updatedAt ?? 0, p?.deletedAt ?? 0);
  for (const [pid, page] of Object.entries(older.pages ?? {})) {
    if (out.purged[pid]) continue;
    const mine = out.pages[pid];
    if (mine && stamp(mine) >= stamp(page)) continue;
    out.pages[pid] = structuredClone(page);
    for (const k of ["blocks", "metadata", "drawings", "drawingVersions", "exportPolicies"] as const) {
      const v = (older as any)[k]?.[pid];
      if (v === undefined) delete (out as any)[k][pid];
      else (out as any)[k][pid] = structuredClone(v);
    }
  }
  for (const pid of Object.keys(out.purged)) for (const k of ["pages", "blocks", "metadata", "drawings", "drawingVersions", "exportPolicies"] as const) delete (out as any)[k][pid];
  for (const [k, v] of Object.entries(older.drawingLibrary ?? {})) out.drawingLibrary[k] ??= structuredClone(v);
  const chatIds = new Set(out.chats.map((c: any) => c.id));
  for (const c of older.chats ?? []) if (!chatIds.has(c.id)) out.chats.push(structuredClone(c));
  for (const [cid, list] of Object.entries(older.chatMessages ?? {})) if ((out.chatMessages[cid]?.length ?? 0) < list.length) out.chatMessages[cid] = structuredClone(list);
  out.fileInfo = { ...(older.fileInfo ?? {}), ...out.fileInfo };
  out.savedAt = Date.now();
  return out;
}

