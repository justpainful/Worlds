import { describe, expect, it } from "vitest";
import { codeEmail, emailLanguage, emailSender, FallbackEmailSender, parseFrom, setEmailSender, type EmailMessage, type EmailSender } from "../src/lib/email";
import type { Env, SendEmailBinding } from "../src/env";
import { api, mailbox, uniqueEmail } from "./helpers";

const msg: EmailMessage = { to: "a@example.com", subject: "s", text: "t", html: "<p>h</p>" };

describe("sign-in email", () => {
  it("reads right to left in Arabic with the code as one piece of text", () => {
    const e = codeEmail("482915", "ar");
    expect(e.subject).toContain("482915");
    expect(e.subject).toContain("رمز");
    expect(e.html).toContain('dir="rtl"');
    expect(e.html).toContain('lang="ar"');
    // One element holds all six digits, so a double-click or long press copies the whole code.
    expect(e.html).toMatch(/class="code"[^>]*>482915</);
    expect(e.html.match(/class="code"/g)).toHaveLength(1);
    expect(e.html).toContain("رسالة تعرف عنوانها");
    expect(e.text).toContain("482915");
  });

  it("reads left to right in English", () => {
    const e = codeEmail("000731", "en");
    expect(e.subject).toBe("000731 is your Worlds sign-in code");
    expect(e.html).toContain('dir="ltr"');
    expect(e.html).toMatch(/class="code"[^>]*>000731</);
    expect(e.html).toContain("https://enterworlds.space/mail/letter.png");
    expect(e.html).not.toContain(String.fromCharCode(0x2014));
    expect(e.html).toContain("https://enterworlds.space");
  });

  it("picks the language from the app first, then the device", () => {
    expect(emailLanguage("ar", "en-US")).toBe("ar");
    expect(emailLanguage("en", "ar-SA")).toBe("en");
    expect(emailLanguage(undefined, "ar-SA,ar;q=0.9,en;q=0.8")).toBe("ar");
    expect(emailLanguage("fr", "en-GB")).toBe("en");
    expect(emailLanguage(undefined, null)).toBe("en");
  });

  it("splits a named sender address", () => {
    expect(parseFrom("Worlds <no-reply@enterworlds.space>")).toEqual({ name: "Worlds", email: "no-reply@enterworlds.space" });
    expect(parseFrom("no-reply@enterworlds.space")).toEqual({ email: "no-reply@enterworlds.space" });
  });
});

describe("sending with a fallback", () => {
  const failing = (why: string): EmailSender => ({
    send: async () => {
      throw new Error(why);
    },
  });

  it("hands the message to the next provider when the first fails", async () => {
    const got: EmailMessage[] = [];
    await new FallbackEmailSender([failing("daily limit"), { send: async (m) => void got.push(m) }]).send(msg);
    expect(got).toEqual([msg]);
  });

  it("fails only when every provider fails, naming each reason", async () => {
    await expect(new FallbackEmailSender([failing("one"), failing("two")]).send(msg)).rejects.toThrow(/one; two/);
  });

  it("puts Cloudflare first and Resend after it", async () => {
    const sent: unknown[] = [];
    const binding: SendEmailBinding = {
      send: async (m) => {
        sent.push(m);
        throw Object.assign(new Error("over quota"), { code: "E_RATE_LIMIT_EXCEEDED" });
      },
    };
    const realFetch = globalThis.fetch;
    const posted: { url: string; body: any }[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      posted.push({ url, body: JSON.parse(String(init.body)) });
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    setEmailSender(null);
    try {
      const env = { EMAIL: binding, EMAIL_FROM: "Worlds <no-reply@enterworlds.space>", RESEND_API_KEY: "re_test", ENVIRONMENT: "production" } as unknown as Env;
      await emailSender(env).send(msg);
    } finally {
      globalThis.fetch = realFetch;
      setEmailSender({ send: async (m) => void mailbox.push(m) });
    }
    expect(sent).toEqual([{ to: msg.to, from: { name: "Worlds", email: "no-reply@enterworlds.space" }, subject: "s", text: "t", html: "<p>h</p>" }]);
    expect(posted).toHaveLength(1);
    expect(posted[0].url).toBe("https://api.resend.com/emails");
    expect(posted[0].body).toMatchObject({ from: "Worlds <no-reply@enterworlds.space>", to: [msg.to], html: "<p>h</p>" });
  });

  it("tries the edge webhook before Resend", async () => {
    const realFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      urls.push(url);
      return new Response("{}", { status: url.includes("/_edge/mail") ? 502 : 200 });
    }) as typeof fetch;
    setEmailSender(null);
    try {
      const env = {
        EMAIL_WEBHOOK_URL: "https://login.enterworlds.space/_edge/mail",
        EMAIL_WEBHOOK_SECRET: "s",
        RESEND_API_KEY: "re_test",
        ENVIRONMENT: "production",
      } as unknown as Env;
      await emailSender(env).send(msg);
    } finally {
      globalThis.fetch = realFetch;
      setEmailSender({ send: async (m) => void mailbox.push(m) });
    }
    expect(urls).toEqual(["https://login.enterworlds.space/_edge/mail", "https://api.resend.com/emails"]);
  });

  it("sends through Brevo when Resend has reached its daily limit", async () => {
    const realFetch = globalThis.fetch;
    const calls: { url: string; headers: Headers; body: any }[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) });
      return new Response("{}", { status: url.includes("resend") ? 429 : 201 });
    }) as typeof fetch;
    setEmailSender(null);
    try {
      const env = { EMAIL_FROM: "Worlds <no-reply@enterworlds.space>", RESEND_API_KEY: "re_test", BREVO_API_KEY: "xkeysib-test", ENVIRONMENT: "production" } as unknown as Env;
      await emailSender(env).send(msg);
    } finally {
      globalThis.fetch = realFetch;
      setEmailSender({ send: async (m) => void mailbox.push(m) });
    }
    expect(calls.map((c) => c.url)).toEqual(["https://api.resend.com/emails", "https://api.brevo.com/v3/smtp/email"]);
    expect(calls[1].headers.get("api-key")).toBe("xkeysib-test");
    expect(calls[1].body).toEqual({
      sender: { name: "Worlds", email: "no-reply@enterworlds.space" },
      to: [{ email: msg.to }],
      subject: "s",
      textContent: "t",
      htmlContent: "<p>h</p>",
    });
  });

  it("refuses to run in production with no provider", () => {
    setEmailSender(null);
    try {
      expect(() => emailSender({ ENVIRONMENT: "production" } as unknown as Env)).toThrow(/No email sender/);
    } finally {
      setEmailSender({ send: async (m) => void mailbox.push(m) });
    }
  });
});

describe("the sign-in route", () => {
  it("writes the email in the language the app asks for", async () => {
    const email = uniqueEmail("arabic");
    const res = await api("POST", "/auth/email/start", { body: { email, lang: "ar" } });
    expect(res.status).toBeLessThan(300);
    const m = [...mailbox].reverse().find((x) => x.to === email)!;
    expect(m.subject).toContain("رمز");
    expect(m.html).toContain('dir="rtl"');
  });

  it("falls back to the device language", async () => {
    const email = uniqueEmail("device");
    await api("POST", "/auth/email/start", { body: { email }, headers: { "accept-language": "ar-SA" } });
    expect([...mailbox].reverse().find((x) => x.to === email)!.subject).toContain("رمز");
  });
});
