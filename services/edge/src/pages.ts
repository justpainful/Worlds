/**
 * Pages published from Worlds, drawn on profile.<domain>:
 *
 *   /@username/<slug>   a page on a public profile
 *   /s/<slug>           a share link, with a password form when it has one
 *
 * The page HTML comes from the identity service (/published/...). It is
 * shown under a policy that runs no scripts and loads pictures only over
 * https, so what was published can only be read.
 */

const POLICY = "default-src 'none'; img-src https: data:; media-src https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const HEADERS = { "content-type": "text/html; charset=utf-8", "content-security-policy": POLICY, "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The published HTML with anything that could run or load removed, for safety beyond the policy. */
export function clean(html: string): string {
  return html
    .replace(/<(script|style|iframe|object|embed|form|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/?(script|style|iframe|object|embed|form|link|meta|base|noscript|template)\b[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"');
}

function page(title: string, lang: string, inner: string, site: string, by = ""): string {
  const ar = lang === "ar";
  return `<!doctype html><html lang="${ar ? "ar" : "en"}"${ar ? ' dir="rtl"' : ""}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><meta name="robots" content="noindex">
<style>
:root{color-scheme:light dark;--bg:#fbfbfd;--ink:#1d1d1f;--dim:#6e6e73;--line:rgba(0,0,0,.1);--accent:#0a7aff}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--ink:#f5f5f7;--dim:#a1a1a6;--line:rgba(255,255,255,.12);--accent:#3b9bff}}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.7 -apple-system,"Segoe UI",system-ui,"IBM Plex Sans Arabic",sans-serif}
main{max-width:720px;margin:0 auto;padding:56px 22px 80px}
h1{font-size:36px;line-height:1.2;letter-spacing:-.02em;margin:0 0 6px}
.by{color:var(--dim);font-size:14px;margin-bottom:28px}
h2{font-size:24px;margin:1.6em 0 .4em}h3{font-size:19px;margin:1.4em 0 .3em}
blockquote{margin:1em 0;padding-inline-start:16px;border-inline-start:3px solid var(--line);color:var(--dim)}
pre{white-space:pre-wrap;background:rgba(127,127,127,.12);padding:12px 14px;border-radius:12px;font-size:14px}
table{border-collapse:collapse;width:100%}td{border:1px solid var(--line);padding:6px 10px}
img{max-width:100%;border-radius:12px}a{color:var(--accent)}
footer{margin-top:60px;color:var(--dim);font-size:13px}
form{display:flex;gap:8px;margin-top:20px}input{flex:1;font:inherit;padding:10px 14px;border-radius:12px;border:1px solid var(--line);background:transparent;color:inherit}
button{font:inherit;padding:10px 18px;border:0;border-radius:999px;background:var(--accent);color:#fff}
</style></head><body><main>${inner}<footer>${ar ? "صُنعت في" : "Made in"} <a href="${esc(site)}">Worlds</a>${by ? ` · ${esc(by)}` : ""}</footer></main></body></html>`;
}

const html = (status: number, body: string, cache = "public, max-age=60") => new Response(body, { status, headers: { ...HEADERS, "cache-control": cache } });

const missing = (site: string) => html(404, page("Not found", "en", "<h1>This page is not here</h1><p>It was never published, or it has been taken down or has ended.</p>", site), "no-store");

/** Handle /@username/<slug> and /s/<slug>; null when the path is neither. */
export async function handlePublished(request: Request, site: string, call: (path: string, init?: RequestInit) => Promise<Response>): Promise<Response | null> {
  const url = new URL(request.url);
  const path = decodeURIComponent(url.pathname);
  const pub = /^\/@([a-z0-9._]{3,20})\/([a-z0-9][a-z0-9-]{0,63})\/?$/.exec(path);
  if (pub) {
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    const r = await call(`/published/page/${pub[1]}/${pub[2]}`);
    if (!r.ok) return missing(site);
    const p = (await r.json()) as { title: string; html: string; lang: string; author: string; username: string };
    const inner = `<h1>${esc(p.title)}</h1><div class="by"><a href="/@${esc(p.username)}">${esc(p.author || `@${p.username}`)}</a></div>${clean(p.html)}`;
    return html(200, page(p.title, p.lang, inner, site));
  }
  const share = /^\/s\/([a-z0-9]{6,64})\/?$/.exec(path);
  if (share) {
    let password: string | undefined;
    if (request.method === "POST") {
      const form = await request.formData().catch(() => null);
      const v = form?.get("password");
      password = typeof v === "string" ? v.slice(0, 200) : undefined;
    } else if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    const r = await call(`/published/share/${share[1]}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(password ? { password } : {}) });
    if (r.status === 401) {
      const ask = `<h1>🔒</h1><p>This page is protected. Enter its password to read it.</p><p dir="rtl" lang="ar">هذه الصفحة محمية. اكتب كلمة مرورها لقراءتها.</p><form method="post"><input type="password" name="password" autofocus placeholder="Password" aria-label="Password"><button>Open</button></form>${password ? '<p style="color:#e5534b">That password is not right.</p>' : ""}`;
      return html(401, page("Protected page", "en", ask, site), "no-store");
    }
    if (!r.ok) return missing(site);
    const p = (await r.json()) as { title: string; html: string; lang: string; expiresAt: number | null };
    const until = p.expiresAt ? `<div class="by">${p.lang === "ar" ? "متاحة حتى" : "Available until"} ${new Date(p.expiresAt).toISOString().slice(0, 10)}</div>` : "";
    return html(200, page(p.title, p.lang, `<h1>${esc(p.title)}</h1>${until}${clean(p.html)}`, site), "private, no-store");
  }
  return null;
}

// ---------------------------------------------------------------------------
// Inbound email
// ---------------------------------------------------------------------------

export interface InboundMessage {
  from: string;
  to: string;
  headers: Headers;
  raw: ReadableStream<Uint8Array>;
  setReject(reason: string): void;
}

function decodeWords(s: string): string {
  return s.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset: string, enc: string, text: string) => {
    try {
      const bytes = enc.toUpperCase() === "B" ? Uint8Array.from(atob(text), (c) => c.charCodeAt(0)) : qpBytes(text.replace(/_/g, " "));
      return new TextDecoder(charset).decode(bytes);
    } catch {
      return text;
    }
  });
}

function qpBytes(s: string): Uint8Array {
  const out: number[] = [];
  const t = s.replace(/=\r?\n/g, "");
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(t.slice(i + 1, i + 3))) {
      out.push(parseInt(t.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(t.charCodeAt(i) & 0xff);
  }
  return new Uint8Array(out);
}

/** The plain text of a MIME message: the first text/plain part, or text/html stripped. */
export function plainText(raw: string): string {
  const split = (part: string) => {
    const i = part.search(/\r?\n\r?\n/);
    return i < 0 ? { head: part, body: "" } : { head: part.slice(0, i), body: part.slice(i).replace(/^\r?\n\r?\n/, "") };
  };
  const decode = (head: string, body: string) => {
    const enc = /content-transfer-encoding:\s*([\w-]+)/i.exec(head)?.[1]?.toLowerCase();
    const charset = /charset="?([\w-]+)"?/i.exec(head)?.[1] ?? "utf-8";
    let bytes: Uint8Array;
    if (enc === "base64") bytes = Uint8Array.from(atob(body.replace(/\s+/g, "")), (c) => c.charCodeAt(0));
    else if (enc === "quoted-printable") bytes = qpBytes(body);
    else bytes = Uint8Array.from(body, (c) => c.charCodeAt(0) & 0xff);
    try {
      return new TextDecoder(charset).decode(bytes);
    } catch {
      return new TextDecoder().decode(bytes);
    }
  };
  const walk = (part: string): { text?: string; html?: string } => {
    const { head, body } = split(part);
    const type = /content-type:\s*([^;\r\n]+)/i.exec(head)?.[1]?.trim().toLowerCase() ?? "text/plain";
    if (type.startsWith("multipart/")) {
      const boundary = /boundary="?([^";\r\n]+)"?/i.exec(head)?.[1];
      if (!boundary) return {};
      const found: { text?: string; html?: string } = {};
      for (const p of body.split(`--${boundary}`).slice(1)) {
        if (p.startsWith("--")) break;
        const r = walk(p.replace(/^\r?\n/, ""));
        found.text ??= r.text;
        found.html ??= r.html;
      }
      return found;
    }
    if (type === "text/plain") return { text: decode(head, body) };
    if (type === "text/html") return { html: decode(head, body) };
    return {};
  };
  const r = walk(raw);
  if (r.text) return r.text.trim();
  if (r.html)
    return r.html
      .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  return "";
}

/** Hand mail for the inbox domain to the identity service, which files it for its owner. */
export async function receiveMail(message: InboundMessage, forward: (body: unknown) => Promise<Response>) {
  const raw = await new Response(message.raw).text();
  if (raw.length > 5_000_000) return message.setReject("Message too large");
  const subject = decodeWords(message.headers.get("subject") ?? "");
  const text = plainText(raw);
  const r = await forward({ to: message.to, from: message.from, subject, text });
  if (r.status === 404) message.setReject("Unknown address");
}
