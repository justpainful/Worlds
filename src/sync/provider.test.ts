import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { FakeSyncServer } from "./fakeServer";
import { MemoryLocalStore } from "./localStore";
import { WorldsProvider, type ProviderOptions } from "./provider";
import { CH_CONTENT } from "./protocol";

const live: WorldsProvider[] = [];
afterEach(() => {
  for (const p of live.splice(0)) p.destroy();
});

async function until(pred: () => boolean | Promise<boolean>, what: string, timeout = 3000) {
  const start = Date.now();
  while (!(await pred())) {
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

interface Net {
  online: boolean;
  watchers: Set<(on: boolean) => void>;
}

function net(): Net {
  return { online: true, watchers: new Set() };
}

function setOnline(n: Net, on: boolean) {
  n.online = on;
  for (const w of n.watchers) w(on);
}

async function provider(
  server: FakeSyncServer,
  userId: string,
  store = new MemoryLocalStore(),
  extra: Partial<ProviderOptions> & { net?: Net } = {},
) {
  const n = extra.net ?? net();
  const p = new WorldsProvider({
    pageId: "page1",
    workspaceId: "team",
    content: new Y.Doc(),
    comments: new Y.Doc(),
    store,
    serverUrl: "https://sync.test",
    getToken: async () => `token-${userId}`,
    createSocket: server.socketFor(userId),
    minBackoffMs: 5,
    maxBackoffMs: 40,
    random: () => 0.5,
    isOnline: () => n.online,
    watchOnline: (fn) => {
      n.watchers.add(fn);
      return () => n.watchers.delete(fn);
    },
    fetcher: (async () => new Response(null, { status: 200 })) as typeof fetch,
    ...extra,
  });
  live.push(p);
  await p.init();
  return { p, store, text: () => p.docs[CH_CONTENT].getText("t"), net: n };
}

const synced = (...ps: WorldsProvider[]) => until(() => ps.every((p) => p.info.state === "synced"), "synced");

describe("WorldsProvider", () => {
  it("keeps offline edits in the outbox and drains it when back online", async () => {
    const server = new FakeSyncServer();
    server.levels.set("ann", "edit");
    const n = net();
    n.online = false;
    const a = await provider(server, "ann", undefined, { net: n });
    expect(a.p.info.state).toBe("offline");
    a.text().insert(0, "written offline");
    a.p.docs[1].getMap("threads").set("x", "comment written offline");
    await a.p.persisted();
    expect((await a.store.outbox("page1")).length).toBe(2);
    expect(server.text()).toBe("");

    setOnline(n, true);
    await synced(a.p);
    expect(server.text()).toBe("written offline");
    expect(server.docs[1].getMap("threads").get("x")).toBe("comment written offline");
    expect(await a.store.outbox("page1")).toEqual([]);
    expect(a.p.info.unacked).toBe(0);
  });

  it("two clients converge after concurrent edits, with nothing left unacknowledged", async () => {
    const server = new FakeSyncServer();
    server.levels.set("ann", "edit");
    server.levels.set("ben", "full");
    const a = await provider(server, "ann");
    const b = await provider(server, "ben");
    await synced(a.p, b.p);
    a.text().insert(0, "Hello ");
    b.text().insert(0, "World ");
    a.text().insert(a.text().length, "from ann.");
    b.text().insert(b.text().length, "from ben.");
    await until(() => a.text().toString() === b.text().toString() && a.text().length === 30, "convergence");
    await synced(a.p, b.p);
    expect(server.text()).toBe(a.text().toString());
    expect(await a.store.outbox(null)).toEqual([]);
    expect(await b.store.outbox(null)).toEqual([]);
  });

  it("reconnects after the connection drops and keeps edits made in between", async () => {
    const server = new FakeSyncServer();
    server.levels.set("ann", "edit");
    server.levels.set("ben", "edit");
    const a = await provider(server, "ann");
    const b = await provider(server, "ben");
    await synced(a.p, b.p);
    server.up = false;
    server.dropAll();
    await until(() => a.p.info.state !== "synced", "noticed the drop");
    a.text().insert(0, "during outage ");
    b.text().insert(0, "ben too ");
    await new Promise((r) => setTimeout(r, 60)); // a few failed attempts with backoff
    expect(server.text()).toBe("");
    server.up = true;
    await synced(a.p, b.p);
    await until(() => a.text().toString() === b.text().toString(), "convergence after outage");
    expect(server.text()).toContain("during outage");
    expect(server.text()).toContain("ben too");
    expect(server.connects).toBeGreaterThan(3);
  });

  it("survives a restart: the outbox and replica reload and reach the server", async () => {
    const server = new FakeSyncServer();
    server.levels.set("ann", "edit");
    const store = new MemoryLocalStore();
    const n = net();
    n.online = false;
    const first = await provider(server, "ann", store, { net: n });
    first.text().insert(0, "typed before quitting");
    await first.p.persisted();
    first.p.destroy();

    const second = await provider(server, "ann", store);
    expect(second.text().toString()).toBe("typed before quitting");
    await synced(second.p);
    expect(server.text()).toBe("typed before quitting");
    expect(await store.outbox(null)).toEqual([]);
  });

  it("does not resend what the server already has, and compacts the local log", async () => {
    const server = new FakeSyncServer();
    server.levels.set("ann", "edit");
    const a = await provider(server, "ann", undefined, { compactAfter: 10 });
    await synced(a.p);
    for (let i = 0; i < 25; i++) a.text().insert(a.text().length, `${i} `);
    await synced(a.p);
    const writes = server.log.length;
    const connects = server.connects;
    a.p.reconnect();
    await until(() => server.connects > connects, "reconnected");
    await synced(a.p);
    expect(server.log.length).toBe(writes);
    const loaded = await a.store.load("page1", CH_CONTENT);
    expect(loaded.snapshot).not.toBeNull();
    expect(loaded.updates.length).toBeLessThan(10);
    const replay = new Y.Doc();
    Y.applyUpdate(replay, Y.mergeUpdates([loaded.snapshot!, ...loaded.updates]));
    expect(replay.getText("t").toString()).toBe(a.text().toString());
  });

  it("keeps refused changes aside and rebuilds the replica from the server", async () => {
    const server = new FakeSyncServer();
    server.levels.set("ann", "edit");
    server.levels.set("vic", "view");
    const a = await provider(server, "ann");
    await synced(a.p);
    a.text().insert(0, "server text");
    await synced(a.p);

    const n = net();
    n.online = false;
    const v = await provider(server, "vic", undefined, { net: n });
    v.text().insert(0, "viewer edit made offline ");
    await v.p.persisted();
    const resets: number[] = [];
    v.p.onReset((ch) => resets.push(ch));
    setOnline(n, true);
    await until(() => resets.length === 1, "reset after refusal");
    expect(resets).toEqual([CH_CONTENT]);
    expect(server.text()).toBe("server text");
    const st = await v.store.status("page1");
    expect(st.rejected).toBe(1);
    expect(st.pending).toBe(0);
    expect(v.p.info.attention).toMatch(/not accepted/);
    // The local replica of that channel was dropped so a rebuild starts clean.
    const l = await v.store.load("page1", CH_CONTENT);
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, Y.mergeUpdates([l.snapshot!, ...l.updates]));
    expect(fresh.getText("t").toString()).toBe("");
    expect(v.p.info.level).toBe("view");
  });

  it("stops on revocation and refreshes the token after a 4401", async () => {
    const server = new FakeSyncServer();
    server.levels.set("ann", "edit");
    const refreshes: boolean[] = [];
    const a = await provider(server, "ann", undefined, {
      getToken: async (refresh) => {
        refreshes.push(!!refresh);
        return refresh ? "fresh-token" : "old-token";
      },
    });
    await synced(a.p);
    for (const c of [...server.conns]) c.socket.drop(4401, "token expired");
    await until(() => server.tokens.includes("fresh-token"), "token refresh");
    await synced(a.p);
    expect(refreshes).toContain(true);

    let revoked = 0;
    a.p.onRevoked(() => revoked++);
    const before = server.connects;
    server.revoke("ann");
    await until(() => revoked === 1, "revoked");
    expect(a.p.info.state).toBe("error");
    await new Promise((r) => setTimeout(r, 60));
    expect(server.connects).toBe(before);
  });

  it("hands the open connection a fresh token before the old one expires", async () => {
    const server = new FakeSyncServer();
    server.levels.set("ann", "edit");
    const jwt = (exp: number) => `h.${btoa(JSON.stringify({ sub: "ann", exp })).replace(/=+$/, "")}.s`;
    let n = 0;
    const a = await provider(server, "ann", undefined, {
      getToken: async () => jwt(Math.floor(Date.now() / 1000) + 61 + n++ * 1000),
    });
    await synced(a.p);
    await until(() => server.refreshed.length === 1, "token refreshed in place", 4000);
    expect(server.connects).toBe(1);
  });

  it("tells a revoked user apart from a network failure after failed upgrades", async () => {
    const server = new FakeSyncServer();
    server.levels.set("ann", "none");
    let revoked = 0;
    const a = await provider(server, "ann", undefined, { fetcher: (async () => new Response(null, { status: 403 })) as typeof fetch });
    a.p.onRevoked(() => revoked++);
    await until(() => revoked === 1, "probe found revocation");
    expect(a.p.info.error).toMatch(/no longer have access/);
  });

  it("relays presence between clients and clears it when one leaves", async () => {
    const server = new FakeSyncServer();
    server.levels.set("ann", "edit");
    server.levels.set("ben", "view");
    const a = await provider(server, "ann");
    const b = await provider(server, "ben");
    await synced(a.p, b.p);
    a.p.awareness.setLocalStateField("user", { id: "ann", name: "Ann", color: "#64a8ff" });
    await until(() => (b.p.awareness.getStates().get(a.p.awareness.clientID) as { user?: { name: string } })?.user?.name === "Ann", "presence");
    a.p.destroy();
    await until(() => !b.p.awareness.getStates().has(a.p.awareness.clientID), "presence cleared");
  });
});
