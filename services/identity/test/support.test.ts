import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { inboundSupport, supportHousekeeping } from "../src/routes/support";
import { api, lastCode, mailbox, outbox, signUp, uniqueEmail, type Session } from "./helpers";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function supportSession(email: string): Promise<string> {
  const start = await api("POST", "/auth/email/start", { body: { email } });
  const s = await api("POST", "/support/session", { body: { challengeId: start.json.challengeId, code: lastCode(email) } });
  expect(s.status).toBe(200);
  return s.json.token;
}

const as = (token: string) => ({ "x-support-session": token });

async function owner(): Promise<Session> {
  const s = await signUp("Desk");
  env.ADMIN_OWNERS = [env.ADMIN_OWNERS, s.userId].filter(Boolean).join(",");
  return s;
}

async function ask(token: string, extra: Record<string, unknown> = {}) {
  const r = await api("POST", "/support/requests", {
    headers: as(token),
    body: { kind: "problem", subject: "The app closes", body: "It closes when I open a drawing.", fields: { platform: "windows", version: "1.0.1" }, lang: "en", ...extra },
  });
  expect(r.status).toBe(201);
  return r.json;
}

describe("support requests", () => {
  it("lets someone without an account ask, and follow the answer", async () => {
    const email = uniqueEmail("guest");
    const token = await supportSession(email);
    const t = await ask(token);
    expect(t.ref).toMatch(/^W-\d+$/);
    expect(t.status).toBe("open");
    // A receipt from support@, with replies threaded to the request.
    const receipt = mailbox.find((m) => m.to === email && /W-\d+/.test(m.subject));
    expect(receipt?.from ?? "").toContain("support@");
    expect(receipt?.replyTo).toMatch(/^support\+[a-z0-9_-]+@/);

    const mine = await api("GET", "/support/me", { headers: as(token) });
    expect(mine.json.hasAccount).toBe(false);
    expect(mine.json.requests.map((r: { number: number }) => r.number)).toContain(t.number);

    // Someone else cannot read it.
    const other = await supportSession(uniqueEmail("other"));
    expect((await api("GET", `/support/requests/${t.number}`, { headers: as(other) })).status).toBe(404);

    const boss = await owner();
    const note = await api("POST", `/admin/support/${t.number}/note`, { token: boss.accessToken, body: { body: "Probably the drawing cache." } });
    expect(note.status).toBe(201);
    const reply = await api("POST", `/admin/support/${t.number}/reply`, { token: boss.accessToken, body: { body: "Thanks! Fixed in 1.0.2." } });
    expect(reply.json.mailed).toBe(true);
    expect(mailbox.some((m) => m.to === email && m.text.includes("Fixed in 1.0.2"))).toBe(true);

    const seen = await api("GET", `/support/requests/${t.number}`, { headers: as(token) });
    expect(seen.json.status).toBe("waiting");
    expect(seen.json.messages.map((m: { author: string }) => m.author)).toEqual(["person", "team"]);

    const back = await api("POST", `/support/requests/${t.number}/messages`, { headers: as(token), body: { body: "Still closes." } });
    expect(back.status).toBe(201);
    expect((await api("GET", `/support/requests/${t.number}`, { headers: as(token) })).json.status).toBe("open");
    await api("POST", `/support/requests/${t.number}/rate`, { headers: as(token), body: { solved: true } });
    expect((await api("GET", `/support/requests/${t.number}`, { headers: as(token) })).json).toMatchObject({ status: "solved", rating: 1 });
  });

  it("links a request to the account and tells the app", async () => {
    const person = await signUp("Has Account");
    const r = await api("POST", "/support/requests", { token: person.accessToken, body: { kind: "account", subject: "Name changed", body: "My name became Admin." } });
    expect(r.status).toBe(201);
    const boss = await owner();
    const detail = await api("GET", `/admin/support/${r.json.number}`, { token: boss.accessToken });
    expect(detail.json.userId).toBe(person.userId);
    expect(detail.json.email).toBe(person.email);
    await api("POST", `/admin/support/${r.json.number}/reply`, { token: boss.accessToken, body: { body: "Fixed your name.", status: "solved" } });
    const notes = (await outbox("user.notify")).filter((e) => e.userId === person.userId);
    expect(notes.at(-1).notification).toMatchObject({ topic: "support.reply", excerpt: "Fixed your name." });
    expect((await api("GET", `/support/requests/${r.json.number}`, { token: person.accessToken })).json.status).toBe("solved");
  });

  it("keeps pictures with their request", async () => {
    const email = uniqueEmail("pic");
    const token = await supportSession(email);
    const up = await api("POST", "/support/files", { headers: as(token), body: { mime: "image/png", data: PNG } });
    expect(up.status).toBe(200);
    const t = await ask(token, { files: [up.json.key] });
    const other = await supportSession(uniqueEmail("peek"));
    expect((await api("GET", `/support/files/${up.json.key}`, { headers: as(other) })).status).toBe(404);
    expect((await api("GET", `/support/files/${up.json.key}`, { headers: as(token) })).status).toBe(200);
    // Someone else's picture cannot be attached.
    const theirs = await api("POST", "/support/files", { headers: as(other), body: { mime: "image/png", data: PNG } });
    const steal = await api("POST", `/support/requests/${t.number}/messages`, { headers: as(token), body: { body: "x", files: [theirs.json.key] } });
    expect(steal.status).toBe(400);
  });

  it("takes mail to support@ and threads replies", async () => {
    const from = uniqueEmail("mailer");
    expect(await inboundSupport(env, { to: "support@enterworlds.space", from: `Mona <${from}>`, subject: "Hello", text: "I need help with sync." })).toBe(true);
    const receipt = mailbox.find((m) => m.to === from);
    expect(receipt).toBeTruthy();
    const key = /support\+([^@]+)@/.exec(receipt!.replyTo!)![1];
    await inboundSupport(env, { to: `support+${key}@enterworlds.space`, from, subject: "Re: We got your request", text: "More detail.\n\nOn Mon, Worlds wrote:\n> old text" });
    const row = await env.DB.prepare("SELECT t.number, t.name, (SELECT COUNT(*) FROM support_messages m WHERE m.ticket_id = t.id) AS n FROM support_tickets t WHERE t.email = ?1").bind(from).first<{ number: number; name: string; n: number }>();
    expect(row).toMatchObject({ name: "Mona", n: 2 });
    const last = await env.DB.prepare("SELECT body FROM support_messages WHERE ticket_id = (SELECT id FROM support_tickets WHERE email = ?1) ORDER BY created_at DESC LIMIT 1").bind(from).first<{ body: string }>();
    expect(last!.body).toBe("More detail.");
    // Not a support address: left for the personal inbox.
    expect(await inboundSupport(env, { to: "abc123@enterworlds.space", from, subject: "x", text: "x" })).toBe(false);
  });

  it("keeps security reports to owners, and closes quiet requests after a week", async () => {
    const token = await supportSession(uniqueEmail("researcher"));
    const sec = await ask(token, { kind: "security", subject: "A hole" });
    const mod = await signUp("Mod Desk");
    await env.DB.prepare("INSERT INTO admin_roles (user_id, role, granted_at) VALUES (?1, 'moderator', ?2)").bind(mod.userId, Date.now()).run();
    expect((await api("GET", `/admin/support/${sec.number}`, { token: mod.accessToken })).status).toBe(404);
    const list = await api("GET", "/admin/support?status=all", { token: mod.accessToken });
    expect(list.json.requests.some((r: { number: number }) => r.number === sec.number)).toBe(false);
    expect(list.json.requests[0]?.email ?? null).toBeNull();
    const boss = await owner();
    expect((await api("GET", `/admin/support/${sec.number}`, { token: boss.accessToken })).json.private).toBe(true);

    const quiet = await ask(token, { subject: "Quiet one" });
    await api("POST", `/admin/support/${quiet.number}/reply`, { token: boss.accessToken, body: { body: "Can you send a picture?" } });
    await env.DB.prepare("UPDATE support_tickets SET updated_at = ?1 WHERE number = ?2").bind(Date.now() - 8 * 86_400_000, quiet.number).run();
    await supportHousekeeping(env);
    expect((await api("GET", `/admin/support/${quiet.number}`, { token: boss.accessToken })).json.status).toBe("closed");
  });
});
