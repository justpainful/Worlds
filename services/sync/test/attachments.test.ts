import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { BASE, grant, mintToken, uid } from "./client";

async function sha256(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesOf(size: number, seed: number): Uint8Array {
  const out = new Uint8Array(size);
  let x = seed;
  for (let i = 0; i < size; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

async function setup() {
  const ws = uid("ws");
  const doc = uid("doc");
  await grant("ed", ws, doc, "edit");
  await grant("vi", ws, doc, "view");
  const base = `${BASE}/v1/workspaces/${ws}/docs/${doc}/attachments`;
  const as = async (user: string) => ({ authorization: `Bearer ${await mintToken(user)}`, "content-type": "application/json" });
  return { ws, doc, base, as };
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

describe("attachments", () => {
  it("uploads a small file once, then dedupes, and downloads it", async () => {
    const { base, as } = await setup();
    const data = bytesOf(70_000, 1);
    const hash = await sha256(data);
    const body = JSON.stringify({ sha256: hash, size: data.byteLength, mime: "image/png" });

    const plan = await (await SELF.fetch(`${base}/uploads`, { method: "POST", headers: await as("ed"), body })).json<Plan>();
    expect(plan).toMatchObject({ status: "pending", mode: "single" });

    // Wrong bytes are refused by the hash check.
    const bad = await SELF.fetch(plan.url!, { method: "PUT", headers: { "content-type": "image/png" }, body: bytesOf(70_000, 2) });
    expect(bad.status).toBe(422);
    const put = await SELF.fetch(plan.url!, { method: "PUT", headers: { "content-type": "image/png" }, body: data });
    expect(await put.json()).toMatchObject({ status: "complete" });
    // Idempotent: the same PUT again is fine, and a new plan says complete.
    expect((await SELF.fetch(plan.url!, { method: "PUT", body: data })).status).toBe(200);
    expect(await (await SELF.fetch(`${base}/uploads`, { method: "POST", headers: await as("ed"), body })).json()).toMatchObject({ status: "complete" });

    const meta = await (await SELF.fetch(`${base}/${hash}`, { headers: await as("vi") })).json<{ url: string; size: number; mime: string }>();
    expect(meta).toMatchObject({ size: data.byteLength, mime: "image/png" });
    const got = new Uint8Array(await (await SELF.fetch(meta.url)).arrayBuffer());
    expect(await sha256(got)).toBe(hash);
  });

  it("resumes a multipart upload after an interruption, verifies it, and serves ranges", async () => {
    const { base, as } = await setup();
    const data = bytesOf(11 * 1024 * 1024, 7);
    const hash = await sha256(data);
    const body = JSON.stringify({ sha256: hash, size: data.byteLength, mime: "video/mp4" });

    const first = await (await SELF.fetch(`${base}/uploads`, { method: "POST", headers: await as("ed"), body })).json<Plan>();
    expect(first).toMatchObject({ status: "pending", mode: "multipart", partCount: 3, partsDone: [] });
    const slice = (n: number) => data.subarray((n - 1) * first.partSize!, Math.min(data.byteLength, n * first.partSize!));

    // Part 1 goes up, then the connection "drops".
    const p1 = first.parts!.find((p) => p.partNumber === 1)!;
    expect((await SELF.fetch(p1.url, { method: "PUT", body: slice(1) })).status).toBe(200);
    // A part of the wrong size is refused.
    const p2 = first.parts!.find((p) => p.partNumber === 2)!;
    expect((await SELF.fetch(p2.url, { method: "PUT", body: slice(3) })).status).toBe(400);

    // Completing too early reports what is missing.
    const early = await SELF.fetch(`${base}/uploads/${hash}/complete`, { method: "POST", headers: await as("ed") });
    expect(early.status).toBe(409);
    expect(await early.json()).toMatchObject({ missing: [2, 3] });

    // Resume: the plan only lists the missing parts.
    const resumed = await (await SELF.fetch(`${base}/uploads`, { method: "POST", headers: await as("ed"), body })).json<Plan>();
    expect(resumed.partsDone).toEqual([1]);
    expect(resumed.parts!.map((p) => p.partNumber)).toEqual([2, 3]);
    for (const p of resumed.parts!) expect((await SELF.fetch(p.url, { method: "PUT", body: slice(p.partNumber) })).status).toBe(200);
    // Re-sending a part is harmless.
    expect((await SELF.fetch(p1.url, { method: "PUT", body: slice(1) })).status).toBe(200);

    const done = await SELF.fetch(`${base}/uploads/${hash}/complete`, { method: "POST", headers: await as("ed") });
    expect(await done.json()).toMatchObject({ status: "complete" });
    expect(await (await SELF.fetch(`${base}/uploads/${hash}/complete`, { method: "POST", headers: await as("ed") })).json()).toMatchObject({ status: "complete" });

    const meta = await (await SELF.fetch(`${base}/${hash}`, { headers: await as("vi") })).json<{ url: string }>();
    const full = new Uint8Array(await (await SELF.fetch(meta.url)).arrayBuffer());
    expect(full.byteLength).toBe(data.byteLength);
    expect(await sha256(full)).toBe(hash);
    // Resumable download: a byte range.
    const part = await SELF.fetch(meta.url, { headers: { range: "bytes=6000000-6000099" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 6000000-6000099/${data.byteLength}`);
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(data.subarray(6000000, 6000100));
  });

  it("checks access for every grant and every signature", async () => {
    const { ws, base, as } = await setup();
    const data = bytesOf(1000, 3);
    const hash = await sha256(data);
    const body = JSON.stringify({ sha256: hash, size: data.byteLength, mime: "text/plain" });

    expect((await SELF.fetch(`${base}/uploads`, { method: "POST", headers: await as("vi"), body })).status).toBe(403);
    expect((await SELF.fetch(`${base}/uploads`, { method: "POST", headers: await as("stranger"), body })).status).toBe(403);
    expect((await SELF.fetch(`${base}/uploads`, { method: "POST", headers: { "content-type": "application/json" }, body })).status).toBe(401);

    const plan = await (await SELF.fetch(`${base}/uploads`, { method: "POST", headers: await as("ed"), body })).json<Plan>();
    // Tampering with the signed URL (another workspace, another op) fails.
    const other = plan.url!.replace(`/v1/blobs/${ws}/`, "/v1/blobs/otherws/");
    expect((await SELF.fetch(other, { method: "PUT", body: data })).status).toBe(403);
    const asGet = plan.url!.replace("op=put", "op=get");
    expect((await SELF.fetch(asGet)).status).toBe(403);
    expect((await SELF.fetch(plan.url!, { method: "PUT", body: data })).status).toBe(200);

    expect((await SELF.fetch(`${base}/${hash}`, { headers: await as("stranger") })).status).toBe(403);
    const meta = await (await SELF.fetch(`${base}/${hash}`, { headers: await as("vi") })).json<{ url: string }>();
    const expired = meta.url.replace(/exp=\d+/, "exp=1000");
    expect((await SELF.fetch(expired)).status).toBe(403);
  });
});
