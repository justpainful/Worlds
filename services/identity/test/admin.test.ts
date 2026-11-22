import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { api, lastCode, signUp, type Session } from "./helpers";

/** An owner named in ADMIN_OWNERS, as on the real service. */
async function owner(): Promise<Session> {
  const s = await signUp("Boss");
  env.ADMIN_OWNERS = [env.ADMIN_OWNERS, s.userId].filter(Boolean).join(",");
  return s;
}

async function withRole(role: "owner" | "moderator" | "support", name: string = role): Promise<Session> {
  const s = await signUp(name);
  await env.DB.prepare("INSERT INTO admin_roles (user_id, role, granted_at) VALUES (?1, ?2, ?3)").bind(s.userId, role, Date.now()).run();
  return s;
}

let credN = 0;
/** Add a passkey, then make the second check with it. */
async function confirmWithPasskey(s: Session): Promise<void> {
  const id = `admin-cred-${++credN}`;
  const reg = await api("POST", "/auth/passkey/register/options", { token: s.accessToken, body: {} });
  await api("POST", "/auth/passkey/register/verify", { token: s.accessToken, body: { challengeId: reg.json.challengeId, response: { id, challenge: reg.json.options.challenge } } });
  const opts = await api("POST", "/admin/stepup/passkey/options", { token: s.accessToken, body: {} });
  expect(opts.status).toBe(200);
  expect(opts.json.options.userVerification).toBe("required");
  expect(opts.json.options.allowCredentials.map((c: { id: string }) => c.id)).toContain(id);
  const ok = await api("POST", "/admin/stepup/passkey/verify", { token: s.accessToken, body: { challengeId: opts.json.challengeId, response: { id, challenge: opts.json.options.challenge } } });
  expect(ok.status).toBe(200);
  expect(ok.json.stepUpUntil).toBeGreaterThan(Date.now());
}

async function publishProfile(s: Session): Promise<string> {
  const username = `pub${Date.now().toString(36).slice(-6)}${++credN}`;
  await api("PATCH", "/me", { token: s.accessToken, body: { username } });
  const put = await api("PUT", "/me/public-profile", { token: s.accessToken, body: { profile: { displayName: "Pub" } } });
  expect(put.status).toBe(200);
  return username;
}

describe("dashboard access", () => {
  it("lets in only the team", async () => {
    const someone = await signUp("Someone");
    const denied = await api("GET", "/admin/me", { token: someone.accessToken });
    expect(denied.status).toBe(403);
    expect(denied.json.error).toBe("not_admin");
    expect((await api("GET", "/admin/users")).status).toBe(401);

    const boss = await owner();
    const me = await api("GET", "/admin/me", { token: boss.accessToken });
    expect(me.status).toBe(200);
    expect(me.json.role).toBe("owner");
    expect(me.json.permissions).toContain("team");
    expect(me.json.stepUpUntil).toBeNull();
    expect(me.json.hasPasskey).toBe(false);
  });

  it("serves the related origins for passkeys", async () => {
    const r = await api("GET", "/.well-known/webauthn");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json.origins)).toBe(true);
  });

  it("confirms with an email code sent to the account's own address", async () => {
    const boss = await owner();
    const other = await signUp("Other");
    // A code sent to someone else's address does not count.
    const foreign = await api("POST", "/auth/email/start", { body: { email: other.email } });
    const no = await api("POST", "/admin/stepup/email/verify", { token: boss.accessToken, body: { challengeId: foreign.json.challengeId, code: lastCode(other.email) } });
    expect(no.status).toBe(403);
    expect(no.json.error).toBe("code_not_yours");

    const start = await api("POST", "/auth/email/start", { body: { email: boss.email } });
    const ok = await api("POST", "/admin/stepup/email/verify", { token: boss.accessToken, body: { challengeId: start.json.challengeId, code: lastCode(boss.email) } });
    expect(ok.status).toBe(200);
    const me = await api("GET", "/admin/me", { token: boss.accessToken });
    expect(me.json.stepUpUntil).toBeGreaterThan(Date.now());
    // No passkey yet, so the passkey check says so.
    const opts = await api("POST", "/admin/stepup/passkey/options", { token: boss.accessToken, body: {} });
    expect(opts.json.error).toBe("no_passkey");
  });
});

describe("accounts", () => {
  it("lists, searches and shows an account", async () => {
    const boss = await owner();
    const target = await signUp("Findable Person");
    const list = await api("GET", `/admin/users?q=${encodeURIComponent(target.email)}`, { token: boss.accessToken });
    expect(list.status).toBe(200);
    expect(list.json.total).toBe(1);
    expect(list.json.users[0]).toMatchObject({ id: target.userId, email: target.email, status: "active", devices: 1 });

    const one = await api("GET", `/admin/users/${target.userId}`, { token: boss.accessToken });
    expect(one.status).toBe(200);
    expect(one.json.devices).toHaveLength(1);
    expect(one.json.passkeys).toEqual([]);
    expect(one.json.suspension).toBeNull();
    expect(one.json.activity.map((a: { action: string }) => a.action)).toContain("account.created");
    expect((await api("GET", "/admin/users/nobody", { token: boss.accessToken })).status).toBe(404);
  });

  it("edits the name and username, and needs the second check for the email", async () => {
    const boss = await owner();
    const target = await signUp("Admin");
    const taken = await signUp("Taken");
    await api("PATCH", "/me", { token: taken.accessToken, body: { username: `taken${credN}x` } });

    const noReason = await api("PATCH", `/admin/users/${target.userId}`, { token: boss.accessToken, body: { displayName: "Enzo" } });
    expect(noReason.status).toBe(400);

    const ok = await api("PATCH", `/admin/users/${target.userId}`, { token: boss.accessToken, body: { displayName: "Enzo", username: `enzo${credN}y`, reason: "Reported in support" } });
    expect(ok.status).toBe(200);
    expect(ok.json.changed.sort()).toEqual(["displayName", "username"]);
    const me = await api("GET", "/me", { token: target.accessToken });
    expect(me.json).toMatchObject({ displayName: "Enzo", username: `enzo${credN}y`, usernameAuto: false });

    const clash = await api("PATCH", `/admin/users/${target.userId}`, { token: boss.accessToken, body: { username: `taken${credN}x`, reason: "x" } });
    expect(clash.status).toBe(409);

    const email = await api("PATCH", `/admin/users/${target.userId}`, { token: boss.accessToken, body: { email: "new.address@example.com", reason: "Lost access" } });
    expect(email.status).toBe(403);
    expect(email.json.error).toBe("step_up_required");
    await confirmWithPasskey(boss);
    const email2 = await api("PATCH", `/admin/users/${target.userId}`, { token: boss.accessToken, body: { email: `new.${credN}@example.com`, reason: "Lost access" } });
    expect(email2.status).toBe(200);

    // The log keeps the reason and which fields changed, never the email itself.
    const log = await api("GET", `/admin/audit?user=${target.userId}&action=admin.user`, { token: boss.accessToken });
    const updates = log.json.entries.filter((e: { action: string }) => e.action === "admin.user.updated");
    expect(updates).toHaveLength(2);
    expect(JSON.stringify(updates)).not.toContain("example.com");
    expect(updates[1].meta.reason).toBe("Reported in support");
    expect(updates[1].actorUserId).toBe(boss.userId);
  });

  it("suspends: signs out, blocks sign-in, hides the profile, then lifts it", async () => {
    const boss = await owner();
    const target = await signUp("Spammer");
    const username = await publishProfile(target);
    expect((await api("GET", `/profiles/${username}`)).status).toBe(200);

    const needs = await api("POST", `/admin/users/${target.userId}/suspend`, { token: boss.accessToken, body: { days: 7, reason: "Spam" } });
    expect(needs.json.error).toBe("step_up_required");
    await confirmWithPasskey(boss);
    const bad = await api("POST", `/admin/users/${target.userId}/suspend`, { token: boss.accessToken, body: { days: 0, reason: "Spam" } });
    expect(bad.status).toBe(400);
    const s = await api("POST", `/admin/users/${target.userId}/suspend`, { token: boss.accessToken, body: { days: 7, reason: "Spam" } });
    expect(s.status).toBe(200);
    expect(s.json.until).toBeGreaterThan(Date.now() + 6 * 86_400_000);

    expect((await api("GET", "/me", { token: target.accessToken })).status).toBe(401);
    const refresh = await api("POST", "/auth/refresh", { body: { refreshToken: target.refreshToken } });
    expect(refresh.status).toBe(401);
    const start = await api("POST", "/auth/email/start", { body: { email: target.email } });
    const again = await api("POST", "/auth/email/verify", { body: { challengeId: start.json.challengeId, code: lastCode(target.email), device: { name: "New PC" } } });
    expect(again.status).toBe(403);
    expect(again.json.error).toBe("account_suspended");
    expect(again.json.until).toBe(s.json.until);
    expect((await api("GET", `/profiles/${username}`)).status).toBe(404);

    const shown = await api("GET", `/admin/users/${target.userId}`, { token: boss.accessToken });
    expect(shown.json.status).toBe("suspended");
    expect(shown.json.suspension.reason).toBe("Spam");
    expect(shown.json.devices.every((d: { revokedAt: number | null }) => d.revokedAt)).toBe(true);
    const filtered = await api("GET", "/admin/users?status=suspended", { token: boss.accessToken });
    expect(filtered.json.users.map((u: { id: string }) => u.id)).toContain(target.userId);

    const lift = await api("POST", `/admin/users/${target.userId}/unsuspend`, { token: boss.accessToken, body: { reason: "Appeal accepted" } });
    expect(lift.status).toBe(200);
    expect((await api("GET", `/profiles/${username}`)).status).toBe(200);
    const start2 = await api("POST", "/auth/email/start", { body: { email: target.email } });
    const back = await api("POST", "/auth/email/verify", { body: { challengeId: start2.json.challengeId, code: lastCode(target.email), device: { name: "New PC" } } });
    expect(back.status).toBe(200);
  });

  it("bans with no end, and signs out one device or all", async () => {
    const boss = await owner();
    await confirmWithPasskey(boss);
    const a = await signUp("Device Person");
    const one = await api("POST", `/admin/users/${a.userId}/signout`, { token: boss.accessToken, body: { deviceId: a.deviceId, reason: "Lost phone" } });
    expect(one.json.devices).toBe(1);
    expect((await api("GET", "/me", { token: a.accessToken })).status).toBe(401);

    const b = await signUp("Banned Person");
    const ban = await api("POST", `/admin/users/${b.userId}/suspend`, { token: boss.accessToken, body: { ban: true, reason: "Scam links" } });
    expect(ban.json).toMatchObject({ ok: true, banned: true, until: null });
    const start = await api("POST", "/auth/email/start", { body: { email: b.email } });
    const v = await api("POST", "/auth/email/verify", { body: { challengeId: start.json.challengeId, code: lastCode(b.email) } });
    expect(v.json.error).toBe("account_banned");
    const detail = await api("GET", `/admin/users/${b.userId}`, { token: boss.accessToken });
    expect(detail.json.status).toBe("banned");
  });

  it("keeps notes private to the team", async () => {
    const boss = await owner();
    const target = await signUp("Noted");
    const add = await api("POST", `/admin/users/${target.userId}/notes`, { token: boss.accessToken, body: { body: "Reported the name bug, fixed in 1.0.1" } });
    expect(add.status).toBe(201);
    const shown = await api("GET", `/admin/users/${target.userId}`, { token: boss.accessToken });
    expect(shown.json.notes[0]).toMatchObject({ body: "Reported the name bug, fixed in 1.0.1", author: { id: boss.userId } });

    const mod = await withRole("moderator", "Mod");
    expect((await api("DELETE", `/admin/notes/${add.json.id}`, { token: mod.accessToken })).status).toBe(403);
    expect((await api("DELETE", `/admin/notes/${add.json.id}`, { token: boss.accessToken })).status).toBe(200);
  });
});

describe("roles", () => {
  it("limits a moderator", async () => {
    const mod = await withRole("moderator", "Moderator");
    const target = await signUp("Hidden Email");
    // No emails, and searching by email finds nothing.
    const byEmail = await api("GET", `/admin/users?q=${encodeURIComponent(target.email)}`, { token: mod.accessToken });
    expect(byEmail.json.total).toBe(0);
    const detail = await api("GET", `/admin/users/${target.userId}`, { token: mod.accessToken });
    expect(detail.json.email).toBeNull();

    await confirmWithPasskey(mod);
    const ban = await api("POST", `/admin/users/${target.userId}/suspend`, { token: mod.accessToken, body: { ban: true, reason: "x" } });
    expect(ban.json.error).toBe("not_allowed");
    const suspend = await api("POST", `/admin/users/${target.userId}/suspend`, { token: mod.accessToken, body: { days: 1, reason: "Cool down" } });
    expect(suspend.status).toBe(200);

    // Nobody on the team can be suspended by a moderator, and nobody can act on themselves.
    const sup = await withRole("support", "Helper");
    const onTeam = await api("POST", `/admin/users/${sup.userId}/suspend`, { token: mod.accessToken, body: { days: 1, reason: "x" } });
    expect(onTeam.json.error).toBe("protected_member");
    const self = await api("PATCH", `/admin/users/${mod.userId}`, { token: mod.accessToken, body: { displayName: "Me", reason: "x" } });
    expect(self.json.error).toBe("own_account");
    expect((await api("GET", "/admin/stats", { token: mod.accessToken })).status).toBe(200);
  });

  it("limits support to reading, emails and notes", async () => {
    const sup = await withRole("support", "Support");
    const target = await signUp("Customer");
    const detail = await api("GET", `/admin/users/${target.userId}`, { token: sup.accessToken });
    expect(detail.json.email).toBe(target.email);
    expect(detail.json.activity).toEqual([]);
    const edit = await api("PATCH", `/admin/users/${target.userId}`, { token: sup.accessToken, body: { displayName: "X", reason: "x" } });
    expect(edit.json.error).toBe("not_allowed");
    expect((await api("GET", "/admin/audit", { token: sup.accessToken })).json.error).toBe("not_allowed");
  });

  it("lets an owner manage the team, but not the owners in the settings", async () => {
    const boss = await owner();
    const helper = await signUp("New Helper");
    const noCheck = await api("PUT", `/admin/team/${helper.userId}`, { token: boss.accessToken, body: { role: "support" } });
    expect(noCheck.json.error).toBe("step_up_required");
    await confirmWithPasskey(boss);
    expect((await api("PUT", `/admin/team/${helper.userId}`, { token: boss.accessToken, body: { role: "support" } })).status).toBe(200);
    expect((await api("GET", "/admin/me", { token: helper.accessToken })).json.role).toBe("support");
    const team = await api("GET", "/admin/team", { token: boss.accessToken });
    const ids = team.json.map((m: { id: string }) => m.id);
    expect(ids).toContain(helper.userId);
    expect(team.json.find((m: { id: string }) => m.id === boss.userId)).toMatchObject({ role: "owner", fixed: true });

    const second = await owner();
    expect((await api("DELETE", `/admin/team/${second.userId}`, { token: boss.accessToken })).json.error).toBe("protected_owner");
    expect((await api("DELETE", `/admin/team/${helper.userId}`, { token: boss.accessToken })).status).toBe(200);
    expect((await api("GET", "/admin/me", { token: helper.accessToken })).status).toBe(403);
  });
});

describe("numbers", () => {
  it("counts accounts, sign-ups and devices", async () => {
    const boss = await owner();
    await signUp("Counted");
    const r = await api("GET", "/admin/stats", { token: boss.accessToken });
    expect(r.status).toBe(200);
    expect(r.json.users.total).toBeGreaterThan(1);
    expect(r.json.signups.day).toBeGreaterThan(0);
    expect(r.json.signups.perDay.at(-1).count).toBeGreaterThan(0);
    expect(r.json.active.day).toBeGreaterThan(0);
    expect(r.json.platforms.find((p: { platform: string }) => p.platform === "windows").devices).toBeGreaterThan(0);
  });
});
