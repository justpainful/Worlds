import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { BASE, mintToken, uid } from "./client";

const as = async (user: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${await mintToken(user)}`, ...extra });
const workspace = (title: string) => JSON.stringify({ v: 1, savedAt: Date.now(), pages: { p1: { id: "p1", title } } });

describe("a web workspace kept on the account", () => {
  it("is empty at first, then saved and read back", async () => {
    const me = uid("u");
    expect((await SELF.fetch(`${BASE}/v1/vault`, { headers: await as(me) })).status).toBe(404);
    const put = await SELF.fetch(`${BASE}/v1/vault`, { method: "PUT", headers: await as(me, { "if-match": "none", "content-type": "application/json" }), body: workspace("Week") });
    expect(put.status).toBe(200);
    const { etag } = (await put.json()) as { etag: string };
    const got = await SELF.fetch(`${BASE}/v1/vault`, { headers: await as(me) });
    expect(got.status).toBe(200);
    expect(got.headers.get("etag")).toBe(etag);
    expect(((await got.json()) as { pages: Record<string, { title: string }> }).pages.p1.title).toBe("Week");
  });

  it("refuses a write based on an older copy, so a second device merges first", async () => {
    const me = uid("u");
    const first = await SELF.fetch(`${BASE}/v1/vault`, { method: "PUT", headers: await as(me, { "if-match": "none" }), body: workspace("A") });
    const { etag } = (await first.json()) as { etag: string };
    const second = await SELF.fetch(`${BASE}/v1/vault`, { method: "PUT", headers: await as(me, { "if-match": etag }), body: workspace("B") });
    expect(second.status).toBe(200);
    // A device still holding the first etag is told the current one.
    const stale = await SELF.fetch(`${BASE}/v1/vault`, { method: "PUT", headers: await as(me, { "if-match": etag }), body: workspace("C") });
    expect(stale.status).toBe(412);
    expect(((await stale.json()) as { etag: string }).etag).toBe(((await second.clone().json()) as { etag: string }).etag);
    // So does one that thinks there is no copy yet.
    expect((await SELF.fetch(`${BASE}/v1/vault`, { method: "PUT", headers: await as(me, { "if-match": "none" }), body: workspace("D") })).status).toBe(412);
    // And a write without If-Match is refused outright.
    expect((await SELF.fetch(`${BASE}/v1/vault`, { method: "PUT", headers: await as(me), body: workspace("E") })).status).toBe(428);
  });

  it("belongs to one person only", async () => {
    const owner = uid("u");
    const other = uid("u");
    await SELF.fetch(`${BASE}/v1/vault`, { method: "PUT", headers: await as(owner, { "if-match": "none" }), body: workspace("Private") });
    const theirs = await SELF.fetch(`${BASE}/v1/vault`, { headers: await as(other) });
    expect(theirs.status).toBe(404);
    expect((await SELF.fetch(`${BASE}/v1/vault`)).status).toBe(401);
  });

  it("keeps attached files and refuses what is not a workspace", async () => {
    const me = uid("u");
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const put = await SELF.fetch(`${BASE}/v1/vault/files/f1`, { method: "PUT", headers: await as(me, { "content-type": "image/png" }), body: bytes });
    expect(put.status).toBe(200);
    const got = await SELF.fetch(`${BASE}/v1/vault/files/f1`, { headers: await as(me) });
    expect(got.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes);
    expect((await SELF.fetch(`${BASE}/v1/vault/files/f1`, { headers: await as(uid("u")) })).status).toBe(404);
    expect((await SELF.fetch(`${BASE}/v1/vault/files/..%2Fx`, { headers: await as(me) })).status).toBe(404);
    const junk = await SELF.fetch(`${BASE}/v1/vault`, { method: "PUT", headers: await as(me, { "if-match": "none" }), body: "{\"pages\":{}}" });
    expect(junk.status).toBe(400);
  });
});
