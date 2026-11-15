import { describe, expect, it } from "vitest";
import worker, { forwarded, MAIL_PATH, sameSecret, sendMail, targetFor, type Env, type SendEmailBinding } from "../src/index";

const env = (email?: SendEmailBinding): Env => ({
  EMAIL: email,
  IDENTITY_ORIGIN: "https://worlds-identity.test.workers.dev",
  SYNC_ORIGIN: "https://worlds-sync.test.workers.dev",
  LOGIN_HOST: "login.enterworlds.space",
  CONNECT_HOST: "connect.enterworlds.space",
  MAIL_FROM: "Worlds <no-reply@enterworlds.space>",
  EDGE_SECRET: "edge-secret-0123456789",
  MAIL_SECRET: "mail-secret-0123456789",
});

const mailRequest = (body: unknown, secret = "mail-secret-0123456789") =>
  new Request(`https://login.enterworlds.space${MAIL_PATH}`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("forwarding", () => {
  it("sends login to the identity service and connect to sync, nothing else", () => {
    expect(targetFor("login.enterworlds.space", env())).toBe("https://worlds-identity.test.workers.dev");
    expect(targetFor("CONNECT.enterworlds.space", env())).toBe("https://worlds-sync.test.workers.dev");
    expect(targetFor("enterworlds.space", env())).toBeNull();
    expect(targetFor("evil.example", env())).toBeNull();
  });

  it("keeps the path, query and body, and replaces the edge headers a client sent", async () => {
    const req = new Request("https://login.enterworlds.space/auth/email/start?x=1", {
      method: "POST",
      headers: { "cf-connecting-ip": "203.0.113.7", "x-worlds-edge": "forged", "x-worlds-client-ip": "10.0.0.1", "content-type": "application/json" },
      body: '{"email":"a@b.co"}',
    });
    const out = forwarded(req, "https://worlds-identity.test.workers.dev", env());
    expect(out.url).toBe("https://worlds-identity.test.workers.dev/auth/email/start?x=1");
    expect(out.method).toBe("POST");
    expect(out.headers.get("x-worlds-edge")).toBe("edge-secret-0123456789");
    expect(out.headers.get("x-worlds-client-ip")).toBe("203.0.113.7");
    expect(out.headers.get("x-forwarded-host")).toBe("login.enterworlds.space");
    expect(await out.text()).toBe('{"email":"a@b.co"}');
  });

  it("passes a WebSocket upgrade on as a GET without a body", () => {
    const req = new Request("https://connect.enterworlds.space/v1/workspaces/w/docs/d/sync", { headers: { upgrade: "websocket", "sec-websocket-protocol": "worlds-sync-v1" } });
    const out = forwarded(req, "https://worlds-sync.test.workers.dev", env());
    expect(out.method).toBe("GET");
    expect(out.headers.get("upgrade")).toBe("websocket");
    expect(out.headers.get("sec-websocket-protocol")).toBe("worlds-sync-v1");
  });

  it("answers 404 for a host it does not serve", async () => {
    const res = await worker.fetch(new Request("https://other.enterworlds.space/"), env());
    expect(res.status).toBe(404);
  });
});

describe("the mail endpoint", () => {
  it("compares secrets exactly", () => {
    expect(sameSecret("abc", "abc")).toBe(true);
    expect(sameSecret("abd", "abc")).toBe(false);
    expect(sameSecret("ab", "abc")).toBe(false);
    expect(sameSecret(null, "abc")).toBe(false);
    expect(sameSecret("", "")).toBe(false);
  });

  it("refuses a request without the secret", async () => {
    const sent: unknown[] = [];
    const res = await sendMail(mailRequest({ to: "a@b.co", subject: "s", text: "t" }, "wrong"), env({ send: async (m) => void sent.push(m) }));
    expect(res.status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it("sends from the domain through the binding", async () => {
    const sent: unknown[] = [];
    const res = await worker.fetch(mailRequest({ to: "a@b.co", subject: "482915 is your Worlds sign-in code", text: "t", html: "<p>h</p>" }), env({ send: async (m) => void sent.push(m) }));
    expect(res.status).toBe(200);
    expect(sent).toEqual([{ to: "a@b.co", from: { name: "Worlds", email: "no-reply@enterworlds.space" }, subject: "482915 is your Worlds sign-in code", text: "t", html: "<p>h</p>" }]);
  });

  it("answers 502 when Cloudflare refuses, so the identity service falls back", async () => {
    const failing = { send: async () => Promise.reject(Object.assign(new Error("limit"), { code: "E_DAILY_LIMIT_EXCEEDED" })) };
    const res = await sendMail(mailRequest({ to: "a@b.co", subject: "s", text: "t" }), env(failing));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "send_failed", code: "E_DAILY_LIMIT_EXCEEDED" });
  });

  it("checks the message before sending", async () => {
    const e = env({ send: async () => undefined });
    expect((await sendMail(mailRequest({ to: "not an email", subject: "s", text: "t" }), e)).status).toBe(400);
    expect((await sendMail(mailRequest({ to: "a@b.co", subject: "", text: "t" }), e)).status).toBe(400);
    expect((await sendMail(mailRequest({ to: "a@b.co", subject: "s" }), e)).status).toBe(400);
  });
});
