import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { api, lastCode, signUp, uniqueEmail } from "./helpers";

describe("numbers", () => {
  it("counts versions, active days, the sign-up funnel, email and usage reports", async () => {
    const boss = await signUp("Numbers Boss");
    env.ADMIN_OWNERS = [env.ADMIN_OWNERS, boss.userId].filter(Boolean).join(",");

    // A sign-in from the app sends its version.
    const email = uniqueEmail("versioned");
    const start = await api("POST", "/auth/email/start", { body: { email } });
    const s = await api("POST", "/auth/email/verify", {
      headers: { "x-worlds-version": "1.1.0" },
      body: { challengeId: start.json.challengeId, code: lastCode(email), device: { name: "PC", platform: "windows" } },
    });
    expect(s.status).toBe(200);
    const report = await api("POST", "/me/usage", {
      token: s.json.accessToken,
      body: { data: { platform: "windows", version: "1.1.0", pages: 40, blocks: 900, features: { drawing: true, ai: false, "bad key": true }, packs: ["study", "../x"], language: "ar", errors: 2 } },
    });
    expect(report.status).toBe(200);

    const r = await api("GET", "/admin/insights", { token: boss.accessToken });
    expect(r.status).toBe(200);
    expect(r.json.versions).toEqual(expect.arrayContaining([expect.objectContaining({ platform: "windows", version: "1.1.0" })]));
    expect(r.json.active.month).toBeGreaterThan(0);
    expect(r.json.active.perDay.at(-1).users).toBeGreaterThan(0);
    expect(r.json.funnel.codes).toBeGreaterThan(0);
    expect(r.json.funnel.accounts).toBeGreaterThan(0);
    expect(r.json.email.perDay.some((e: { kind: string; ok: number }) => e.kind === "code" && e.ok > 0)).toBe(true);
    expect(r.json.usage.features.drawing).toBeGreaterThan(0);
    expect(r.json.usage.features["bad key"]).toBeUndefined();
    expect(r.json.usage.packs.study).toBeGreaterThan(0);
    expect(r.json.usage.packs["../x"]).toBeUndefined();
    expect(r.json.cohorts).toHaveLength(8);

    const cf = await api("GET", "/admin/insights/cloudflare", { token: boss.accessToken });
    expect(cf.json.configured).toBe(false);
  });
});
