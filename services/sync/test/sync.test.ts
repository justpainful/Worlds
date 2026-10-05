import { env, evictDurableObject, runInDurableObject, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { DocRoom } from "../src/doc";
import { ACK_DENIED, ACK_OK, CLOSE_REVOKED, CLOSE_UNAUTHORIZED } from "../src/protocol";
import { BASE, grant, identityDown, mintToken, TestClient, uid, until } from "./client";

const clients: TestClient[] = [];
function client(userId: string, ws: string, doc: string) {
  const c = new TestClient(userId, ws, doc);
  clients.push(c);
  return c;
}
afterEach(() => {
  for (const c of clients.splice(0)) c.destroy();
});

async function setup(levels: Record<string, Parameters<typeof grant>[3]>) {
  const ws = uid("ws");
  const doc = uid("doc");
  for (const [user, level] of Object.entries(levels)) await grant(user, ws, doc, level);
  return { ws, doc };
}

const synced = (...cs: TestClient[]) => until(() => cs.every((c) => c.synced[0] && c.synced[1]), "initial sync");
const allAcked = (c: TestClient) => until(() => c.acks.size > 0 && [...c.acks.values()].every((a) => a.status === ACK_OK), "acks");

describe("auth", () => {
  it("rejects a missing, forged or expired token", async () => {
    const { ws, doc } = await setup({ alice: "edit" });
    const url = `${BASE}/v1/workspaces/${ws}/docs/${doc}/sync`;
    expect((await SELF.fetch(url, { headers: { upgrade: "websocket" } })).status).toBe(401);
    const good = await mintToken("alice");
    const forged = good.slice(0, good.lastIndexOf(".") + 1) + "AAAA" + good.slice(good.lastIndexOf(".") + 5);
    expect((await SELF.fetch(url, { headers: { upgrade: "websocket", authorization: `Bearer ${forged}` } })).status).toBe(401);
    const expired = await mintToken("alice", { exp: Math.floor(Date.now() / 1000) - 3600, iat: Math.floor(Date.now() / 1000) - 7200 });
    expect((await SELF.fetch(url, { headers: { upgrade: "websocket", authorization: `Bearer ${expired}` } })).status).toBe(401);
    const unknownKey = await mintToken("alice", { kid: "someone-else" });
    expect((await SELF.fetch(url, { headers: { upgrade: "websocket", authorization: `Bearer ${unknownKey}` } })).status).toBe(401);
  });

  it("rejects users without access and accepts the subprotocol token", async () => {
    const { ws, doc } = await setup({ alice: "view" });
    const mallory = client("mallory", ws, doc);
    expect((await mallory.connect()).status).toBe(403);
    const alice = client("alice", ws, doc);
    const res = await alice.connect({ viaSubprotocol: true });
    expect(res.status).toBe(101);
    expect(res.headers.get("sec-websocket-protocol")).toBe("worlds-sync.v1");
    await until(() => alice.level === "view", "auth state");
  });

  it("answers 503 when the identity service is down", async () => {
    const { ws, doc } = await setup({ alice: "edit" });
    await identityDown(true);
    try {
      expect((await client("alice", ws, doc).connect()).status).toBe(503);
    } finally {
      await identityDown(false);
    }
  });
});

describe("live sync", () => {
  it("two clients converge after concurrent edits", async () => {
    const { ws, doc } = await setup({ alice: "edit", bob: "full" });
    const a = client("alice", ws, doc);
    const b = client("bob", ws, doc);
    await a.connect();
    await b.connect();
    await synced(a, b);
    a.content.getText("t").insert(0, "Hello");
    b.content.getText("t").insert(0, "World");
    await until(() => a.text() === b.text() && a.text().length === 10, "convergence");
    // Concurrent edits on both sides at once.
    a.content.getText("t").insert(5, " A ");
    b.content.getText("t").delete(0, 1);
    b.content.getText("t").insert(0, "w");
    await until(() => a.text() === b.text() && a.text().includes(" A "), "convergence after concurrent edits");
    expect(Y.encodeStateVector(a.content)).toEqual(Y.encodeStateVector(b.content));
    await allAcked(a);
    await allAcked(b);
  });

  it("an offline client with queued updates reconnects and converges with no loss", async () => {
    const { ws, doc } = await setup({ alice: "edit", bob: "edit" });
    const a = client("alice", ws, doc);
    const b = client("bob", ws, doc);
    await a.connect();
    await b.connect();
    await synced(a, b);
    a.content.getText("t").insert(0, "base.");
    await until(() => b.text() === "base.", "base text");

    b.disconnect();
    for (let i = 0; i < 20; i++) b.content.getText("t").insert(b.text().length, ` b${i}`);
    b.content.getMap("m").set("offline", true);
    expect(b.outbox.length).toBeGreaterThan(0);
    for (let i = 0; i < 5; i++) a.content.getText("t").insert(0, `a${i} `);

    await b.connect();
    await until(() => a.text() === b.text(), "convergence after reconnect");
    for (let i = 0; i < 20; i++) expect(a.text()).toContain(` b${i}`);
    for (let i = 0; i < 5; i++) expect(a.text()).toContain(`a${i} `);
    expect(a.content.getMap("m").get("offline")).toBe(true);
    expect(b.outbox.length).toBe(0);

    // A third client that was never online catches up from storage alone.
    const c = client("alice", ws, doc);
    await c.connect();
    await until(() => c.text() === a.text(), "late joiner catch-up");
  });

  it("state survives eviction (hibernation) and reconnects catch up", async () => {
    const { ws, doc } = await setup({ alice: "edit" });
    const a = client("alice", ws, doc);
    await a.connect();
    await synced(a);
    a.content.getText("t").insert(0, "persist me");
    await until(() => a.acks.size >= 3, "edit ack"); // two handshake acks (one per channel) and the edit
    a.disconnect();
    const stub = env.DOCS.getByName(`${ws}/${doc}`);
    await evictDurableObject(stub, { webSockets: "close" });
    const b = client("alice", ws, doc);
    await b.connect();
    await until(() => b.text() === "persist me", "restored state");
  });
});

describe("permissions", () => {
  it("a viewer receives but cannot write", async () => {
    const { ws, doc } = await setup({ alice: "edit", victor: "view" });
    const a = client("alice", ws, doc);
    const v = client("victor", ws, doc);
    await a.connect();
    await v.connect();
    await synced(a, v);
    await until(() => v.level === "view", "view level");
    a.content.getText("t").insert(0, "from alice");
    await until(() => v.text() === "from alice", "viewer receives");

    const ack = v.send(0, (() => {
      const scratch = new Y.Doc();
      Y.applyUpdate(scratch, Y.encodeStateAsUpdate(v.content));
      scratch.getText("t").insert(0, "HACK ");
      return Y.encodeStateAsUpdate(scratch, Y.encodeStateVector(v.content));
    })());
    await until(() => v.acks.has(ack), "viewer ack");
    expect(v.acks.get(ack)!.status).toBe(ACK_DENIED);
    // Comments are refused too.
    v.comments.getMap("threads").set("t1", new Y.Map([["id", "t1"], ["createdBy", "victor"], ["createdAt", 1]]));
    await until(() => v.acks.size >= 2 || v.notices.length > 0, "comment refusal");
    await new Promise((r) => setTimeout(r, 100));
    expect(a.text()).toBe("from alice");
    expect(a.comments.getMap("threads").size).toBe(0);
    const state = await (await SELF.fetch(`${BASE}/v1/workspaces/${ws}/docs/${doc}/state`, { headers: { authorization: `Bearer ${await mintToken("alice")}` } })).arrayBuffer();
    const server = new Y.Doc();
    Y.applyUpdate(server, new Uint8Array(state));
    expect(server.getText("t").toString()).toBe("from alice");
  });

  it("a commenter can only comment, and only as themselves", async () => {
    const { ws, doc } = await setup({ alice: "edit", carol: "comment" });
    const a = client("alice", ws, doc);
    const c = client("carol", ws, doc);
    await a.connect();
    await c.connect();
    await synced(a, c);
    await until(() => c.level === "comment", "comment level");

    c.content.getText("t").insert(0, "nope");
    await until(() => [...c.acks.values()].some((x) => x.status === ACK_DENIED), "content refusal");

    const thread = new Y.Map<unknown>();
    const list = new Y.Array<Y.Map<unknown>>();
    const comment = new Y.Map<unknown>([["id", "c1"], ["author", "carol"], ["body", "Looks good @alice"], ["mentions", ["alice"]], ["createdAt", Date.now()]]);
    list.push([comment]);
    thread.set("id", "th1");
    thread.set("createdBy", "carol");
    thread.set("createdAt", Date.now());
    thread.set("comments", list);
    c.comments.getMap("threads").set("th1", thread);
    await until(() => a.comments.getMap("threads").has("th1"), "comment arrives");
    expect(a.text()).toBe("");

    // Impersonation is refused.
    const fake = new Y.Map<unknown>([["id", "c2"], ["author", "alice"], ["body", "I agree"], ["createdAt", Date.now()]]);
    const before = c.acks.size;
    ((c.comments.getMap("threads").get("th1") as Y.Map<unknown>).get("comments") as Y.Array<Y.Map<unknown>>).push([fake]);
    await until(() => c.acks.size > before, "impersonation ack");
    expect([...c.acks.values()].at(-1)!.status).toBe(ACK_DENIED);

    // Resolve and reopen are allowed for anyone who can comment.
    const th = a.comments.getMap("threads").get("th1") as Y.Map<unknown>;
    th.set("resolved", true);
    th.set("resolvedBy", "alice");
    await until(() => (c.comments.getMap("threads").get("th1") as Y.Map<unknown>).get("resolved") === true, "resolve arrives");
    // A refused update leaves the sender's replica ahead of the server, so a
    // client resets from the server after a refusal (the desktop provider does
    // this automatically). Here: a fresh replica for carol.
    c.disconnect();
    const c2 = client("carol", ws, doc);
    await c2.connect();
    await synced(c2);
    await until(() => (c2.comments.getMap("threads").get("th1") as Y.Map<unknown>)?.get("resolved") === true, "fresh replica");
    const cth = c2.comments.getMap("threads").get("th1") as Y.Map<unknown>;
    cth.set("resolved", false);
    cth.set("resolvedBy", null);
    await until(() => th.get("resolved") === false, "reopen arrives");

    // Mentions reach the notifications feed.
    const token = await mintToken("alice");
    let feed: { items: { kind: string; from: string; threadId: string }[]; unread: number } = { items: [], unread: 0 };
    const start = Date.now();
    while (Date.now() - start < 5000 && feed.items.length === 0) {
      feed = await (await SELF.fetch(`${BASE}/v1/notifications`, { headers: { authorization: `Bearer ${token}` } })).json();
      if (!feed.items.length) await new Promise((r) => setTimeout(r, 20));
    }
    expect(feed.items[0]).toMatchObject({ kind: "mention", from: "carol", threadId: "th1" });
    expect(feed.unread).toBe(1);
    await SELF.fetch(`${BASE}/v1/notifications/read`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ ids: null }) });
    feed = await (await SELF.fetch(`${BASE}/v1/notifications`, { headers: { authorization: `Bearer ${token}` } })).json();
    expect(feed.unread).toBe(0);
  });

  it("revocation disconnects live sessions immediately", async () => {
    const { ws, doc } = await setup({ alice: "edit", bob: "edit" });
    const a = client("alice", ws, doc);
    const b = client("bob", ws, doc);
    await a.connect();
    await b.connect();
    await synced(a, b);

    const deny = await SELF.fetch(`${BASE}/internal/revoke`, { method: "POST", headers: { authorization: "Bearer wrong" }, body: JSON.stringify({ userId: "bob", workspaceId: ws }) });
    expect(deny.status).toBe(403);

    expect(await env.HUBS.getByName(ws).liveDocs()).toEqual([doc]);
    expect((await env.DOCS.getByName(`${ws}/${doc}`).sessions()).map((x) => x.userId).sort()).toEqual(["alice", "bob"]);
    await grant("bob", ws, doc, "none");
    const res = await SELF.fetch(`${BASE}/internal/revoke`, {
      method: "POST",
      headers: { authorization: "Bearer test-internal-secret" },
      body: JSON.stringify({ userId: "bob", workspaceId: ws }),
    });
    expect(await res.json()).toMatchObject({ ok: true, affected: 1 });
    await until(() => b.closed !== null, "bob disconnected");
    expect(b.closed!.code).toBe(CLOSE_REVOKED);
    expect(a.closed).toBeNull();
    expect((await b.connect()).status).toBe(403);
  });

  it("a downgrade takes effect on the next message without a revoke call", async () => {
    const { ws, doc } = await setup({ alice: "edit" });
    const a = client("alice", ws, doc);
    await a.connect();
    await synced(a);
    a.content.getText("t").insert(0, "ok");
    await allAcked(a);
    await grant("alice", ws, doc, "view");
    a.content.getText("t").insert(0, "late ");
    await until(() => [...a.acks.values()].some((x) => x.status === ACK_DENIED), "denied after downgrade");
    await until(() => a.level === "view", "level pushed");
    await grant("alice", ws, doc, "none");
    a.content.getText("t").insert(0, "x");
    await until(() => a.closed !== null, "closed after removal");
    expect(a.closed!.code).toBe(CLOSE_REVOKED);
  });

  it("closes sockets whose token expired", async () => {
    const { ws, doc } = await setup({ alice: "edit" });
    const a = client("alice", ws, doc);
    const now = Math.floor(Date.now() / 1000);
    // Inside the 30 s verification leeway, so the upgrade succeeds; the
    // first message after expiry closes the socket.
    expect((await a.connect({ token: await mintToken("alice", { exp: now - 10 }) })).status).toBe(101);
    await until(() => a.closed !== null, "closed");
    expect(a.closed!.code).toBe(CLOSE_UNAUTHORIZED);
  });
});

describe("presence", () => {
  it("awareness propagates, carries the real user id, and clears on leave", async () => {
    const { ws, doc } = await setup({ alice: "edit", bob: "view" });
    const a = client("alice", ws, doc);
    const b = client("bob", ws, doc);
    a.awareness.setLocalState({ user: { id: "someone-else", name: "Alice", color: "#64a8ff" }, cursor: null });
    await a.connect();
    await b.connect();
    await synced(a, b);
    await until(() => b.awareness.getStates().has(a.content.clientID), "presence arrives");
    const seen = b.awareness.getStates().get(a.content.clientID) as { user: { id: string; name: string } };
    expect(seen.user).toEqual({ id: "alice", name: "Alice", color: "#64a8ff" });

    a.awareness.setLocalStateField("cursor", { anchor: 1, head: 2 });
    await until(() => (b.awareness.getStates().get(a.content.clientID) as { cursor: unknown })?.cursor !== null, "cursor update");

    a.disconnect();
    await until(() => !b.awareness.getStates().has(a.content.clientID), "presence cleared");
  });
});

describe("storage", () => {
  it("snapshot compaction keeps the full state", async () => {
    const { ws, doc } = await setup({ alice: "edit" });
    const a = client("alice", ws, doc);
    await a.connect();
    await synced(a);
    for (let i = 0; i < 23; i++) a.content.getText("t").insert(a.text().length, `${i},`);
    await until(() => a.acks.size >= 23, "acks");
    const stub = env.DOCS.getByName(`${ws}/${doc}`);
    const stats = await stub.storageStats();
    expect(stats.snapshots).toBeGreaterThan(0);
    expect(stats.updates).toBeLessThan(5);
    a.disconnect();
    await evictDurableObject(stub, { webSockets: "close" });
    const b = client("alice", ws, doc);
    await b.connect();
    await until(() => b.text() === a.text(), "state after compaction and eviction");
    await runInDurableObject(stub, async (_room: DocRoom, state) => {
      const rows = state.storage.sql.exec("SELECT COUNT(*) AS n FROM updates").one();
      expect(Number(rows.n)).toBeLessThan(5);
    });
  });

  it("versions are attributed to their authors and restorable", async () => {
    const { ws, doc } = await setup({ alice: "edit", bob: "edit", victor: "view" });
    const a = client("alice", ws, doc);
    const b = client("bob", ws, doc);
    await a.connect();
    await b.connect();
    await synced(a, b);
    a.content.getText("t").insert(0, "alice wrote this. ");
    await until(() => b.text() === "alice wrote this. ", "alice text at bob");
    b.content.getText("t").insert(b.text().length, "bob too.");
    await until(() => a.text().includes("bob too."), "merge");
    await allAcked(b);

    const headers = { authorization: `Bearer ${await mintToken("alice")}` };
    const viewer = { authorization: `Bearer ${await mintToken("victor")}` };
    const url = `${BASE}/v1/workspaces/${ws}/docs/${doc}/versions`;
    expect((await SELF.fetch(url, { method: "POST", headers: viewer, body: "{}" })).status).toBe(403);
    const created = await (await SELF.fetch(url, { method: "POST", headers, body: JSON.stringify({ label: "Draft one" }) })).json<{ id: string; authors: string[] }>();
    expect(created.authors.sort()).toEqual(["alice", "bob"]);

    a.content.getText("t").insert(0, "later. ");
    await until(() => b.text().startsWith("later. "), "later edit");
    a.disconnect();
    b.disconnect();

    const list = await (await SELF.fetch(url, { headers: viewer })).json<{ versions: { id: string; label: string | null; authors: string[] }[] }>();
    const draft = list.versions.find((v) => v.id === created.id)!;
    expect(draft.label).toBe("Draft one");
    const bin = await (await SELF.fetch(`${url}/${created.id}`, { headers: viewer })).arrayBuffer();
    const old = new Y.Doc();
    Y.applyUpdate(old, new Uint8Array(bin));
    expect(old.getText("t").toString()).toBe("alice wrote this. bob too.");
  });
});
