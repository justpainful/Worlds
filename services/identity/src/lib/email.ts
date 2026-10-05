import type { Env } from "../env";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
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

/** Posts { to, subject, text } to any HTTP endpoint that delivers mail. */
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
      body: JSON.stringify({ from: this.from, to: [msg.to], subject: msg.subject, text: msg.text }),
    });
    if (!res.ok) throw new Error(`email service answered ${res.status}`);
  }
}

let override: EmailSender | null = null;

/** Tests may install their own sender. */
export function setEmailSender(s: EmailSender | null): void {
  override = s;
}

export function emailSender(env: Env): EmailSender {
  if (override) return override;
  if (env.EMAIL_WEBHOOK_URL) return new WebhookEmailSender(env.EMAIL_WEBHOOK_URL, env.EMAIL_WEBHOOK_SECRET);
  if (env.RESEND_API_KEY) return new ResendEmailSender(env.RESEND_API_KEY, env.EMAIL_FROM || "Worlds <onboarding@resend.dev>");
  if (env.ENVIRONMENT === "development" || env.ENVIRONMENT === "test") return new DevEmailSender();
  throw new Error("No email sender configured (set RESEND_API_KEY or EMAIL_WEBHOOK_URL)");
}

export function codeEmail(code: string): { subject: string; text: string } {
  return {
    subject: `${code} is your Worlds code`,
    text: `Your Worlds sign-in code is ${code}.\n\nIt expires in 10 minutes. If you did not ask for it, you can ignore this email.`,
  };
}
