import { Hono } from "hono";
import type { AppEnv } from "../env";

/**
 * Small browser pages. Passkeys are bound to this service's domain, so the
 * desktop app opens the system browser here for the WebAuthn ceremony and
 * gets the result back on a loopback redirect (RFC 8252).
 */
export const pages = new Hono<AppEnv>();

const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'";

function shell(title: string, bodyHtml: string, script = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; --bg: #f5f5f7; --fg: #1d1d1f; --muted: #6e6e73; --card: #ffffff; --accent: #0a84ff; --danger: #d70015; }
  @media (prefers-color-scheme: dark) { :root { --bg: #000; --fg: #f5f5f7; --muted: #98989d; --card: #1c1c1e; --danger: #ff6961; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg);
         font: 15px/1.45 -apple-system, "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; padding: 16px; }
  main { width: 100%; max-width: 380px; background: var(--card); border-radius: 20px; padding: 32px 28px; text-align: center;
         box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 12px 40px rgba(0,0,0,.08); }
  h1 { font-size: 22px; font-weight: 600; margin: 0 0 8px; letter-spacing: -0.01em; }
  p { margin: 0 0 20px; color: var(--muted); }
  button { appearance: none; border: 0; border-radius: 999px; background: var(--accent); color: #fff; font: inherit; font-weight: 600;
           padding: 11px 22px; cursor: pointer; min-width: 180px; }
  button[disabled] { opacity: .5; cursor: default; }
  #status { min-height: 22px; margin: 16px 0 0; }
  .error { color: var(--danger); }
</style></head><body><main>${bodyHtml}</main>${script ? `<script>${script}</script>` : ""}</body></html>`;
}

const CLIENT = String.raw`
const q = new URLSearchParams(location.search);
const status = document.getElementById("status");
const go = document.getElementById("go");
const say = (t, bad) => { status.textContent = t; status.className = bad ? "error" : ""; };
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s) => { const p = s.replace(/-/g, "+").replace(/_/g, "/"); const b = atob(p + "===".slice((p.length + 3) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
async function post(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || "Something went wrong.");
  return j;
}
function loopback(u) {
  try { const x = new URL(u); return x.protocol === "http:" && (x.hostname === "localhost" || /^127(\.\d{1,3}){3}$/.test(x.hostname) || x.hostname === "[::1]"); } catch { return false; }
}
async function signin() {
  const redirect = q.get("redirect_uri"), state = q.get("state"), challenge = q.get("code_challenge");
  if (!loopback(redirect || "") || !state || !challenge) return say("This link is incomplete. Start again from Worlds.", true);
  const { challengeId, options } = await post("/auth/passkey/login/options", {});
  const cred = await navigator.credentials.get({ publicKey: { ...options, challenge: unb64(options.challenge),
    allowCredentials: (options.allowCredentials || []).map((c) => ({ ...c, id: unb64(c.id) })) } });
  const r = cred.response;
  const response = { id: cred.id, rawId: b64(cred.rawId), type: cred.type, clientExtensionResults: cred.getClientExtensionResults(),
    authenticatorAttachment: cred.authenticatorAttachment, response: { clientDataJSON: b64(r.clientDataJSON), authenticatorData: b64(r.authenticatorData),
    signature: b64(r.signature), userHandle: r.userHandle ? b64(r.userHandle) : undefined } };
  const { code } = await post("/auth/passkey/login/verify", { challengeId, response, handoff: { codeChallenge: challenge } });
  say("Signed in. You can return to Worlds.");
  const back = new URL(redirect); back.searchParams.set("code", code); back.searchParams.set("state", state);
  location.replace(back.toString());
}
async function add() {
  const ticket = q.get("ticket");
  if (!ticket) return say("This link is incomplete. Start again from Worlds.", true);
  const { challengeId, options } = await post("/auth/passkey/register/options", { ticket });
  const cred = await navigator.credentials.create({ publicKey: { ...options, challenge: unb64(options.challenge),
    user: { ...options.user, id: unb64(options.user.id) }, excludeCredentials: (options.excludeCredentials || []).map((c) => ({ ...c, id: unb64(c.id) })) } });
  const r = cred.response;
  const response = { id: cred.id, rawId: b64(cred.rawId), type: cred.type, clientExtensionResults: cred.getClientExtensionResults(),
    authenticatorAttachment: cred.authenticatorAttachment, response: { clientDataJSON: b64(r.clientDataJSON), attestationObject: b64(r.attestationObject),
    transports: r.getTransports ? r.getTransports() : [] } };
  await post("/auth/passkey/register/verify", { ticket, challengeId, response, name: navigator.userAgent.includes("Windows") ? "Windows Hello" : "Passkey" });
  go.hidden = true;
  say("Passkey added. You can close this tab and return to Worlds.");
}
go.addEventListener("click", async () => {
  if (!window.PublicKeyCredential) return say("This browser does not support passkeys.", true);
  go.disabled = true; say("");
  try { await (q.get("mode") === "add" ? add() : signin()); }
  catch (e) { go.disabled = false; say(e && e.name === "NotAllowedError" ? "Cancelled. Try again when you are ready." : (e.message || String(e)), true); }
});
`;

pages.get("/passkey", (c) => {
  const add = c.req.query("mode") === "add";
  const html = shell(
    add ? "Add a passkey" : "Sign in to Worlds",
    `<h1>${add ? "Add a passkey" : "Sign in to Worlds"}</h1>
     <p>${add ? "Save a passkey with Windows Hello or your phone. Next time you sign in with your face, fingerprint or PIN." : "Use your passkey to sign in on this computer."}</p>
     <button id="go" type="button">${add ? "Create passkey" : "Continue with passkey"}</button>
     <p id="status" role="status"></p>`,
    CLIENT,
  );
  return c.html(html, 200, { "content-security-policy": CSP, "referrer-policy": "no-referrer", "cache-control": "no-store" });
});

pages.get("/join/:token", (c) =>
  c.html(
    shell(
      "Join a workspace",
      `<h1>You are invited</h1><p>Open Worlds, choose the workspace menu at the top of the sidebar, pick Join with invite link, and paste this page's address.</p>`,
    ),
    200,
    { "content-security-policy": CSP, "referrer-policy": "no-referrer", "cache-control": "no-store" },
  ),
);
