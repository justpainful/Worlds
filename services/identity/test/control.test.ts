import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { api, lastCode, signUp, uniqueEmail, type Session } from "./helpers";

async function boss(): Promise<Session> {
  const s = await signUp("Control Boss");
  env.ADMIN_OWNERS = [env.ADMIN_OWNERS, s.userId].filter(Boolean).join(",");
  const start = await api("POST", "/auth/email/start", { body: { email: s.email } });
  await api("POST", "/admin/stepup/email/verify", { token: s.accessToken, body: { challengeId: start.json.challengeId, code: lastCode(s.email) } });
  return s;
}

const set = (b: Session, key: string, value: unknown) => api("PUT", `/admin/control/settings/${key}`, { token: b.accessToken, body: { value } });

afterEach(async () => {
  await env.DB.prepare("DELETE FROM service_settings").run();
});

async function newAccount(extra: Record<string, unknown> = {}) {
  const email = uniqueEmail("newbie");
  const start = await api("POST", "/auth/email/start", { body: { email } });
  return api("POST", "/auth/email/verify", { body: { challengeId: start.json.challengeId, code: lastCode(email), ...extra } });
}

describe("service controls", () => {
  it("serves the defaults to everyone", async () => {
    const r = await api("GET", "/config?platform=windows&version=1.0.1");
    expect(r.json).toMatchObject({ signups: "open", maintenance: { on: false }, update: { required: false }, publishing: { paused: false }, incident: { on: false } });
  });

  it("goes read-only for maintenance but keeps reading, signing in and the dashboard", async () => {
    const b = await boss();
    const person = await signUp("Reader");
    await set(b, "maintenance", { on: true, readOnly: true, message: { ar: "صيانة", en: "Maintenance" } });
    expect((await api("GET", "/config")).json.maintenance).toMatchObject({ on: true, readOnly: true });
    const write = await api("PATCH", "/me", { token: person.accessToken, body: { displayName: "New" } });
    expect(write.status).toBe(503);
    expect(write.json.error).toBe("read_only");
    expect((await api("GET", "/me", { token: person.accessToken })).status).toBe(200);
    expect((await newAccount()).status).toBe(200);
    expect((await api("GET", "/admin/control", { token: b.accessToken })).status).toBe(200);
  });

  it("closes sign-ups, or opens them by invitation", async () => {
    const b = await boss();
    await set(b, "signups", { mode: "closed" });
    expect((await newAccount()).json.error).toBe("signups_closed");
    await set(b, "signups", { mode: "invite" });
    expect((await newAccount()).json.error).toBe("invite_required");
    const inv = await api("POST", "/admin/control/invites", { token: b.accessToken, body: { maxUses: 1 } });
    expect((await newAccount({ inviteCode: inv.json.code.toLowerCase() })).status).toBe(200);
    expect((await newAccount({ inviteCode: inv.json.code })).json.error).toBe("invite_required");
    expect((await api("POST", "/community/waitlist", { body: { email: uniqueEmail("wait") } })).status).toBe(200);
    const sent = await api("POST", "/admin/control/waitlist/invite", { token: b.accessToken, body: { count: 5 } });
    expect(sent.json.sent).toBeGreaterThan(0);
  });

  it("blocks an email domain from sign-in codes", async () => {
    const b = await boss();
    await api("POST", "/admin/control/blocked", { token: b.accessToken, body: { value: "spam.example", reason: "Bots" } });
    const r = await api("POST", "/auth/email/start", { body: { email: "x@spam.example" } });
    expect(r.json.error).toBe("email_blocked");
    await api("DELETE", "/admin/control/blocked/spam.example", { token: b.accessToken });
    expect((await api("POST", "/auth/email/start", { body: { email: "x@spam.example" } })).status).toBe(200);
  });

  it("asks old versions to update, and targets announcements", async () => {
    const b = await boss();
    await set(b, "minVersion", { windows: { version: "1.0.1", dismissible: false } });
    expect((await api("GET", "/config?platform=windows&version=1.0.0")).json.update).toMatchObject({ required: true, minimum: "1.0.1", dismissible: false });
    expect((await api("GET", "/config?platform=windows&version=1.0.10")).json.update.required).toBe(false);
    expect((await api("GET", "/config?platform=android&version=1.0.0")).json.update.required).toBe(false);
    await api("POST", "/admin/control/announcements", { token: b.accessToken, body: { textAr: "تحديث", textEn: "Update", platforms: ["android"], level: "warning" } });
    expect((await api("GET", "/config?platform=android")).json.announcements[0]).toMatchObject({ text: { en: "Update" }, level: "warning" });
    expect((await api("GET", "/config?platform=windows")).json.announcements.some((a: { text: { en: string } }) => a.text.en === "Update")).toBe(false);
  });

  it("switches features on for testers, a share of people, or everyone", async () => {
    const b = await boss();
    const tester = await signUp("Flag Tester");
    await api("POST", "/me/testers", { token: tester.accessToken, body: {} });
    await api("POST", `/admin/testers/${tester.userId}`, { token: b.accessToken, body: { status: "accepted" } });
    const other = await signUp("Flag Other");
    await api("PUT", "/admin/control/flags/new.drawing", { token: b.accessToken, body: { mode: "testers", description: "New drawing tools" } });
    expect((await api("GET", "/config", { token: tester.accessToken })).json.flags["new.drawing"]).toBe(true);
    expect((await api("GET", "/config", { token: other.accessToken })).json.flags["new.drawing"]).toBe(false);
    await api("PUT", "/admin/control/flags/new.drawing", { token: b.accessToken, body: { mode: "all" } });
    expect((await api("GET", "/config")).json.flags["new.drawing"]).toBe(true);
    await api("PUT", "/admin/control/flags/new.drawing", { token: b.accessToken, body: { mode: "users", users: [other.userId] } });
    expect((await api("GET", "/config", { token: other.accessToken })).json.flags["new.drawing"]).toBe(true);
  });

  it("pauses publishing and shows an incident", async () => {
    const b = await boss();
    const p = await signUp("Paused Publisher");
    await set(b, "publishing", { paused: true });
    expect((await api("PUT", "/me/public-profile", { token: p.accessToken, body: { profile: { displayName: "P" } } })).json.error).toBe("publishing_paused");
    await set(b, "incident", { on: true, title: { ar: "عطل في المزامنة", en: "Sync is down" }, body: { ar: "", en: "" }, startedAt: Date.now(), updates: [] });
    expect((await api("GET", "/config")).json.incident).toMatchObject({ on: true, title: { en: "Sync is down" } });
  });
});
