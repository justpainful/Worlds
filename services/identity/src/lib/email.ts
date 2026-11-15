import type { Env, SendEmailBinding } from "../env";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** The designed version; mail apps that cannot show it fall back to `text`. */
  html?: string;
}

/** Sends sign-in emails. Swap the implementation without touching the auth flow. */
export interface EmailSender {
  send(msg: EmailMessage): Promise<void>;
}

/** Development: logs the message (and keeps the last few for tests). */
export class DevEmailSender implements EmailSender {
  static outbox: EmailMessage[] = [];
  async send(msg: EmailMessage): Promise<void> {
    DevEmailSender.outbox.push(msg);
    if (DevEmailSender.outbox.length > 50) DevEmailSender.outbox.shift();
    console.log(`[dev email] to ${msg.to}: ${msg.subject}\n${msg.text}`);
  }
}

/** Posts { to, subject, text, html } to any HTTP endpoint that delivers mail. */
export class WebhookEmailSender implements EmailSender {
  constructor(
    private url: string,
    private secret?: string,
  ) {}
  async send(msg: EmailMessage): Promise<void> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(this.secret ? { authorization: `Bearer ${this.secret}` } : {}) },
      body: JSON.stringify(msg),
    });
    if (!res.ok) throw new Error(`email webhook answered ${res.status}`);
  }
}

/** A "Name <address>" or bare address, split for APIs that want them apart. */
export function parseFrom(from: string): { name?: string; email: string } {
  const m = /^\s*(.*?)\s*<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/.exec(from);
  if (m) return m[1] ? { name: m[1].replace(/^"|"$/g, ""), email: m[2] } : { email: m[2] };
  return { email: from.trim() };
}

/**
 * Cloudflare Email Service through the Worker's `send_email` binding: no API
 * key, and the from address must be on a domain onboarded to Email Sending.
 */
export class CloudflareEmailSender implements EmailSender {
  constructor(
    private binding: SendEmailBinding,
    private from: string,
  ) {}
  async send(msg: EmailMessage): Promise<void> {
    await this.binding.send({ to: msg.to, from: parseFrom(this.from), subject: msg.subject, text: msg.text, ...(msg.html ? { html: msg.html } : {}) });
  }
}

/** Sends through Resend's HTTP API. Without a verified domain Resend only
 * delivers to the account owner's own address (from onboarding@resend.dev). */
export class ResendEmailSender implements EmailSender {
  constructor(
    private apiKey: string,
    private from: string,
  ) {}
  async send(msg: EmailMessage): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ from: this.from, to: [msg.to], subject: msg.subject, text: msg.text, ...(msg.html ? { html: msg.html } : {}) }),
    });
    if (!res.ok) throw new Error(`email service answered ${res.status}`);
  }
}

/**
 * Tries each sender in turn, so one provider's limit or outage never stops
 * sign-in: the first that accepts the message wins. Fails only when all fail.
 */
export class FallbackEmailSender implements EmailSender {
  constructor(private senders: EmailSender[]) {}
  async send(msg: EmailMessage): Promise<void> {
    const errors: string[] = [];
    for (const s of this.senders) {
      try {
        await s.send(msg);
        return;
      } catch (e) {
        errors.push(e instanceof Error ? `${(e as { code?: string }).code ?? ""} ${e.message}`.trim() : String(e));
      }
    }
    throw new Error(`no email sender delivered the message: ${errors.join("; ")}`);
  }
}

let override: EmailSender | null = null;

/** Tests may install their own sender. */
export function setEmailSender(s: EmailSender | null): void {
  override = s;
}

/** Every configured sender, best first: Cloudflare, then Resend, then a webhook. */
export function emailSender(env: Env): EmailSender {
  if (override) return override;
  const from = env.EMAIL_FROM || "Worlds <onboarding@resend.dev>";
  const chain: EmailSender[] = [];
  if (env.EMAIL && env.EMAIL_FROM) chain.push(new CloudflareEmailSender(env.EMAIL, env.EMAIL_FROM));
  if (env.RESEND_API_KEY) chain.push(new ResendEmailSender(env.RESEND_API_KEY, from));
  if (env.EMAIL_WEBHOOK_URL) chain.push(new WebhookEmailSender(env.EMAIL_WEBHOOK_URL, env.EMAIL_WEBHOOK_SECRET));
  if (chain.length === 1) return chain[0];
  if (chain.length > 1) return new FallbackEmailSender(chain);
  if (env.ENVIRONMENT === "development" || env.ENVIRONMENT === "test") return new DevEmailSender();
  throw new Error("No email sender configured (bind EMAIL, or set RESEND_API_KEY or EMAIL_WEBHOOK_URL)");
}

export type EmailLanguage = "ar" | "en";

/** The person's language for the email: what the app sent, else what the browser or device asks for. */
export function emailLanguage(requested: unknown, acceptLanguage: string | null | undefined): EmailLanguage {
  if (requested === "ar" || requested === "en") return requested;
  return /^\s*ar\b/i.test(acceptLanguage ?? "") ? "ar" : "en";
}

const COPY = {
  en: {
    subject: (code: string) => `${code} is your Worlds sign-in code`,
    heading: "Your sign-in code",
    lead: "Type this code in Worlds to finish signing in.",
    expires: "It works for 10 minutes and only once.",
    ignore: "If you did not ask for it, you can ignore this email. Nobody can sign in to your account without the code.",
    footer: "Worlds keeps your pages on your own device.",
  },
  ar: {
    subject: (code: string) => `رمز دخولك إلى Worlds: ${code}`,
    heading: "رمز الدخول",
    lead: "اكتب هذا الرمز في Worlds لإكمال الدخول.",
    expires: "يعمل لمدة 10 دقائق، ومرة واحدة فقط.",
    ignore: "إذا ما طلبته، تجاهل هذه الرسالة. ما أحد يقدر يدخل حسابك بدون الرمز.",
    footer: "Worlds يحفظ صفحاتك على جهازك.",
  },
} as const;

const SITE = "https://enterworlds.space";

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * The sign-in email (docs/web/DESIGN.md): the code as six separate cells in
 * the app's monospace face, readable and copyable in under five seconds, in
 * the person's language and direction. Built from tables and inline styles,
 * which every mail app renders, with a dark version where it is supported.
 */
export function codeEmail(code: string, lang: EmailLanguage = "en"): { subject: string; text: string; html: string } {
  const t = COPY[lang];
  const dir = lang === "ar" ? "rtl" : "ltr";
  const align = lang === "ar" ? "right" : "left";
  const body = lang === "ar" ? "'IBM Plex Sans Arabic','Segoe UI',Tahoma,sans-serif" : "'Instrument Sans','Segoe UI',Helvetica,Arial,sans-serif";
  const size = lang === "ar" ? 17 : 15;
  const lh = lang === "ar" ? 1.8 : 1.5;
  const cell = (d: string) =>
    `<td class="cell" style="width:44px;height:56px;border:1px solid #d9d9de;border-radius:10px;background:#f5f5f7;color:#1d1d1f;font:500 30px/56px 'IBM Plex Mono',Menlo,Consolas,monospace;text-align:center;">${escape(d)}</td>`;
  const cells = [...code].map(cell).join('<td style="width:8px;"></td>');
  const html = `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escape(t.subject(code))}</title>
<style>
  @media (prefers-color-scheme: dark) {
    .page { background:#111113 !important; }
    .sheet { background:#1c1c1e !important; border-color:#2c2c2e !important; }
    .ink { color:#f5f5f7 !important; }
    .quiet { color:#a7a7b0 !important; }
    .cell { background:#111113 !important; border-color:#2c2c2e !important; color:#f5f5f7 !important; }
    .link { color:#2e92ff !important; }
  }
</style>
</head>
<body class="page" style="margin:0;padding:0;background:#f5f5f7;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escape(`${t.heading}: ${code}. ${t.expires}`)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="page" style="background:#f5f5f7;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="sheet" dir="${dir}" style="max-width:480px;background:#ffffff;border:1px solid #d9d9de;border-radius:16px;">
      <tr><td class="ink" style="padding:28px 28px 0;text-align:${align};color:#1d1d1f;font:600 15px/1.4 'Instrument Sans','Segoe UI',Helvetica,Arial,sans-serif;">Worlds</td></tr>
      <tr><td class="ink" style="padding:20px 28px 0;text-align:${align};color:#1d1d1f;font:600 ${size + 7}px/1.3 ${body};">${escape(t.heading)}</td></tr>
      <tr><td class="quiet" style="padding:8px 28px 0;text-align:${align};color:#5f5f66;font:400 ${size}px/${lh} ${body};">${escape(t.lead)}</td></tr>
      <tr><td align="center" style="padding:24px 28px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" dir="ltr"><tr>${cells}</tr></table>
      </td></tr>
      <tr><td class="ink" style="padding:20px 28px 0;text-align:${align};color:#1d1d1f;font:400 ${size}px/${lh} ${body};">${escape(t.expires)}</td></tr>
      <tr><td class="quiet" style="padding:8px 28px 28px;text-align:${align};color:#5f5f66;font:400 ${size - 1}px/${lh} ${body};">${escape(t.ignore)}</td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}" style="max-width:480px;">
      <tr><td class="quiet" style="padding:16px 28px 0;text-align:${align};color:#5f5f66;font:400 ${size - 2}px/${lh} ${body};">${escape(t.footer)} <a href="${SITE}" class="link" style="color:#0a64c8;text-decoration:none;">enterworlds.space</a></td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
  const text = `${t.heading}: ${code}\n\n${t.lead}\n${t.expires}\n\n${t.ignore}\n\n${SITE}`;
  return { subject: t.subject(code), text, html };
}
