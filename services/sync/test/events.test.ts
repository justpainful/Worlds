import { SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { ACK_OK, CLOSE_REVOKED, CLOSE_UNAUTHORIZED, encodeAuthRefresh } from "../src/protocol";
import { BASE, grant, mintToken, TestClient, uid, until } from "./client";

const clients: TestClient[] = [];
afterEach(() => {
  for (const c of clients.splice(0)) c.destroy();
});

async function connected(user: string, ws: string, doc: string, dev?: string) {
  const c = new TestClient(user, ws, doc);
  clients.push(c);
  const res = await c.connect({ token: await mintToken(user, { dev }) });
  expect(res.status).toBe(101);
  await until(() => c.synced[0] && c.synced[1], "synced");
  return c;
}

async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Deliver an identity event the way services/identity does (signed webhook). */
async function deliver(ev: Record<string, unknown>, secret = "test-webhook-secret") {
  const body = JSON.stringify({ id: crypto.randomUUID(), at: Date.now(), ...ev });
  return SELF.fetch(`${BASE}/internal/events`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-worlds-signature": `sha256=${await hmacHex(secret, body)}` },
    body,
  });
}

describe("access change events from the identity service", () => {
  it("refuses unsigned or wrongly signed events", async () => {
    const plain = await SELF.fetch(`${BASE}/internal/events`, { method: "POST", body: JSON.stringify({ id: "x", type: "workspace.deleted", workspaceId: "w" }) });
    expect(plain.status).toBe(403);
    expect((await deliver({ type: "workspace.deleted", workspaceId: "w" }, "wrong-secret")).status).toBe(403);
    expect(await (await deliver({ type: "something.new" })).json()).toMatchObject({ ok: true, ignored: true });
  });

  it("member.removed closes that member's sessions in the workspace", async () => {
    const ws = uid("ws");
    const doc = uid("doc");
    await grant("ann", ws, doc, "edit");
    await grant("ben", ws, doc, "edit");
    const a = await connected("ann", ws, doc);
    const b = await connected("ben", ws, doc);
    await grant("ben", ws, doc, "none");
    expect(await (await deliver({ type: "member.removed", workspaceId: ws, userId: "ben" })).json()).toMatchObject({ ok: true, affected: 1 });
    await until(() => b.closed !== null, "ben closed");
    expect(b.closed!.code).toBe(CLOSE_REVOKED);
    expect(a.closed).toBeNull();
  });

  it("access.changed re-checks at once: downgrades stay connected, removals close", async () => {
    const ws = uid("ws");
    const doc = uid("doc");
    await grant("ann", ws, doc, "edit");
    await grant("cat", ws, doc, "edit");
    const a = await connected("ann", ws, doc);
    const c = await connected("cat", ws, doc);
    await grant("ann", ws, doc, "view");
    await grant("cat", ws, doc, "none");
    await deliver({ type: "access.changed", workspaceId: ws, docIds: [doc], userIds: null });
    await until(() => a.level === "view", "ann downgraded");
    await until(() => c.closed !== null, "cat closed");
    expect(a.closed).toBeNull();
    expect(c.closed!.code).toBe(CLOSE_REVOKED);
  });

  it("device.revoked closes only that device's sessions, in every workspace", async () => {
    const ws1 = uid("ws");
    const ws2 = uid("ws");
    const doc = uid("doc");
    await grant("ann", ws1, null, "edit");
    await grant("ann", ws2, null, "edit");
    const laptop = await connected("ann", ws1, doc, "laptop");
    const laptop2 = await connected("ann", ws2, doc, "laptop");
    const desktop = await connected("ann", ws1, doc, "desktop");
    expect(await (await deliver({ type: "device.revoked", userId: "ann", deviceId: "laptop" })).json()).toMatchObject({ ok: true, affected: 2 });
    await until(() => laptop.closed !== null && laptop2.closed !== null, "laptop sessions closed");
    expect(desktop.closed).toBeNull();
  });

  it("workspace.deleted closes everyone", async () => {
    const ws = uid("ws");
    const doc = uid("doc");
    await grant("ann", ws, null, "full");
    await grant("ben", ws, null, "view");
    const a = await connected("ann", ws, doc);
    const b = await connected("ben", ws, doc);
    await deliver({ type: "workspace.deleted", workspaceId: ws });
    await until(() => a.closed !== null && b.closed !== null, "all closed");
  });
});

describe("token refresh on an open connection", () => {
  it("extends a session with a fresh token and refuses someone else's", async () => {
    const ws = uid("ws");
    const doc = uid("doc");
    await grant("ann", ws, doc, "edit");
    const now = Math.floor(Date.now() / 1000);
    const a = new TestClient("ann", ws, doc);
    clients.push(a);
    await a.connect({ token: await mintToken("ann", { exp: now + 2 }) }); // about to expire
    await until(() => a.synced[0] && a.synced[1], "synced");
    a.ws!.send(encodeAuthRefresh(await mintToken("ann")));
    await new Promise((r) => setTimeout(r, 3500)); // past the first token's expiry
    a.content.getText("t").insert(0, "still here");
    await until(() => [...a.acks.values()].length >= 3, "edit acked");
    expect([...a.acks.values()].every((x) => x.status === ACK_OK)).toBe(true);
    expect(a.closed).toBeNull();

    a.ws!.send(encodeAuthRefresh(await mintToken("mallory", { dev: "ann-device" })));
    await until(() => a.closed !== null, "closed after a foreign token");
    expect(a.closed!.code).toBe(CLOSE_UNAUTHORIZED);
  });
});
