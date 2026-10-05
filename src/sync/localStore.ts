/**
 * The durable local replica of shared pages. In the app it is SQLite through
 * Tauri commands (src-tauri/src/sync); tests and the browser mock use the
 * in-memory version with the same semantics.
 */
import { invoke } from "@tauri-apps/api/core";
import type { JSONContent } from "@tiptap/core";

export type Origin = "local" | "remote" | "external";

export interface Loaded {
  snapshot: Uint8Array | null;
  updates: Uint8Array[];
  upto: number;
}

export interface Appended {
  updateId: number;
  outboxId: number | null;
  logLen: number;
}

export interface OutboxItem {
  id: number;
  pageId: string;
  channel: number;
  data: Uint8Array;
  attempts: number;
}

export interface CursorInput {
  serverVector?: Uint8Array;
  level?: string;
  synced?: boolean;
  error?: string | null;
}

export interface MirrorCheck {
  mirrorRev: string | null;
  currentRev: string;
  mirrorState: Uint8Array | null;
  current: JSONContent[] | null;
}

export type MirrorOutcome =
  | { status: "written"; rev: string; remapped: [string, string][]; updatedAt: number | null }
  | { status: "conflict"; currentRev: string; current: JSONContent[] };

export interface PageStatus {
  pageId: string;
  pending: number;
  rejected: number;
  syncedAt: number | null;
  level: string | null;
  lastError: string | null;
}

export interface PageMode {
  shared: boolean;
  workspaceId: string | null;
  flagged: boolean;
}

export interface LocalStore {
  pageMode(pageId: string): Promise<PageMode>;
  setShared(pageId: string, shared: boolean): Promise<PageMode>;
  load(pageId: string, channel: number): Promise<Loaded>;
  append(pageId: string, channel: number, data: Uint8Array, origin: Origin, outbox: boolean): Promise<Appended>;
  compact(pageId: string, channel: number, state: Uint8Array, upto: number): Promise<void>;
  purge(pageId: string): Promise<void>;
  outbox(pageId: string | null, limit?: number): Promise<OutboxItem[]>;
  outboxMax(pageId: string, channel: number): Promise<number>;
  ack(ids: number[]): Promise<void>;
  ackUpto(pageId: string, channel: number, upto: number): Promise<void>;
  reject(ids: number[], reason: string): Promise<void>;
  fail(ids: number[], error: string): Promise<void>;
  setCursor(pageId: string, channel: number, c: CursorInput): Promise<void>;
  status(pageId: string): Promise<PageStatus>;
  mirrorCheck(pageId: string): Promise<MirrorCheck>;
  mirrorAdopt(pageId: string, baseRev: string, state: Uint8Array): Promise<MirrorOutcome>;
  mirrorWrite(pageId: string, blocks: { id: string; content: JSONContent }[], baseRev: string, state: Uint8Array): Promise<MirrorOutcome>;
}

// ---------------------------------------------------------------------------
// base64 (Tauri IPC carries Yjs bytes as base64 strings)
// ---------------------------------------------------------------------------

export function toB64(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

export function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// Tauri (SQLite) store
// ---------------------------------------------------------------------------

export class TauriLocalStore implements LocalStore {
  pageMode(pageId: string) {
    return invoke<PageMode>("sync_page_mode", { pageId });
  }
  setShared(pageId: string, shared: boolean) {
    return invoke<PageMode>("sync_set_shared", { pageId, shared });
  }
  async load(pageId: string, channel: number): Promise<Loaded> {
    const r = await invoke<{ snapshot: string | null; updates: string[]; upto: number }>("sync_load", { pageId, channel });
    return { snapshot: r.snapshot ? fromB64(r.snapshot) : null, updates: r.updates.map(fromB64), upto: r.upto };
  }
  append(pageId: string, channel: number, data: Uint8Array, origin: Origin, outbox: boolean) {
    return invoke<Appended>("sync_append", { pageId, channel, data: toB64(data), origin, outbox });
  }
  compact(pageId: string, channel: number, state: Uint8Array, upto: number) {
    return invoke<void>("sync_compact", { pageId, channel, data: toB64(state), upto });
  }
  purge(pageId: string) {
    return invoke<void>("sync_purge", { pageId });
  }
  async outbox(pageId: string | null, limit = 500): Promise<OutboxItem[]> {
    const rows = await invoke<{ id: number; pageId: string; channel: number; data: string; attempts: number }[]>("sync_outbox", { pageId, limit });
    return rows.map((r) => ({ ...r, data: fromB64(r.data) }));
  }
  outboxMax(pageId: string, channel: number) {
    return invoke<number>("sync_outbox_max", { pageId, channel });
  }
  async ack(ids: number[]) {
    if (ids.length) await invoke("sync_outbox_ack", { ids });
  }
  async ackUpto(pageId: string, channel: number, upto: number) {
    await invoke("sync_outbox_ack_upto", { pageId, channel, upto });
  }
  async reject(ids: number[], reason: string) {
    if (ids.length) await invoke("sync_outbox_reject", { ids, reason });
  }
  async fail(ids: number[], error: string) {
    if (ids.length) await invoke("sync_outbox_fail", { ids, error });
  }
  setCursor(pageId: string, channel: number, c: CursorInput) {
    return invoke<void>("sync_cursor_set", {
      pageId,
      channel,
      cursor: { serverVector: c.serverVector ? toB64(c.serverVector) : null, level: c.level ?? null, synced: !!c.synced, error: c.error ?? null },
    });
  }
  status(pageId: string) {
    return invoke<PageStatus>("sync_status", { pageId });
  }
  async mirrorCheck(pageId: string): Promise<MirrorCheck> {
    const r = await invoke<{ mirrorRev: string | null; currentRev: string; mirrorState: string | null; current: JSONContent[] | null }>("sync_mirror_check", { pageId });
    return { ...r, mirrorState: r.mirrorState ? fromB64(r.mirrorState) : null };
  }
  mirrorAdopt(pageId: string, baseRev: string, state: Uint8Array) {
    return invoke<MirrorOutcome>("sync_mirror_adopt", { pageId, baseRev, stateB64: toB64(state) });
  }
  mirrorWrite(pageId: string, blocks: { id: string; content: JSONContent }[], baseRev: string, state: Uint8Array) {
    return invoke<MirrorOutcome>("sync_mirror_write", { pageId, blocks, baseRev, stateB64: toB64(state) });
  }
}

// ---------------------------------------------------------------------------
// In-memory store (tests, browser mock)
// ---------------------------------------------------------------------------

interface MemDoc {
  snapshot: Uint8Array | null;
  mirrorRev: string | null;
  mirrorState: Uint8Array | null;
}

/** Same contract as the SQLite store; also holds the page's block rows. */
export class MemoryLocalStore implements LocalStore {
  private seq = 0;
  docs = new Map<string, MemDoc>();
  updates: { id: number; pageId: string; channel: number; data: Uint8Array; origin: Origin }[] = [];
  outboxRows: { id: number; pageId: string; channel: number; data: Uint8Array; attempts: number; state: "pending" | "rejected"; error?: string }[] = [];
  cursors = new Map<string, CursorInput & { syncedAt?: number }>();
  modes = new Map<string, PageMode>();
  /** Block rows per page (what search, MCP and Claude read). */
  blocks = new Map<string, JSONContent[]>();
  /** Fails every call while set (simulates a broken IPC). */
  broken = false;
  /** Where block rows come from the first time a page is asked about (browser mock). */
  rowsSource: ((pageId: string) => Promise<JSONContent[]>) | null = null;

  private async rows(pageId: string) {
    if (!this.blocks.has(pageId) && this.rowsSource) this.blocks.set(pageId, await this.rowsSource(pageId).catch(() => []));
  }

  private key(pageId: string, channel: number) {
    return `${pageId}#${channel}`;
  }
  private doc(pageId: string, channel: number): MemDoc {
    const k = this.key(pageId, channel);
    let d = this.docs.get(k);
    if (!d) this.docs.set(k, (d = { snapshot: null, mirrorRev: null, mirrorState: null }));
    return d;
  }
  private check() {
    if (this.broken) throw new Error("store unavailable");
  }

  async pageMode(pageId: string) {
    return this.modes.get(pageId) ?? { shared: false, workspaceId: null, flagged: false };
  }
  async setShared(pageId: string, shared: boolean) {
    const m = { shared, workspaceId: null, flagged: shared };
    this.modes.set(pageId, m);
    return m;
  }
  async load(pageId: string, channel: number): Promise<Loaded> {
    this.check();
    const rows = this.updates.filter((u) => u.pageId === pageId && u.channel === channel);
    return { snapshot: this.docs.get(this.key(pageId, channel))?.snapshot ?? null, updates: rows.map((r) => r.data), upto: rows.at(-1)?.id ?? 0 };
  }
  async append(pageId: string, channel: number, data: Uint8Array, origin: Origin, outbox: boolean): Promise<Appended> {
    this.check();
    this.doc(pageId, channel);
    const updateId = ++this.seq;
    this.updates.push({ id: updateId, pageId, channel, data, origin });
    let outboxId: number | null = null;
    if (outbox) {
      outboxId = ++this.seq;
      this.outboxRows.push({ id: outboxId, pageId, channel, data, attempts: 0, state: "pending" });
    }
    return { updateId, outboxId, logLen: this.updates.filter((u) => u.pageId === pageId && u.channel === channel).length };
  }
  async compact(pageId: string, channel: number, state: Uint8Array, upto: number) {
    this.check();
    this.doc(pageId, channel).snapshot = state;
    this.updates = this.updates.filter((u) => !(u.pageId === pageId && u.channel === channel && u.id <= upto));
  }
  async purge(pageId: string) {
    for (const k of [...this.docs.keys()]) if (k.startsWith(`${pageId}#`)) this.docs.delete(k);
    this.updates = this.updates.filter((u) => u.pageId !== pageId);
    this.outboxRows = this.outboxRows.filter((o) => o.pageId !== pageId);
  }
  async outbox(pageId: string | null, limit = 500): Promise<OutboxItem[]> {
    this.check();
    return this.outboxRows
      .filter((o) => o.state === "pending" && (!pageId || o.pageId === pageId))
      .slice(0, limit)
      .map(({ id, pageId: p, channel, data, attempts }) => ({ id, pageId: p, channel, data, attempts }));
  }
  async outboxMax(pageId: string, channel: number) {
    this.check();
    return Math.max(0, ...this.outboxRows.filter((o) => o.pageId === pageId && o.channel === channel && o.state === "pending").map((o) => o.id));
  }
  async ack(ids: number[]) {
    this.outboxRows = this.outboxRows.filter((o) => !ids.includes(o.id));
  }
  async ackUpto(pageId: string, channel: number, upto: number) {
    this.outboxRows = this.outboxRows.filter((o) => !(o.pageId === pageId && o.channel === channel && o.state === "pending" && o.id <= upto));
  }
  async reject(ids: number[], reason: string) {
    for (const o of this.outboxRows) if (ids.includes(o.id)) Object.assign(o, { state: "rejected", error: reason });
  }
  async fail(ids: number[], error: string) {
    for (const o of this.outboxRows) if (ids.includes(o.id)) Object.assign(o, { attempts: o.attempts + 1, error });
  }
  async setCursor(pageId: string, channel: number, c: CursorInput) {
    const k = this.key(pageId, channel);
    const prev = this.cursors.get(k) ?? {};
    this.cursors.set(k, { ...prev, ...Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)), syncedAt: c.synced ? Date.now() : prev.syncedAt });
  }
  async status(pageId: string): Promise<PageStatus> {
    const rows = this.outboxRows.filter((o) => o.pageId === pageId);
    const c = this.cursors.get(this.key(pageId, 0));
    return {
      pageId,
      pending: rows.filter((o) => o.state === "pending").length,
      rejected: rows.filter((o) => o.state === "rejected").length,
      syncedAt: c?.syncedAt ?? null,
      level: c?.level ?? null,
      lastError: c?.error ?? null,
    };
  }
  /** Revision of the block rows, like the Rust store's. */
  rev(pageId: string): string {
    return `${JSON.stringify(this.blocks.get(pageId) ?? []).length}:${hash(JSON.stringify(this.blocks.get(pageId) ?? []))}`;
  }
  async mirrorCheck(pageId: string): Promise<MirrorCheck> {
    await this.rows(pageId);
    const d = this.doc(pageId, 0);
    const currentRev = this.rev(pageId);
    return {
      mirrorRev: d.mirrorRev,
      currentRev,
      mirrorState: d.mirrorState,
      current: d.mirrorRev === currentRev ? null : structuredClone(this.blocks.get(pageId) ?? []),
    };
  }
  async mirrorAdopt(pageId: string, baseRev: string, state: Uint8Array): Promise<MirrorOutcome> {
    const currentRev = this.rev(pageId);
    if (currentRev !== baseRev) return { status: "conflict", currentRev, current: structuredClone(this.blocks.get(pageId) ?? []) };
    Object.assign(this.doc(pageId, 0), { mirrorRev: currentRev, mirrorState: state });
    return { status: "written", rev: currentRev, remapped: [], updatedAt: null };
  }
  async mirrorWrite(pageId: string, blocks: { id: string; content: JSONContent }[], baseRev: string, state: Uint8Array): Promise<MirrorOutcome> {
    this.check();
    const currentRev = this.rev(pageId);
    if (currentRev !== baseRev) return { status: "conflict", currentRev, current: structuredClone(this.blocks.get(pageId) ?? []) };
    this.blocks.set(
      pageId,
      blocks.map((b) => ({ ...b.content, attrs: { ...(b.content.attrs ?? {}), bid: b.id } })),
    );
    const rev = this.rev(pageId);
    Object.assign(this.doc(pageId, 0), { mirrorRev: rev, mirrorState: state });
    return { status: "written", rev, remapped: [], updatedAt: Date.now() };
  }
  /** Simulate Claude or MCP writing block rows directly. */
  externalWrite(pageId: string, blocks: JSONContent[]) {
    this.blocks.set(pageId, structuredClone(blocks));
  }
}

function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}
