import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { IDLE_MS } from "../src/routes/admin";
import { RETENTION_GUARD, monthsMs, retentionHousekeeping } from "../src/lib/retention";
import { api, lastCode, signUp, type Session } from "./helpers";

async function owner(): Promise<Session> {
  const s = await signUp("Boss");
  env.ADMIN_OWNERS = [env.ADMIN_OWNERS, s.userId].filter(Boolean).join(",");
  return s;
}

/** Sign in again from the dashboard itself, as web/admin does. */
async function dashboardDevice(s: Session): Promise<Session> {
  const start = await api("POST", "/auth/email/start", { body: { email: s.email } });
  const r = await api("POST", "/auth/email/verify", { body: { challengeId: start.json.challengeId, code: lastCode(s.email), create: false, device: { name: "Worlds dashboard", platform: "admin" } } });
  expect(r.status).toBe(200);
  return { ...s, deviceId: r.json.deviceId, accessToken: r.json.accessToken, refreshToken: r.json.refreshToken };
}

async function confirmWithEmail(s: Session): Promise<void> {
  const start = await api("POST", "/auth/email/start", { body: { email: s.email } });
  const ok = await api("POST", "/admin/stepup/email/verify", { token: s.accessToken, body: { challengeId: start.json.challengeId, code: lastCode(s.email) } });
  expect(ok.status).toBe(200);
}

describe("dashboard idle lock", () => {
  it("signs a dashboard device out after 15 minutes without a request", async () => {
    const boss = await dashboardDevice(await owner());
    expect((await api("GET", "/admin/me", { token: boss.accessToken })).status).toBe(200);
    const row = await env.DB.prepare("SELECT last_at FROM admin_activity WHERE device_id = ?1").bind(boss.deviceId).first<{ last_at: number }>();
    expect(row?.last_at).toBeGreaterThan(Date.now() - 60_000);

    // Fourteen minutes is fine, and the request moves the window on.
    await env.DB.prepare("UPDATE admin_activity SET last_at = ?1 WHERE device_id = ?2").bind(Date.now() - 14 * 60_000, boss.deviceId).run();
    expect((await api("GET", "/admin/me", { token: boss.accessToken })).status).toBe(200);
    const moved = await env.DB.prepare("SELECT last_at FROM admin_activity WHERE device_id = ?1").bind(boss.deviceId).first<{ last_at: number }>();
    expect(moved!.last_at).toBeGreaterThan(Date.now() - 60_000);

    await env.DB.prepare("UPDATE admin_activity SET last_at = ?1 WHERE device_id = ?2").bind(Date.now() - IDLE_MS - 1000, boss.deviceId).run();
    const locked = await api("GET", "/admin/me", { token: boss.accessToken });
    expect(locked.status).toBe(401);
    expect(locked.json.error).toBe("idle_locked");
    const dev = await env.DB.prepare("SELECT revoked_at FROM devices WHERE id = ?1").bind(boss.deviceId).first<{ revoked_at: number | null }>();
    expect(dev?.revoked_at).toBeTruthy();
    expect((await api("POST", "/auth/refresh", { body: { refreshToken: boss.refreshToken, deviceId: boss.deviceId } })).status).toBe(401);
  });

  it("leaves the app's own devices alone", async () => {
    const boss = await owner();
    expect((await api("GET", "/admin/me", { token: boss.accessToken })).status).toBe(200);
    const row = await env.DB.prepare("SELECT 1 FROM admin_activity WHERE device_id = ?1").bind(boss.deviceId).first();
    expect(row).toBeNull();
  });
});

describe("key rotation reminder", () => {
  it("reminds the owner until both dates are set and recent", async () => {
    const boss = await owner();
    const first = await api("GET", "/admin/stats", { token: boss.accessToken });
    expect(first.json.keys).toEqual({ signingRotatedAt: null, resendRotatedAt: null, signingDue: true, resendDue: true });

    await confirmWithEmail(boss);
    const recent = Date.now() - 30 * 86_400_000;
    const old = Date.now() - 200 * 86_400_000;
    const put = await api("PUT", "/admin/control/settings/keys", { token: boss.accessToken, body: { value: { signingRotatedAt: recent, resendRotatedAt: old } } });
    expect(put.status).toBe(200);
    const after = await api("GET", "/admin/stats", { token: boss.accessToken });
    expect(after.json.keys).toMatchObject({ signingDue: false, resendDue: true });

    const future = await api("PUT", "/admin/control/settings/keys", { token: boss.accessToken, body: { value: { signingRotatedAt: Date.now() + 7 * 86_400_000, resendRotatedAt: null } } });
    expect(future.status).toBe(400);
  });

  it("is only for those who can change the settings", async () => {
    const mod = await signUp("Mod");
    await env.DB.prepare("INSERT INTO admin_roles (user_id, role, granted_at) VALUES (?1, 'moderator', ?2)").bind(mod.userId, Date.now()).run();
    const r = await api("GET", "/admin/stats", { token: mod.accessToken });
    expect(r.status).toBe(200);
    expect(r.json.keys).toBeNull();
  });
});

let ticketN = 900_000;
async function closedTicket(closedAt: number, status = "closed"): Promise<string> {
  const id = `tk-${++ticketN}`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO support_tickets (id, number, email, kind, subject, status, reply_key, created_at, updated_at, closed_at) VALUES (?1, ?2, 'a@example.com', 'other', 'Old', ?3, ?4, ?5, ?5, ?6)",
    ).bind(id, ticketN, status, `rk-${ticketN}`, closedAt - 1000, status === "closed" ? closedAt : null),
    env.DB.prepare("INSERT INTO support_messages (id, ticket_id, author, body, created_at) VALUES (?1, ?2, 'person', 'Hello', ?3)").bind(`m-${id}`, id, closedAt - 1000),
  ]);
  return id;
}
const exists = async (id: string) => !!(await env.DB.prepare("SELECT 1 FROM support_tickets WHERE id = ?1").bind(id).first());

describe("retention", () => {
  it("erases old log entries and old closed requests once a day, with periods from the settings", async () => {
    await env.DB.prepare("DELETE FROM service_settings WHERE key IN (?1, 'retention')").bind(RETENTION_GUARD).run();
    const t = Date.now();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO audit_log (id, at, actor_kind, action) VALUES ('old-log', ?1, 'system', 'test.old')").bind(t - monthsMs(13)),
      env.DB.prepare("INSERT INTO audit_log (id, at, actor_kind, action) VALUES ('new-log', ?1, 'system', 'test.new')").bind(t - monthsMs(11)),
    ]);
    const oldClosed = await closedTicket(t - monthsMs(25));
    const newClosed = await closedTicket(t - monthsMs(23));
    const oldOpen = await closedTicket(t - monthsMs(30), "waiting");

    const r = await retentionHousekeeping(env);
    expect(r.ran).toBe(true);
    expect(r.tickets).toBe(1);
    expect(await env.DB.prepare("SELECT 1 FROM audit_log WHERE id = 'old-log'").first()).toBeNull();
    expect(await env.DB.prepare("SELECT 1 FROM audit_log WHERE id = 'new-log'").first()).not.toBeNull();
    expect(await exists(oldClosed)).toBe(false);
    expect(await env.DB.prepare("SELECT 1 FROM support_messages WHERE ticket_id = ?1").bind(oldClosed).first()).toBeNull();
    expect(await exists(newClosed)).toBe(true);
    expect(await exists(oldOpen)).toBe(true);

    // Not again the same day.
    expect((await retentionHousekeeping(env)).ran).toBe(false);

    // Shorter periods from the dashboard.
    const boss = await owner();
    await confirmWithEmail(boss);
    const bad = await api("PUT", "/admin/control/settings/retention", { token: boss.accessToken, body: { value: { auditMonths: 0, closedTicketMonths: 24 } } });
    expect(bad.status).toBe(400);
    const put = await api("PUT", "/admin/control/settings/retention", { token: boss.accessToken, body: { value: { auditMonths: 6, closedTicketMonths: 12 } } });
    expect(put.status).toBe(200);
    expect(put.json.settings.retention).toEqual({ auditMonths: 6, closedTicketMonths: 12 });
    const again = await retentionHousekeeping(env, { force: true });
    expect(again.ran).toBe(true);
    expect(await env.DB.prepare("SELECT 1 FROM audit_log WHERE id = 'new-log'").first()).toBeNull();
    expect(await exists(newClosed)).toBe(false);
    expect(await exists(oldOpen)).toBe(true);
  });
});
