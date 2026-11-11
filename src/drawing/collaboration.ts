import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { WorldsProvider, type ProviderOptions, type SyncInfo } from "../sync/provider";
import {
  createThread,
  reply,
  setResolved,
  deleteComment,
  listThreads,
  listPeople,
  mentionsIn,
  upsertPerson,
  type ThreadData,
} from "../sync/comments";
import type { SyncUser } from "../sync/config";
import type { AccessLevel } from "../sync/protocol";
import { readDrawingPresence, validDrawingAnchor, type DrawingCommentAnchor, type DrawingPresence } from "./collaborationTypes";
export { drawingCommentAnchor, drawingCommentLocation } from "./commentAnchors";
export interface DrawingPeer {
  clientId: number;
  user: SyncUser;
  presence: DrawingPresence;
}
export interface DrawingLiveState {
  ready: boolean;
  info: SyncInfo | null;
  threads: ThreadData[];
  peers: DrawingPeer[];
  following: number | null;
  error: string | null;
}
type Options = Omit<ProviderOptions, "content" | "comments" | "awareness"> & { user: SyncUser; initialLevel?: AccessLevel };
/** Comments are durable on channel 1. Only awareness carries pointers, cameras
 * and laser trails; no scene mirror or ephemeral outbox is created here. */
export class DrawingLiveSession {
  readonly content = new Y.Doc();
  readonly comments = new Y.Doc();
  readonly awareness = new Awareness(this.content);
  private provider: WorldsProvider;
  private stopped = false;
  private listeners = new Set<() => void>();
  private unsubs: (() => void)[] = [];
  private state: DrawingLiveState = { ready: false, info: null, threads: [], peers: [], following: null, error: null };
  private presence: DrawingPresence | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSent = 0;
  private startPromise: Promise<void> | null = null;
  private level: AccessLevel;
  constructor(private o: Options) {
    this.level = o.initialLevel ?? "none";
    this.provider = new WorldsProvider({
      ...o,
      rejectionOwner: o.user.id,
      content: this.content,
      comments: this.comments,
      awareness: this.awareness,
    });
    const changed = () => this.refresh();
    this.comments.on("update", changed);
    this.awareness.on("change", changed);
    this.unsubs.push(
      () => this.comments.off("update", changed),
      () => this.awareness.off("change", changed),
      this.provider.onChange((info) => {
        if (info.level !== null) this.level = info.level;
        this.set({ info: { ...info, level: this.level } });
        if (this.level === "none") this.clearVisible();
        else if (info.resetting) {
          this.set({ ready: false });
          this.clearVisible();
        } else if (["comment", "edit", "full"].includes(info.level ?? "") && this.state.ready) upsertPerson(this.comments, o.user);
      }),
      this.provider.onRevoked(() => {
        this.level = "none";
        this.set({ error: "Drawing access was removed. Check access before reconnecting." });
        this.clearVisible();
      }),
      this.provider.onReset(() => {
        this.set({ error: "Comments need to reconnect after a refused change", ready: false });
        this.clearVisible();
        this.provider.destroy();
      }),
    );
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  snapshot = () => this.state;
  private set(patch: Partial<DrawingLiveState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }
  start() {
    return (this.startPromise ??= this.provider
      .init()
      .then(() => {
        if (this.stopped) return;
        this.set({ ready: true, info: { ...this.provider.info, level: this.level }, error: null });
        this.awareness.setLocalStateField("user", this.o.user);
        if (this.canComment) upsertPerson(this.comments, this.o.user);
        this.refresh();
      })
      .catch((error: unknown) => {
        if (!this.stopped) {
          this.set({ ready: false, error: error instanceof Error ? error.message : String(error) });
          this.clearVisible();
        }
        throw error;
      }));
  }
  get canComment() {
    return !this.stopped && this.state.ready && !this.state.info?.resetting && ["comment", "edit", "full"].includes(this.level);
  }
  private clearVisible() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.presence = null;
    this.set({ peers: [], threads: [], following: null });
    this.awareness.setLocalState(null);
  }
  private refresh() {
    if (this.stopped || !this.state.ready || this.level === "none") return;
    const peers: DrawingPeer[] = [];
    for (const [clientId, raw] of this.awareness.getStates()) {
      if (clientId === this.awareness.clientID) continue;
      const p = readDrawingPresence(raw.drawing),
        u = raw.user;
      if (!p || !u || typeof u.id !== "string" || typeof u.name !== "string" || !/^#[a-f\d]{6}$/i.test(u.color)) continue;
      peers.push({ clientId, user: { id: u.id, name: u.name.slice(0, 80), color: u.color }, presence: p });
    }
    const following = peers.some((p) => p.clientId === this.state.following && p.presence.following === null) ? this.state.following : null;
    const left = following !== this.state.following;
    this.set({ peers, following, threads: listThreads(this.comments).filter((t) => validDrawingAnchor(t.anchor)) });
    if (left) this.update({ following });
  }
  update(patch: Partial<DrawingPresence>) {
    if (this.stopped || !this.state.ready || this.level === "none") return;
    // The deployed awareness protocol uses six-digit laser colors. Preserve a
    // selected color's alpha in opacity so transparent colors remain compatible
    // with older servers and do not invalidate the whole presence update.
    if (patch.laser && /^#[a-f\d]{8}$/i.test(patch.laser.color)) {
      const color = patch.laser.color,
        alpha = parseInt(color.slice(7, 9), 16) / 255;
      patch = { ...patch, laser: { ...patch.laser, color: color.slice(0, 7), opacity: patch.laser.opacity * alpha } };
    }
    const next = {
      frameId: "",
      tool: "brush",
      selected: [],
      cursor: null,
      camera: { x: 0, y: 0, w: 1280, h: 720 },
      following: this.state.following,
      laser: null,
      ...this.presence,
      ...patch,
    };
    const safe = readDrawingPresence(next);
    if (!safe) return;
    this.presence = safe;
    if (this.timer) return;
    const send = () => {
      this.timer = null;
      if (!this.stopped && this.level !== "none" && this.presence) {
        this.lastSent = Date.now();
        this.awareness.setLocalStateField("drawing", this.presence);
      }
    };
    const delay = Math.max(0, 40 - (Date.now() - this.lastSent));
    if (delay) this.timer = setTimeout(send, delay);
    else send();
  }
  follow(clientId: number | null) {
    const peer = this.state.peers.find((p) => p.clientId === clientId);
    if (clientId !== null && (!peer || peer.presence.following !== null)) return;
    this.set({ following: clientId });
    this.update({ following: clientId });
  }
  thread(anchor: DrawingCommentAnchor, body: string) {
    this.requireComment(body);
    if (!validDrawingAnchor(anchor)) throw new Error("Invalid drawing comment anchor");
    return createThread(this.comments, this.o.user, {
      anchor,
      body: body.trim(),
      quote: "",
      mentions: mentionsIn(body, listPeople(this.comments)),
    });
  }
  reply(id: string, body: string) {
    this.requireComment(body);
    reply(this.comments, this.o.user, id, body.trim(), mentionsIn(body, listPeople(this.comments)));
  }
  resolve(id: string, resolved: boolean) {
    this.requireComment();
    setResolved(this.comments, this.o.user, id, resolved);
  }
  remove(thread: string, comment: string) {
    this.requireComment();
    const c = this.state.threads.find((t) => t.id === thread)?.comments.find((c) => c.id === comment);
    if (c?.author !== this.o.user.id && this.state.info?.level !== "full") throw new Error("Only the author can remove this comment");
    deleteComment(this.comments, thread, comment);
  }
  private requireComment(body?: string) {
    if (!this.canComment) throw new Error("Comment access is required");
    if (body !== undefined && (!body.trim() || body.length > 10000)) throw new Error("Comments must contain 1 to 10000 characters");
  }
  persisted() {
    return this.provider.persisted();
  }
  retryPersistence() {
    return this.provider.retryPersistence();
  }
  reconnect() {
    if (!this.stopped && !this.state.error && !this.state.info?.resetting) this.provider.reconnect();
  }
  async close() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.awareness.setLocalState(null);
    this.provider.pauseNetworking();
    await this.startPromise?.catch(() => {});
    // Keep the CRDT and retry its durable checkpoint if storage failed. Account
    // switching has already stopped all networking and new local input.
    for (;;) {
      try {
        await this.provider.persisted();
        break;
      } catch {
        try {
          await this.provider.retryPersistence();
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }
    this.unsubs.forEach((fn) => fn());
    this.provider.destroy();
    this.awareness.destroy();
    this.content.destroy();
    this.comments.destroy();
    this.listeners.clear();
  }
}
