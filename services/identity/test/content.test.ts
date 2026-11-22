import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { targetOf } from "../src/lib/content";
import { api, lastCode, mailbox, signUp, uniqueEmail, workspaceWithOwner, type Session } from "./helpers";

async function owner(): Promise<Session> {
  const s = await signUp("Content Boss");
  env.ADMIN_OWNERS = [env.ADMIN_OWNERS, s.userId].filter(Boolean).join(",");
  return s;
}

async function confirm(s: Session) {
  const start = await api("POST", "/auth/email/start", { body: { email: s.email } });
  await api("POST", "/admin/stepup/email/verify", { token: s.accessToken, body: { challengeId: start.json.challengeId, code: lastCode(s.email) } });
}

let n = 0;
async function publisher() {
  const s = await signUp("Publisher");
  const username = `pub${Date.now().toString(36).slice(-5)}${++n}`;
  await api("PATCH", "/me", { token: s.accessToken, body: { username } });
  await api("PUT", "/me/public-profile", { token: s.accessToken, body: { profile: { displayName: "Publisher" } } });
  return { s, username };
}

async function report(link: string) {
  const email = uniqueEmail("reporter");
  const start = await api("POST", "/auth/email/start", { body: { email } });
  const sess = await api("POST", "/support/session", { body: { challengeId: start.json.challengeId, code: lastCode(email) } });
  const r = await api("POST", "/support/requests", {
    headers: { "x-support-session": sess.json.token },
    body: { kind: "report", subject: "Bad profile", body: "This is abuse.", fields: { link, reason: "abuse" } },
  });
  expect(r.status).toBe(201);
}

describe("reported links", () => {
  it("knows what a link points at", () => {
    expect(targetOf("https://profile.enterworlds.space/@Sara")).toEqual({ type: "profile", username: "sara" });
    expect(targetOf("https://profile.enterworlds.space/@sara/notes")).toEqual({ type: "page", username: "sara", slug: "notes" });
    expect(targetOf("https://profile.enterworlds.space/s/abc123xyz")).toEqual({ type: "share", slug: "abc123xyz" });
    expect(targetOf("hello")).toBeNull();
  });
});

describe("public content", () => {
  it("lets the team hide a profile with a reason the owner is told, and show it again", async () => {
    const boss = await owner();
    const { s, username } = await publisher();
    const hide = await api("POST", "/admin/content/hide", { token: boss.accessToken, body: { username, reason: "Impersonation" } });
    expect(hide.status).toBe(200);
    expect((await api("GET", `/profiles/${username}`)).status).toBe(404);
    expect(mailbox.some((m) => m.to === s.email && m.text.includes("Impersonation"))).toBe(true);
    const list = await api("GET", "/admin/content/profiles?state=team", { token: boss.accessToken });
    expect(list.json.find((p: { username: string }) => p.username === username)).toMatchObject({ teamHidden: true, teamReason: "Impersonation" });
    await api("POST", "/admin/content/hide", { token: boss.accessToken, body: { username, hidden: false } });
    expect((await api("GET", `/profiles/${username}`)).status).toBe(200);
  });

  it("hides content by itself after three people report it", async () => {
    const { username } = await publisher();
    const link = `https://profile.enterworlds.space/@${username}`;
    await report(link);
    await report(link);
    expect((await api("GET", `/profiles/${username}`)).status).toBe(200);
    await report(link);
    expect((await api("GET", `/profiles/${username}`)).status).toBe(404);
    const boss = await owner();
    const list = await api("GET", "/admin/content/profiles?state=team", { token: boss.accessToken });
    expect(list.json.find((p: { username: string }) => p.username === username)).toMatchObject({ teamReason: "reports", reports: 3 });
  });

  it("moves a shared workspace to another member, after the second check", async () => {
    const boss = await owner();
    const ws = await workspaceWithOwner("Handover");
    const member = await ws.add("member", "Heir");
    const r = await api("POST", `/admin/content/workspaces/${ws.id}/owner`, { token: boss.accessToken, body: { userId: member.userId, reason: "Owner left" } });
    expect(r.json.error).toBe("step_up_required");
    await confirm(boss);
    expect((await api("POST", `/admin/content/workspaces/${ws.id}/owner`, { token: boss.accessToken, body: { userId: member.userId, reason: "Owner left" } })).status).toBe(200);
    const view = await api("GET", `/workspaces/${ws.id}`, { token: member.accessToken });
    expect(view.json).toMatchObject({ ownerId: member.userId, role: "owner" });
    const list = await api("GET", "/admin/content/workspaces?q=handover", { token: boss.accessToken });
    expect(list.json[0]).toMatchObject({ id: ws.id, members: 2 });
  });

  it("lists suspicious sign-ups and forgets the reviewed ones", async () => {
    const boss = await owner();
    const fake = await signUp("Worlds Official", { email: `x${Date.now().toString(36)}@mailinator.com` });
    const list = await api("GET", "/admin/suspicious", { token: boss.accessToken });
    const hit = list.json.find((u: { id: string }) => u.id === fake.userId);
    expect(hit.reasons).toEqual(expect.arrayContaining(["disposable_email", "impersonation"]));
    await api("POST", `/admin/suspicious/${fake.userId}/review`, { token: boss.accessToken, body: {} });
    const again = await api("GET", "/admin/suspicious", { token: boss.accessToken });
    expect(again.json.some((u: { id: string }) => u.id === fake.userId)).toBe(false);
  });
});
