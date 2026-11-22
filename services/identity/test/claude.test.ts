import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { api, lastCode, signUp } from "./helpers";

describe("dashboard tools for Claude", () => {
  it("reads with a key, proposes changes, and waits for a person", async () => {
    const boss = await signUp("Key Owner");
    env.ADMIN_OWNERS = [env.ADMIN_OWNERS, boss.userId].filter(Boolean).join(",");
    const target = await signUp("Proposed Target");
    const start = await api("POST", "/auth/email/start", { body: { email: boss.email } });
    await api("POST", "/admin/stepup/email/verify", { token: boss.accessToken, body: { challengeId: start.json.challengeId, code: lastCode(boss.email) } });

    const made = await api("POST", "/admin/keys", { token: boss.accessToken, body: { label: "Claude on my PC" } });
    expect(made.status).toBe(201);
    const key = { "x-worlds-admin-key": made.json.key as string };

    expect((await api("GET", "/admin/stats", { headers: key })).status).toBe(200);
    expect((await api("GET", `/admin/users/${target.userId}`, { headers: key })).json.id).toBe(target.userId);
    const direct = await api("POST", `/admin/users/${target.userId}/suspend`, { headers: key, body: { days: 1, reason: "x" } });
    expect(direct.json.error).toBe("propose_only");

    const p = await api("POST", "/admin/proposals", { headers: key, body: { action: "suspend", payload: { userId: target.userId, days: 3, reason: "Spam links" }, summary: "Suspend for spam" } });
    expect(p.status).toBe(201);
    expect((await api("POST", `/admin/proposals/${p.json.id}/decide`, { headers: key, body: { status: "approved" } })).status).toBe(403);

    const list = await api("GET", "/admin/proposals", { token: boss.accessToken });
    const mine = list.json.find((x: { id: string }) => x.id === p.json.id);
    expect(mine.call).toEqual({ method: "POST", path: `/admin/users/${target.userId}/suspend`, body: { days: 3, ban: false, reason: "Spam links" } });
    expect(mine.keyLabel).toBe("Claude on my PC");
    expect((await api("POST", `/admin/proposals/${p.json.id}/decide`, { token: boss.accessToken, body: { status: "rejected", result: "Not spam" } })).status).toBe(200);

    await api("DELETE", `/admin/keys/${made.json.id}`, { token: boss.accessToken });
    expect((await api("GET", "/admin/stats", { headers: key })).status).toBe(401);
  });
});
