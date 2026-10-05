import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hmacSha256Hex } from "../src/lib/crypto";
import { deliver, eventStmt, retryOutbox } from "../src/lib/events";

afterEach(() => vi.restoreAllMocks());

async function record(workspaceId: string) {
  const ev = eventStmt(env.DB, { type: "member.removed", workspaceId, userId: "u-1" });
  await ev.stmt.run();
  return ev.envelope;
}

describe("access change delivery", () => {
  it("sends to the queue and to the signed webhook, then marks delivered", async () => {
    const sent: unknown[] = [];
    const queue = { send: async (m: unknown) => void sent.push(m), sendBatch: async () => {} } as unknown as Queue;
    const posted: { body: string; sig: string | null }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      posted.push({ body: String(init?.body), sig: new Headers(init?.headers).get("x-worlds-signature") });
      return new Response("ok");
    });
    const ev = await record("ws-deliver");
    await deliver({ ...env, REVOCATIONS: queue, SYNC_WEBHOOK_URL: "https://sync.example.com/hooks/identity", SYNC_WEBHOOK_SECRET: "s3cret" }, [ev]);
    expect(sent).toEqual([ev]);
    expect(posted).toHaveLength(1);
    expect(posted[0].sig).toBe(`sha256=${await hmacSha256Hex("s3cret", posted[0].body)}`);
    const row = await env.DB.prepare("SELECT delivered_at, attempts FROM outbox WHERE id = ?1").bind(ev.id).first<{ delivered_at: number | null; attempts: number }>();
    expect(row!.delivered_at).toBeTruthy();
  });

  it("keeps failed deliveries for the cron to retry", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("down", { status: 503 }));
    const ev = await record("ws-retry");
    const hooked = { ...env, SYNC_WEBHOOK_URL: "https://sync.example.com/hooks/identity" };
    await deliver(hooked, [ev]);
    let row = await env.DB.prepare("SELECT delivered_at, attempts, last_error FROM outbox WHERE id = ?1").bind(ev.id).first<{ delivered_at: number | null; attempts: number; last_error: string }>();
    expect(row!.delivered_at).toBeNull();
    expect(row!.last_error).toContain("503");
    fetchSpy.mockResolvedValue(new Response("ok"));
    await retryOutbox(hooked);
    row = await env.DB.prepare("SELECT delivered_at, attempts, last_error FROM outbox WHERE id = ?1").bind(ev.id).first();
    expect(row!.delivered_at).toBeTruthy();
    expect(row!.attempts).toBe(2);
  });
});
