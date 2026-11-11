import { afterEach, describe, expect, it } from "vitest";
import { FakeSyncServer } from "../sync/fakeServer";
import { MemoryLocalStore } from "../sync/localStore";
import { DrawingLiveSession, drawingCommentAnchor, drawingCommentLocation } from "./collaboration";
import { readDrawingPresence, validDrawingAnchor, type DrawingPresence } from "./collaborationTypes";
import { newDrawing } from "./operations";
import { newNode } from "./model";
const sessions: DrawingLiveSession[] = [];
afterEach(async () => {
  for (const s of sessions.splice(0)) await s.close();
});
async function until(predicate: () => boolean, label: string) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 3000) throw new Error(`Timed out: ${label}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}
async function live(server: FakeSyncServer, id: string, store = new MemoryLocalStore(), online = true) {
  const watchers = new Set<(value: boolean) => void>();
  const session = new DrawingLiveSession({
    pageId: "drawing",
    workspaceId: "team",
    user: { id, name: id, color: "#5599bb" },
    initialLevel: "comment",
    store,
    serverUrl: "https://sync.test",
    getToken: async () => id,
    createSocket: server.socketFor(id),
    isOnline: () => online,
    watchOnline: (fn) => {
      watchers.add(fn);
      return () => {
        watchers.delete(fn);
      };
    },
    minBackoffMs: 5,
    maxBackoffMs: 20,
  });
  sessions.push(session);
  await session.start();
  return {
    session,
    store,
    online: (value: boolean) => {
      online = value;
      for (const fn of watchers) fn(value);
    },
  };
}
const presence = (): DrawingPresence => ({
  frameId: "frame",
  tool: "laser",
  cursor: { x: 10, y: 20 },
  selected: [],
  camera: { x: 0, y: 0, w: 600, h: 400 },
  following: null,
  laser: null,
});
describe("drawing collaboration", () => {
  it("keeps anchors attached through movement, rotation and deletion and refuses malformed presence", () => {
    const scene = newDrawing().scene,
      frame = scene.frames[scene.defaultFrameId],
      node = newNode("shape", scene.layerOrder[0], frame.id);
    node.shape = "rect";
    scene.nodes[node.id] = node;
    scene.nodeOrder.push(node.id);
    const anchor = drawingCommentAnchor(scene, frame.id, node.id);
    expect(validDrawingAnchor(anchor)).toBe(true);
    node.x = 300;
    node.y = 100;
    node.rotation = 90;
    node.flipX = true;
    expect(drawingCommentLocation(scene, anchor).point).toEqual({ x: node.x + node.w / 2, y: node.y + node.h / 2 });
    delete scene.nodes[node.id];
    expect(drawingCommentLocation(scene, anchor).missing).toBe(true);
    frame.x += 100;
    expect(drawingCommentLocation(scene, anchor).point.x).toBe(anchor.fallback.x + 100);
    delete scene.frames[frame.id];
    expect(drawingCommentLocation(scene, anchor).point).toEqual(anchor.fallback);
    expect(validDrawingAnchor({ ...anchor, u: Infinity })).toBe(false);
    expect(readDrawingPresence({ ...presence(), selected: Array(101).fill("node") })).toBeNull();
    expect(readDrawingPresence({ ...presence(), cursor: { x: NaN, y: 0 } })).toBeNull();
  });
  it("relays blue laser/cursor/selection through ephemeral awareness without adding persistent updates, and leaves follow on departure", async () => {
    const server = new FakeSyncServer();
    server.levels.set("alice", "comment");
    server.levels.set("bob", "comment");
    const a = await live(server, "alice"),
      b = await live(server, "bob");
    await until(() => a.session.snapshot().info?.state === "synced" && b.session.snapshot().info?.state === "synced", "connected");
    const writes = server.log.length;
    a.session.update({
      ...presence(),
      selected: ["node"],
      laser: {
        id: "blue",
        color: "#0088ff",
        width: 6,
        opacity: 0.8,
        points: [
          { x: 1, y: 2 },
          { x: 4, y: 5 },
        ],
        released: false,
        lifetime: 1200,
        sequence: 1,
      },
    });
    b.session.update(presence());
    await until(() => b.session.snapshot().peers[0]?.presence.laser?.color === "#0088ff", "blue laser");
    expect(b.session.snapshot().peers[0].presence.selected).toEqual(["node"]);
    expect(server.log.length).toBe(writes);
    a.session.follow(b.session.awareness.clientID);
    await until(() => b.session.snapshot().peers[0]?.presence.following === b.session.awareness.clientID, "follow metadata");
    b.session.follow(a.session.awareness.clientID);
    expect(b.session.snapshot().following).toBeNull();
    await b.session.close();
    await until(() => a.session.snapshot().following === null && a.session.snapshot().peers.length === 0, "departure");
    expect(a.session.content.share.size).toBe(0);
  });
  it("persists offline anchored comments across session restart, replies with mentions, and hides them after revocation", async () => {
    const server = new FakeSyncServer();
    server.levels.set("alice", "comment");
    server.levels.set("bob", "comment");
    const a = await live(server, "alice"),
      b = await live(server, "bob");
    await until(() => a.session.canComment && b.session.canComment, "comment rights");
    const scene = newDrawing().scene,
      anchor = drawingCommentAnchor(scene, scene.defaultFrameId);
    b.online(false);
    const id = b.session.thread(anchor, "تعليق دون اتصال");
    await b.session.persisted();
    expect((await b.store.outbox("drawing")).length).toBeGreaterThan(0);
    await b.session.close();
    const restarted = await live(server, "bob", b.store, false);
    expect(restarted.session.snapshot().threads.some((t) => t.id === id)).toBe(true);
    restarted.online(true);
    await until(() => a.session.snapshot().threads.some((t) => t.id === id), "offline comment upload");
    a.session.reply(id, "رد إلى @bob");
    await until(() => restarted.session.snapshot().threads[0]?.comments.length === 2, "reply");
    expect(restarted.session.snapshot().threads[0].comments[1].mentions).toEqual(["bob"]);
    restarted.session.resolve(id, true);
    await until(() => a.session.snapshot().threads[0]?.resolved === true, "resolve");
    server.revoke("bob");
    await until(() => restarted.session.snapshot().threads.length === 0, "revocation");
    expect(() => restarted.session.reply(id, "غير مسموح")).toThrow("access");
  });
});
