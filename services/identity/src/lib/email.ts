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

/** Sends through Brevo's HTTP API (free up to 300 emails a day). The from
 * address must be on a domain authenticated in Brevo. */
export class BrevoEmailSender implements EmailSender {
  constructor(
    private apiKey: string,
    private from: string,
  ) {}
  async send(msg: EmailMessage): Promise<void> {
    const sender = parseFrom(this.from);
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "api-key": this.apiKey },
      body: JSON.stringify({
        sender: sender.name ? { name: sender.name, email: sender.email } : { email: sender.email },
        to: [{ email: msg.to }],
        subject: msg.subject,
        textContent: msg.text,
        ...(msg.html ? { htmlContent: msg.html } : {}),
      }),
    });
    if (!res.ok) throw new Error(`brevo answered ${res.status}`);
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

/**
 * Every configured sender, best first: Cloudflare's binding, then the webhook
 * (which, on enterworlds.space, is Cloudflare Email Service through
 * services/edge on the domain's account), then Resend, then Brevo. Resend
 * (100 a day) and Brevo (300 a day) are both free, so together they carry
 * about 400 codes a day without a paid plan.
 */
export function emailSender(env: Env): EmailSender {
  if (override) return override;
  const from = env.EMAIL_FROM || "Worlds <onboarding@resend.dev>";
  const chain: EmailSender[] = [];
  if (env.EMAIL && env.EMAIL_FROM) chain.push(new CloudflareEmailSender(env.EMAIL, env.EMAIL_FROM));
  if (env.EMAIL_WEBHOOK_URL) chain.push(new WebhookEmailSender(env.EMAIL_WEBHOOK_URL, env.EMAIL_WEBHOOK_SECRET));
  if (env.RESEND_API_KEY) chain.push(new ResendEmailSender(env.RESEND_API_KEY, from));
  if (env.BREVO_API_KEY && env.EMAIL_FROM) chain.push(new BrevoEmailSender(env.BREVO_API_KEY, env.EMAIL_FROM));
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
    caption: "a letter that knows its address",
    heading: "Your sign-in code",
    lead: "Enter it in Worlds to finish signing in.",
    copy: "Double-click the code to copy it, or press and hold it on a phone.",
    expires: "It works for 10 minutes, and only once.",
    ignore: "Didn't ask for it? Let it go. Nobody gets into your account without this code.",
    footer: "Worlds keeps your pages on your own device",
  },
  ar: {
    subject: (code: string) => `رمز دخولك إلى Worlds: ${code}`,
    caption: "رسالة تعرف عنوانها",
    heading: "رمز دخولك",
    lead: "اكتبه في Worlds لتكمل الدخول.",
    copy: "اضغط على الرمز مرتين لنسخه، أو اضغط عليه مطولًا في الجوال.",
    expires: "يعمل لمدة 10 دقائق، ومرة واحدة فقط.",
    ignore: "ما طلبته؟ تجاهله بهدوء. ما أحد يدخل حسابك بدون هذا الرمز.",
    footer: "Worlds يحفظ صفحاتك على جهازك",
  },
} as const;

const SITE = "https://enterworlds.space";
/** Drawings for the email, served by the site (web/site/mail), in the hand-drawn marker style. */
const ART = `${SITE}/mail`;

/** Cream for most of the page, cocoa for words, ink for outlines; red lives only inside the drawings. */
const C = {
  cream: "#FBEFE1",
  cocoa: "#4A1C10",
  cocoaSoft: "#7A4A3A",
  ink: "#2B1D17",
  terracotta: "#A9472A",
  label: "#F7DD72",
};

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * The sign-in email, written like a short letter on cream paper: the drawn
 * envelope with its caption, the code on a yellow label outlined in ink (one
 * piece of text, so a double-click or a long press copies all six digits),
 * and two quiet notes, each beside its own small drawing. Tables and inline
 * styles, which every mail app renders, and a cocoa page in dark mode.
 */
export function codeEmail(code: string, lang: EmailLanguage = "en"): { subject: string; text: string; html: string } {
  const t = COPY[lang];
  const ar = lang === "ar";
  const dir = ar ? "rtl" : "ltr";
  const align = ar ? "right" : "left";
  const sans = ar ? "'IBM Plex Sans Arabic','Segoe UI',Tahoma,Arial,sans-serif" : "Inter,-apple-system,'Segoe UI',Roboto,Arial,sans-serif";
  const serif = ar ? "'Noto Naskh Arabic','Amiri','Traditional Arabic','Times New Roman',serif" : "Georgia,'Iowan Old Style','Times New Roman',serif";
  const size = ar ? 17 : 16;
  const lh = ar ? 1.85 : 1.6;
  const note = (art: string, text: string, font: string, cls: string, color: string) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}"><tr>
      <td width="76" valign="middle" style="width:76px;padding:6px 0;"><img src="${ART}/${art}.png" width="64" alt="" style="display:block;width:64px;height:auto;border:0;"></td>
      <td width="14" style="width:14px;"></td>
      <td class="${cls}" valign="middle" style="text-align:${align};color:${color};font:400 ${size}px/${lh} ${font};">${escape(text)}</td>
    </tr></table>`;
  const html = `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
<title>${escape(t.subject(code))}</title>
<style>
  .code { -webkit-user-select: all; user-select: all; }
  @media (prefers-color-scheme: dark) {
    .page { background:${C.cocoa} !important; }
    .ink { color:${C.cream} !important; }
    .soft { color:#E9CDB7 !important; }
    .caption { color:#F0A98C !important; }
    .rule { border-color:#6E3B29 !important; }
    .link { color:${C.cream} !important; }
  }
</style>
</head>
<body class="page" style="margin:0;padding:0;background:${C.cream};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escape(`${t.heading}: ${code}. ${t.expires}`)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="page" style="background:${C.cream};">
  <tr><td align="center" style="padding:32px 20px 40px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}" style="max-width:460px;">
      <tr><td align="center" style="padding-bottom:24px;">
        <table role="presentation" cellpadding="0" cellspacing="0" dir="ltr"><tr>
          <td valign="middle"><img src="${ART}/worlds.png" width="40" height="40" alt="Worlds" style="display:block;width:40px;height:40px;border:0;border-radius:10px;"></td>
          <td width="10" style="width:10px;"></td>
          <td valign="middle" class="ink" style="color:${C.cocoa};font:400 22px/1 Georgia,'Iowan Old Style','Times New Roman',serif;">Worlds</td>
        </tr></table>
      </td></tr>
      <tr><td align="center"><img src="${ART}/letter.png" width="250" alt="" style="display:block;width:250px;max-width:100%;height:auto;border:0;"></td></tr>
      <tr><td align="center" class="caption" style="padding-top:4px;color:${C.terracotta};font:${ar ? "normal" : "italic"} 400 14px/1.5 ${serif};">${escape(t.caption)}</td></tr>
      <tr><td align="center" class="ink" style="padding-top:26px;color:${C.cocoa};font:400 ${size + 14}px/1.3 ${serif};">${escape(t.heading)}</td></tr>
      <tr><td align="center" class="soft" style="padding-top:8px;color:${C.cocoaSoft};font:400 ${size}px/${lh} ${sans};">${escape(t.lead)}</td></tr>
      <tr><td align="center" style="padding-top:22px;">
        <table role="presentation" cellpadding="0" cellspacing="0" dir="ltr"><tr>
          <td class="code" align="center" style="padding:14px 18px 14px 28px;background:${C.label};border:3px solid ${C.ink};border-radius:12px;color:${C.ink};font:700 40px/1.1 ${sans};letter-spacing:10px;font-variant-numeric:tabular-nums;">${escape(code)}</td>
        </tr></table>
        <div style="width:200px;height:8px;margin:8px auto 0;border-radius:50%;background:#878787;opacity:0.3;font-size:0;line-height:0;">&nbsp;</div>
      </td></tr>
      <tr><td align="center" class="soft" style="padding-top:12px;color:${C.cocoaSoft};font:400 ${size - 3}px/1.5 ${sans};">${escape(t.copy)}</td></tr>
      <tr><td style="padding-top:30px;"><div class="rule" style="border-top:1px solid #E3D3BD;font-size:0;line-height:0;">&nbsp;</div></td></tr>
      <tr><td style="padding-top:18px;">
        ${note("hourglass", t.expires, sans, "ink", C.cocoa)}
        ${note("padlock", t.ignore, serif, "soft", C.cocoaSoft)}
      </td></tr>
      <tr><td align="center" class="soft" style="padding-top:28px;color:${C.cocoaSoft};font:400 ${size - 3}px/${lh} ${sans};">${escape(t.footer)} · <a href="${SITE}" class="link" style="color:${C.cocoa};text-decoration:underline;">enterworlds.space</a></td></tr>
      <tr><td align="center" style="padding-top:22px;"><img src="${ART}/imbue.png" width="96" alt="imbue" style="display:block;width:96px;height:auto;border:0;"></td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
  const text = `${t.heading}: ${code}\n\n${t.lead}\n${t.expires}\n\n${t.ignore}\n\n${SITE}`;
  return { subject: t.subject(code), text, html };
}
