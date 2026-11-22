import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { deletionHousekeeping } from "../src/domain/deletion";
import { api, lastCode, mailbox, outbox, signUp, workspaceWithOwner, type Session } from "./helpers";

async function confirmCode(s: Session) {
  const start = await api("POST", "/auth/email/start", { body: { email: s.email } });
  return { challengeId: start.json.challengeId, code: lastCode(s.email) };
}

async function signInAgain(s: Session) {
  const start = await api("POST", "/auth/email/start", { body: { email: s.email } });
  return api("POST", "/auth/email/verify", { body: { challengeId: start.json.challengeId, code: lastCode(s.email), device: { name: "Back" } } });
}

let n = 0;
async function withProfile(name: string) {
  const s = await signUp(name);
  const username = `del${Date.now().toString(36).slice(-5)}${++n}`;
  await api("PATCH", "/me", { token: s.accessToken, body: { username } });
  await api("PUT", "/me/public-profile", { token: s.accessToken, body: { profile: { displayName: name } } });
  return { s, username };
}

describe("deleting an account", () => {
  it("schedules 30 days, hides everything, and can be cancelled by signing in", async () => {
    const { s, username } = await withProfile("Leaving");
    expect((await api("GET", `/profiles/${username}`)).status).toBe(200);
    const noProof = await api("POST", "/me/deletion", { token: s.accessToken, body: {} });
    expect(noProof.status).toBe(400);

    const r = await api("POST", "/me/deletion", { token: s.accessToken, body: { ...(await confirmCode(s)), lang: "en" } });
    expect(r.status).toBe(200);
    expect(r.json.dueAt).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect(mailbox.some((m) => m.to === s.email && /scheduled for deletion/.test(m.subject))).toBe(true);
    expect((await api("GET", "/me", { token: s.accessToken })).status).toBe(401);
    expect((await api("GET", `/profiles/${username}`)).status).toBe(404);

    const back = await signInAgain(s);
    expect(back.status).toBe(200);
    expect(back.json.user.deletionDueAt).toBe(r.json.dueAt);
    expect((await api("DELETE", "/me/deletion", { token: back.json.accessToken })).status).toBe(200);
    expect((await api("GET", `/profiles/${username}`)).status).toBe(200);
    expect((await api("GET", "/me", { token: back.json.accessToken })).json.deletionDueAt).toBeNull();
  });

  it("asks an owner to hand over shared workspaces first", async () => {
    const ws = await workspaceWithOwner("Shared");
    await ws.add("member");
    const r = await api("POST", "/me/deletion", { token: ws.owner.accessToken, body: await confirmCode(ws.owner) });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("owns_shared_workspaces");
    expect(r.json.workspaces[0].id).toBe(ws.id);
  });

  it("erases the account when the 30 days are up, keeping support requests without a name", async () => {
    const { s } = await withProfile("Gone");
    const support = await api("POST", "/support/requests", { token: s.accessToken, body: { kind: "deletion", subject: "Delete me", body: "Please." } });
    await api("POST", "/me/deletion", { token: s.accessToken, body: await confirmCode(s) });
    await env.DB.prepare("UPDATE users SET deletion_due_at = ?1 WHERE id = ?2").bind(Date.now() - 1000, s.userId).run();
    const events = await deletionHousekeeping(env);
    expect(events.some((e) => e.type === "user.erased" && (e as { userId: string }).userId === s.userId)).toBe(true);
    expect(await env.DB.prepare("SELECT 1 FROM users WHERE id = ?1").bind(s.userId).first()).toBeNull();
    const t = await env.DB.prepare("SELECT user_id, email FROM support_tickets WHERE number = ?1").bind(support.json.number).first<{ user_id: string | null; email: string }>();
    expect(t!.user_id).toBeNull();
    expect(t!.email).not.toContain(s.email);
    const log = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE actor_user_id = ?1 OR target_id = ?1").bind(s.userId).first<{ n: number }>();
    expect(log!.n).toBe(0);
  });

  it("gives a copy of the account's data", async () => {
    const { s } = await withProfile("Curious");
    const r = await api("GET", "/me/export", { token: s.accessToken });
    expect(r.status).toBe(200);
    expect(r.json.account.email).toBe(s.email);
    expect(r.json.devices).toHaveLength(1);
    expect(r.json.publicProfile.data.displayName).toBe("Curious");
    expect(r.json.securityLog.length).toBeGreaterThan(0);
  });
});

describe("the workspace trash", () => {
  it("keeps a deleted workspace for 30 days, then erases it", async () => {
    const ws = await workspaceWithOwner("Trashy");
    expect((await api("DELETE", `/workspaces/${ws.id}`, { token: ws.owner.accessToken })).status).toBe(200);
    expect((await api("GET", `/workspaces/${ws.id}`, { token: ws.owner.accessToken })).status).toBe(404);
    const trash = await api("GET", "/workspaces/trash/list", { token: ws.owner.accessToken });
    expect(trash.json.map((w: { id: string }) => w.id)).toContain(ws.id);
    expect((await api("POST", `/workspaces/${ws.id}/restore`, { token: ws.owner.accessToken })).status).toBe(200);
    expect((await api("GET", `/workspaces/${ws.id}`, { token: ws.owner.accessToken })).status).toBe(200);

    await api("DELETE", `/workspaces/${ws.id}`, { token: ws.owner.accessToken });
    await env.DB.prepare("UPDATE workspaces SET deleted_at = ?1 WHERE id = ?2").bind(Date.now() - 31 * 86_400_000, ws.id).run();
    await deletionHousekeeping(env);
    expect(await env.DB.prepare("SELECT 1 FROM workspaces WHERE id = ?1").bind(ws.id).first()).toBeNull();
    expect((await outbox("workspace.purged")).some((e) => e.workspaceId === ws.id)).toBe(true);
  });
});

describe("names the team keeps out", () => {
  it("blocks reserved usernames and banned words", async () => {
    const boss = await signUp("Names Boss");
    env.ADMIN_OWNERS = [env.ADMIN_OWNERS, boss.userId].filter(Boolean).join(",");
    expect((await api("POST", "/admin/names/reserved", { token: boss.accessToken, body: { name: "worldsteam" } })).status).toBe(201);
    expect((await api("POST", "/admin/names/banned", { token: boss.accessToken, body: { word: "Badword" } })).status).toBe(201);

    const someone = await signUp("Someone");
    const taken = await api("PATCH", "/me", { token: someone.accessToken, body: { username: "worldsteam" } });
    expect(taken.status).toBe(409);
    const check = await api("GET", "/auth/username/worldsteam");
    expect(check.json.available).toBe(false);
    const rude = await api("PATCH", "/me", { token: someone.accessToken, body: { displayName: "Bad Word Fan" } });
    expect(rude.json.error).toBe("name_not_allowed");
    const fine = await api("PATCH", "/me", { token: someone.accessToken, body: { displayName: "Good Fan" } });
    expect(fine.status).toBe(200);

    const list = await api("GET", "/admin/names", { token: boss.accessToken });
    expect(list.json.reserved.map((r: { name: string }) => r.name)).toContain("worldsteam");
    expect((await api("DELETE", "/admin/names/reserved/worldsteam", { token: boss.accessToken })).status).toBe(200);
    expect((await api("PATCH", "/me", { token: someone.accessToken, body: { username: "worldsteam" } })).status).toBe(200);
  });

  it("lets only an owner, after the second check, delete an account", async () => {
    const boss = await signUp("Deleter");
    env.ADMIN_OWNERS = [env.ADMIN_OWNERS, boss.userId].filter(Boolean).join(",");
    const target = await signUp("Target");
    const r = await api("POST", `/admin/users/${target.userId}/delete`, { token: boss.accessToken, body: { reason: "Asked by email" } });
    expect(r.json.error).toBe("step_up_required");
    const start = await api("POST", "/auth/email/start", { body: { email: boss.email } });
    await api("POST", "/admin/stepup/email/verify", { token: boss.accessToken, body: { challengeId: start.json.challengeId, code: lastCode(boss.email) } });
    const ok = await api("POST", `/admin/users/${target.userId}/delete`, { token: boss.accessToken, body: { reason: "Asked by email" } });
    expect(ok.json.dueAt).toBeGreaterThan(Date.now());
    const list = await api("GET", "/admin/deletions", { token: boss.accessToken });
    expect(list.json.map((u: { id: string }) => u.id)).toContain(target.userId);
    expect((await api("POST", `/admin/users/${target.userId}/deletion/cancel`, { token: boss.accessToken, body: {} })).status).toBe(200);
  });
});
