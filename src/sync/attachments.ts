/**
 * Attachments of shared pages.
 *
 * Files stay where they are on each computer, under the same attachment id.
 * The content document keeps a small directory, `attachments` (id ->
 * sha256, size, type, name), so another computer knows what to fetch.
 *
 * Upload: every attachment a shared page points at and the directory does
 * not list yet is hashed and sent to the sync service (plan, one signed PUT
 * or resumable parts, complete); the server dedupes by content hash.
 * Download: every listed attachment missing here is fetched by its signed
 * URL, checked against its hash and stored under its original id.
 */
import type { JSONContent } from "@tiptap/core";
import * as Y from "yjs";

export interface AttachmentInfo {
  sha256: string;
  size: number;
  mime: string;
  fileName: string;
}

export interface LocalFile {
  fileName: string;
  mime: string;
  bytes: Uint8Array;
}

export interface AttachmentDeps {
  /** Base URL of the sync service and a bearer token. */
  serverUrl: string;
  getToken: () => Promise<string | null>;
  workspaceId: string;
  docId: string;
  /** The file for a local attachment id, or null when this computer lacks it. */
  readLocal: (id: string) => Promise<LocalFile | null>;
  /** Whether this computer has the attachment (cheaper than reading it). */
  hasLocal?: (id: string) => Promise<boolean>;
  /** Keep a downloaded file under its original id. */
  storeLocal: (id: string, info: AttachmentInfo, bytes: Uint8Array) => Promise<void>;
  /** Progress for the local upload queue (optional). */
  progress?: (id: string, status: "uploading" | "done" | "failed", info?: Partial<AttachmentInfo> & { partsDone?: number[]; error?: string }) => Promise<void>;
  fetcher?: typeof fetch;
}

export const directoryOf = (doc: Y.Doc) => doc.getMap<AttachmentInfo>("attachments");

/** Every attachment id a document's blocks point at. */
export function attachmentIdsIn(blocks: JSONContent[]): string[] {
  const out = new Set<string>();
  const walk = (n: JSONContent) => {
    const a = n.attrs ?? {};
    for (const key of ["attachmentId", "fileId", "posterId"]) {
      const v = a[key];
      if (typeof v === "string" && v) out.add(v);
    }
    const many = a.attachmentIds ?? a.items;
    if (Array.isArray(many)) for (const v of many) if (typeof v === "string") out.add(v);
    for (const c of n.content ?? []) walk(c);
  };
  blocks.forEach(walk);
  return [...out];
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

interface Plan {
  status: "complete" | "pending";
  mode?: "single" | "multipart";
  url?: string;
  partSize?: number;
  partCount?: number;
  partsDone?: number[];
  parts?: { partNumber: number; url: string }[];
}

export class AttachmentSync {
  private running: Promise<void> | null = null;
  private again = false;
  private failed = new Map<string, number>();

  constructor(
    private readonly doc: Y.Doc,
    private readonly d: AttachmentDeps,
  ) {}

  private get fetch() {
    return this.d.fetcher ?? fetch.bind(globalThis);
  }

  private base(path: string) {
    return `${this.d.serverUrl.replace(/\/+$/, "")}/v1/workspaces/${encodeURIComponent(this.d.workspaceId)}/docs/${encodeURIComponent(this.d.docId)}/attachments${path}`;
  }

  private async api(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.d.getToken();
    if (!token) throw new Error("not signed in");
    return this.fetch(this.base(path), { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" } });
  }

  /** Upload what is missing and download what is listed but absent. One run at a time. */
  run(blocks: JSONContent[], canUpload: boolean): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        if (canUpload) await this.uploadMissing(blocks);
        await this.downloadMissing();
      } while (this.again);
    })().finally(() => (this.running = null));
    return this.running;
  }

  async uploadMissing(blocks: JSONContent[]) {
    const dir = directoryOf(this.doc);
    for (const id of attachmentIdsIn(blocks)) {
      if (dir.has(id) || (this.failed.get(id) ?? 0) >= 3) continue;
      const file = await this.d.readLocal(id);
      if (!file) continue; // someone else's attachment: its owner uploads it
      try {
        const info = await this.upload(id, file);
        dir.set(id, info);
        this.failed.delete(id);
        await this.d.progress?.(id, "done", info);
      } catch (e) {
        this.failed.set(id, (this.failed.get(id) ?? 0) + 1);
        await this.d.progress?.(id, "failed", { error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  async upload(id: string, file: LocalFile): Promise<AttachmentInfo> {
    const sha256 = await sha256Hex(file.bytes);
    const info: AttachmentInfo = { sha256, size: file.bytes.byteLength, mime: file.mime || "application/octet-stream", fileName: file.fileName };
    await this.d.progress?.(id, "uploading", { sha256, size: info.size });
    const res = await this.api("/uploads", { method: "POST", body: JSON.stringify({ sha256, size: info.size, mime: info.mime }) });
    if (!res.ok) throw new Error(`upload plan: ${res.status}`);
    const plan = (await res.json()) as Plan;
    if (plan.status === "complete") return info;
    if (plan.mode === "single") {
      const put = await this.fetch(plan.url!, { method: "PUT", headers: { "content-type": info.mime }, body: file.bytes as BodyInit });
      if (!put.ok) throw new Error(`upload: ${put.status}`);
      return info;
    }
    const size = plan.partSize!;
    const done = [...(plan.partsDone ?? [])];
    for (const part of plan.parts ?? []) {
      const slice = file.bytes.subarray((part.partNumber - 1) * size, Math.min(file.bytes.byteLength, part.partNumber * size));
      const put = await this.fetch(part.url, { method: "PUT", body: slice as BodyInit });
      if (!put.ok) throw new Error(`upload part ${part.partNumber}: ${put.status}`);
      done.push(part.partNumber);
      await this.d.progress?.(id, "uploading", { partsDone: done });
    }
    const complete = await this.api(`/uploads/${sha256}/complete`, { method: "POST" });
    if (!complete.ok) throw new Error(`upload complete: ${complete.status}`);
    return info;
  }

  async downloadMissing() {
    for (const [id, info] of directoryOf(this.doc).entries()) {
      if ((this.failed.get(`get:${id}`) ?? 0) >= 3) continue;
      const has = this.d.hasLocal ? this.d.hasLocal(id) : this.d.readLocal(id).then((f) => !!f);
      if (await has.catch(() => false)) continue;
      try {
        const meta = await this.api(`/${info.sha256}`);
        if (!meta.ok) throw new Error(`attachment: ${meta.status}`);
        const { url } = (await meta.json()) as { url: string };
        const got = await this.fetch(url);
        if (!got.ok) throw new Error(`download: ${got.status}`);
        const bytes = new Uint8Array(await got.arrayBuffer());
        if ((await sha256Hex(bytes)) !== info.sha256) throw new Error("downloaded bytes do not match");
        await this.d.storeLocal(id, info, bytes);
        this.failed.delete(`get:${id}`);
      } catch {
        this.failed.set(`get:${id}`, (this.failed.get(`get:${id}`) ?? 0) + 1);
      }
    }
  }
}
