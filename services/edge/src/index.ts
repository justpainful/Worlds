/**
 * The enterworlds.space edge. It runs on the Cloudflare account that holds the
 * domain, while the account and sync services run on another account (a
 * custom domain can only point at a Worker on its own account):
 *
 *   login.<domain>    -> the identity service, unchanged
 *   connect.<domain>  -> the sync service, WebSockets included
 *   profile.<domain>  -> public profiles at /@username, drawn here (src/profile.ts)
 *   POST login.<domain>/_edge/mail -> sends a sign-in email through Cloudflare
 *                        Email Service from the domain (the identity service's
 *                        EMAIL_WEBHOOK_URL, with EMAIL_WEBHOOK_SECRET)
 *
 * Forwarded requests carry the visitor's IP in x-worlds-client-ip, with
 * EDGE_SECRET in x-worlds-edge so the services can tell it from a forged one.
 */

import { handleProfile } from "./profile";
import { handlePublished, receiveMail, type InboundMessage } from "./pages";

export interface SendEmailBinding {
  send(message: { to: string; from: { email: string; name?: string }; subject: string; text: string; html?: string }): Promise<unknown>;
}

export interface Env {
  EMAIL?: SendEmailBinding;
  /** https://worlds-identity.<name>.workers.dev */
  IDENTITY_ORIGIN: string;
  /** https://worlds-sync.<name>.workers.dev */
  SYNC_ORIGIN: string;
  LOGIN_HOST: string;
  CONNECT_HOST: string;
  /** profile.<domain>; leave empty to turn public profiles off. */
  PROFILE_HOST?: string;
  /** Where "Make yours in Worlds" goes, https://<domain>. */
  SITE_URL?: string;
  /** "Worlds <no-reply@enterworlds.space>" */
  MAIL_FROM: string;
  /** Shared with the services: proves a forwarded request came through here. */
  EDGE_SECRET: string;
  /** Shared with the identity service: allows POST /_edge/mail. */
  MAIL_SECRET: string;
  /** Mail to <key>@<this domain> goes to that person's Worlds (routes/published.ts in identity). */
  MAIL_INBOX_DOMAIN?: string;
}

export const MAIL_PATH = "/_edge/mail";

/** The service origin for a host, or null for any other host. */
export function targetFor(host: string, env: Env): string | null {
  const h = host.toLowerCase();
  if (h === env.LOGIN_HOST.toLowerCase()) return env.IDENTITY_ORIGIN;
  if (h === env.CONNECT_HOST.toLowerCase()) return env.SYNC_ORIGIN;
  return null;
}

/** The request as the service receives it: same method, path, query, headers and body, plus the edge headers. */
export function forwarded(request: Request, target: string, env: Env): Request {
  const url = new URL(request.url);
  const dest = new URL(url.pathname + url.search, target);
  const headers = new Headers(request.headers);
  // Whatever the client sent in these is replaced, never passed on.
  headers.set("x-worlds-edge", env.EDGE_SECRET);
  headers.set("x-worlds-client-ip", request.headers.get("cf-connecting-ip") ?? "");
  headers.set("x-worlds-country", String((request as Request & { cf?: { country?: string } }).cf?.country ?? ""));
  headers.set("x-forwarded-host", url.host);
  const bodyless = request.method === "GET" || request.method === "HEAD";
  // duplex is what the Fetch standard asks for with a streamed body; Workers ignores it.
  const init = { method: request.method, headers, body: bodyless ? null : request.body, redirect: "manual", duplex: "half" };
  return new Request(dest.toString(), init as RequestInit);
}

/** Equal strings in time that does not depend on where they differ. */
export function sameSecret(a: string | null, b: string): boolean {
  if (a === null || b.length === 0 || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function parseFrom(from: string): { name?: string; email: string } {
  const m = /^\s*(.*?)\s*<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/.exec(from);
  if (m) return m[1] ? { name: m[1].replace(/^"|"$/g, ""), email: m[2] } : { email: m[2] };
  return { email: from.trim() };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** POST /_edge/mail: { to, subject, text, html? } with Authorization: Bearer MAIL_SECRET. */
export async function sendMail(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
  const auth = request.headers.get("authorization");
  if (!sameSecret(auth?.startsWith("Bearer ") ? auth.slice(7) : null, env.MAIL_SECRET)) return json(401, { error: "unauthorized" });
  if (!env.EMAIL) return json(503, { error: "email_not_bound" });
  let body: { to?: unknown; subject?: unknown; text?: unknown; html?: unknown };
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }
  const { to, subject, text, html } = body;
  if (typeof to !== "string" || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to) || to.length > 320) return json(400, { error: "invalid_to" });
  if (typeof subject !== "string" || !subject || subject.length > 300) return json(400, { error: "invalid_subject" });
  if (typeof text !== "string" || !text || text.length > 20_000) return json(400, { error: "invalid_text" });
  if (html !== undefined && (typeof html !== "string" || html.length > 200_000)) return json(400, { error: "invalid_html" });
  try {
    await env.EMAIL.send({ to, from: parseFrom(env.MAIL_FROM), subject, text, ...(html ? { html } : {}) });
  } catch (e) {
    // Tell the identity service it failed, so it falls back to the next provider.
    return json(502, { error: "send_failed", code: (e as { code?: string }).code ?? null });
  }
  return json(200, { ok: true });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname.toLowerCase() === env.LOGIN_HOST.toLowerCase() && url.pathname === MAIL_PATH) return sendMail(request, env);
    if (env.PROFILE_HOST && url.hostname.toLowerCase() === env.PROFILE_HOST.toLowerCase()) {
      // Only GETs reach the identity service from here, with the visitor's IP for its rate limit.
      const call = (path: string) => fetch(forwarded(new Request(new URL(path, request.url), { headers: request.headers }), env.IDENTITY_ORIGIN, env));
      // Published pages and share links; share passwords arrive as a POSTed form.
      const callWith = (path: string, init?: RequestInit) =>
        fetch(forwarded(new Request(new URL(path, request.url), { method: init?.method ?? "GET", headers: { ...Object.fromEntries(request.headers), ...((init?.headers as Record<string, string>) ?? {}) }, body: init?.body }), env.IDENTITY_ORIGIN, env));
      const site = env.SITE_URL || `https://${url.host.replace(/^profile\./, "")}`;
      const published = await handlePublished(request, site, callWith);
      if (published) return published;
      return handleProfile(request, env, call);
    }
    const target = targetFor(url.hostname, env);
    if (!target) return new Response("Not found", { status: 404 });
    return fetch(forwarded(request, target, env));
  },

  /** Cloudflare Email Routing: mail to <key>@MAIL_INBOX_DOMAIN goes to its owner's Worlds. */
  async email(message: InboundMessage, env: Env): Promise<void> {
    const domain = (env.MAIL_INBOX_DOMAIN ?? "").toLowerCase();
    if (!domain || !message.to.toLowerCase().endsWith(`@${domain}`)) return message.setReject("Unknown address");
    await receiveMail(message, (body) =>
      fetch(new URL("/published/mail/inbound", env.IDENTITY_ORIGIN).toString(), {
        method: "POST",
        headers: { "content-type": "application/json", "x-worlds-edge": env.EDGE_SECRET },
        body: JSON.stringify(body),
      }),
    );
  },
};
