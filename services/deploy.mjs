#!/usr/bin/env node
/**
 * One command that puts the Worlds account and sync services on your own
 * Cloudflare account and points this PC's Worlds at them:
 *
 *   pnpm cloud:deploy
 *   pnpm cloud:deploy --domain enterworlds.space
 *
 * With a domain on the same Cloudflare account, the services answer at
 * login.<domain> (accounts) and connect.<domain> (sync), and sign-in codes
 * are sent from no-reply@<domain> through Cloudflare Email Service, with
 * Resend as the fallback when a key is given. The domain is remembered.
 *
 * Safe to run again: it reuses what already exists and keeps the same keys,
 * so nobody is signed out. Everything it creates for you (ids, keys) stays in
 * services/.deploy/ and services/<name>/wrangler.deploy.toml, which git ignores.
 */
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";

// Windows runs npx through the shell; the arguments here are fixed, so the
// DEP0190 notice is noise.
process.noDeprecation = true;

const here = dirname(fileURLToPath(import.meta.url));
const ID_DIR = join(here, "identity");
const SYNC_DIR = join(here, "sync");
const STATE_DIR = join(here, ".deploy");
const STATE_FILE = join(STATE_DIR, "state.json");
const isWin = process.platform === "win32";

const say = (s = "") => console.log(s);
const step = (n, s) => say(`\n\x1b[1m${n}. ${s}\x1b[0m`);
const ok = (s) => say(`   \x1b[32mDone:\x1b[0m ${s}`);
const fail = (s) => {
  say(`\n\x1b[31mStopped:\x1b[0m ${s}`);
  process.exit(1);
};

function run(cmd, args, { cwd = here, input, quiet = false, interactive = false } = {}) {
  const r = spawnSync(cmd, args, {
    cwd,
    input,
    shell: isWin,
    encoding: "utf8",
    stdio: interactive ? "inherit" : ["pipe", "pipe", "pipe"],
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (!quiet && !interactive && out.trim()) say(out.trim().split("\n").map((l) => `   ${l}`).join("\n"));
  return { ok: r.status === 0, out };
}
const wrangler = (dir, args, opts = {}) => run("npx", ["wrangler", ...args], { cwd: dir, ...opts });

const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
const save = () => {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
};
const secret = () => randomBytes(32).toString("base64url");

// --domain example.com (or --domain=example.com) moves the services onto it.
const domainArg = (() => {
  const i = process.argv.findIndex((a) => a === "--domain" || a.startsWith("--domain="));
  if (i < 0) return undefined;
  const v = process.argv[i].includes("=") ? process.argv[i].split("=")[1] : process.argv[i + 1];
  return v?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
})();
if (domainArg !== undefined) {
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domainArg)) fail(`"${domainArg}" is not a domain name.`);
  state.domain = domainArg;
}
const HOSTS = state.domain ? { identity: `login.${state.domain}`, sync: `connect.${state.domain}` } : null;

/** A custom domain for the Worker, plus the Email Service binding for the account service. */
const extras = (host, withEmail) =>
  [
    host ? `\n[[routes]]\npattern = ${JSON.stringify(host)}\ncustom_domain = true\n` : "",
    withEmail && state.domain
      ? `\n[[send_email]]\nname = "EMAIL"\nallowed_sender_addresses = [${JSON.stringify(`no-reply@${state.domain}`)}]\n`
      : "",
  ].join("");

/** Copy a wrangler.toml with some values replaced; the copy is git-ignored. */
function writeConfig(dir, edits, extra = "") {
  let toml = readFileSync(join(dir, "wrangler.toml"), "utf8");
  for (const [key, value] of Object.entries(edits)) {
    const re = new RegExp(`^${key} = ".*"$`, "m");
    if (!re.test(toml)) fail(`${key} is missing from ${join(dir, "wrangler.toml")}`);
    toml = toml.replace(re, `${key} = ${JSON.stringify(value)}`);
  }
  const path = join(dir, "wrangler.deploy.toml");
  writeFileSync(path, toml + extra);
  return path;
}

function deploy(dir, label, host) {
  let r = wrangler(dir, ["deploy", "-c", "wrangler.deploy.toml"], { quiet: true });
  if (!r.ok && /workers\.dev subdomain/i.test(r.out)) {
    // A new Cloudflare account has no workers.dev name yet: let Wrangler ask for one.
    say("   Your Cloudflare account needs a workers.dev name (one time).");
    say("   Answer Y, then type any short name, for example worlds-yourname.");
    if (!wrangler(dir, ["deploy", "-c", "wrangler.deploy.toml"], { interactive: true }).ok)
      fail("No workers.dev name was set. Run this again, or pick one in dash.cloudflare.com under Workers & Pages.");
    r = wrangler(dir, ["deploy", "-c", "wrangler.deploy.toml"], { quiet: true });
  }
  if (!r.ok) {
    say(r.out);
    fail(`${label} did not deploy (see above).`);
  }
  // On a custom domain the workers.dev address stays on too, so apps that
  // still point there keep working until they move.
  if (host) {
    if (!r.out.includes(host)) say(`   Note: ${host} was not in Wrangler's output yet. Cloudflare may still be activating the domain.`);
    return `https://${host}`;
  }
  const url = r.out.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/i)?.[0];
  if (!url) fail(`${label} deployed, but its address was not in the output.`);
  return url;
}

say("\x1b[1mWorlds on Cloudflare\x1b[0m");
say("This sets up accounts and live sync on your own Cloudflare account (the free plan is enough).");

step(1, "Tools");
for (const dir of [ID_DIR, SYNC_DIR]) {
  if (!existsSync(join(dir, "node_modules"))) {
    if (!run("pnpm", ["install"], { cwd: dir, quiet: true }).ok) fail(`pnpm install failed in ${dir}`);
  }
}
ok("ready");

step(2, "Cloudflare sign-in");
if (!wrangler(ID_DIR, ["whoami"], { quiet: true }).out.match(/associated with the email|You are logged in/i)) {
  say("   Your browser will open. Sign in to Cloudflare and press Allow.");
  if (!wrangler(ID_DIR, ["login"], { interactive: true }).ok) fail("Cloudflare sign-in did not finish.");
}
ok("signed in");

step(3, "Email for sign-in codes");
if (state.domain) {
  // Cloudflare Email Service sends from the domain itself; this adds its SPF and DKIM records.
  const en = wrangler(ID_DIR, ["email", "sending", "enable", state.domain], { quiet: true });
  if (!en.ok && !/already/i.test(en.out)) {
    say(en.out);
    say(`   Could not turn on Email Sending for ${state.domain}. In dash.cloudflare.com: Email, Email Sending, Onboard domain.`);
    if (!state.resendKey) say("   Until then, the Resend key below sends the codes.");
  }
  state.emailFrom = `Worlds <no-reply@${state.domain}>`;
  if (state.resendKey === undefined) {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    say("   Resend is the fallback when Cloudflare's daily limit is reached or it is down.");
    say(`   Add ${state.domain} in Resend (Domains) so it can send from it too.`);
    state.resendKey = (await rl.question("   Resend API key (press Enter to skip): ")).trim();
    rl.close();
    if (state.resendKey && !state.resendKey.startsWith("re_")) fail("That does not look like a Resend key (they start with re_).");
  }
  save();
} else if (!state.resendKey) {
  say("   Worlds emails a 6-digit code when someone signs in. It sends them through Resend (free).");
  say("   1) Make a free account at https://resend.com");
  say("   2) Open API Keys, press Create API Key, and copy it.");
  // The key is not echoed while it is pasted.
  let muted = false;
  const output = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  process.stdout.write("   Paste the Resend API key here (it stays hidden): ");
  muted = true;
  state.resendKey = (await rl.question("")).trim();
  muted = false;
  process.stdout.write("\n");
  const from = (await rl.question("   Sender address (press Enter to use Resend's test sender): ")).trim();
  rl.close();
  if (!state.resendKey.startsWith("re_")) fail("That does not look like a Resend key (they start with re_).");
  state.emailFrom = from ? (from.includes("<") ? from : `Worlds <${from}>`) : "Worlds <onboarding@resend.dev>";
  save();
}
ok(`codes are sent from ${state.emailFrom}${state.domain ? (state.resendKey ? ", Cloudflare first, then Resend" : " through Cloudflare") : ""}`);
if (state.emailFrom.includes("resend.dev"))
  say("   Note: with Resend's test sender, codes only reach the email you signed up to Resend with. Add your own domain in Resend to invite others.");

step(4, "Keys");
if (!state.jwk) state.jwk = JSON.stringify(generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" }));
state.webhookSecret ??= secret();
state.internalSecret ??= secret();
state.signingSecret ??= secret();
save();
ok("kept in services/.deploy (never uploaded to GitHub)");

step(5, "Database");
let db = wrangler(ID_DIR, ["d1", "list", "--json"], { quiet: true });
let dbId = (() => {
  try {
    return JSON.parse(db.out.slice(db.out.indexOf("["))).find((d) => d.name === "worlds-identity")?.uuid;
  } catch {
    return undefined;
  }
})();
if (!dbId) {
  const c = wrangler(ID_DIR, ["d1", "create", "worlds-identity"]);
  dbId = c.out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
  if (!dbId) fail("Could not create the database.");
}
state.dbId = dbId;
save();
const idVars = (base, syncUrl) => ({
  database_id: dbId,
  ENVIRONMENT: "production",
  WEBAUTHN_RP_ID: base ? new URL(base).hostname : "localhost",
  WEBAUTHN_ORIGIN: base ?? "http://localhost:8787",
  PUBLIC_URL: base ?? "http://localhost:8787",
  SYNC_WEBHOOK_URL: syncUrl ? `${syncUrl}/internal/events` : "",
});
const writeIdentity = () => {
  const path = writeConfig(ID_DIR, idVars(HOSTS ? `https://${HOSTS.identity}` : state.identityUrl, state.syncUrl), extras(HOSTS?.identity, true));
  // EMAIL_FROM is not secret; it goes in [vars].
  const toml = readFileSync(path, "utf8").replace(/^\[vars\]$/m, `[vars]\nEMAIL_FROM = ${JSON.stringify(state.emailFrom)}`);
  writeFileSync(path, toml);
};
writeIdentity();
if (!wrangler(ID_DIR, ["d1", "migrations", "apply", "worlds-identity", "--remote", "-c", "wrangler.deploy.toml"], { input: "y\n" }).ok)
  fail("The database tables could not be created.");
ok("worlds-identity is ready");

step(6, "Account service");
state.identityUrl = deploy(ID_DIR, "The account service", HOSTS?.identity);
save();
const idSecrets = join(STATE_DIR, "identity.secrets.json");
writeFileSync(
  idSecrets,
  JSON.stringify({ JWT_PRIVATE_JWK: state.jwk, SYNC_WEBHOOK_SECRET: state.webhookSecret, ...(state.resendKey ? { RESEND_API_KEY: state.resendKey } : {}) }),
);
if (!wrangler(ID_DIR, ["secret", "bulk", "../.deploy/identity.secrets.json", "-c", "wrangler.deploy.toml"], { quiet: true }).ok) fail("Could not store the account service keys.");
ok(state.identityUrl);

step(7, "Attachment storage");
const r2 = wrangler(SYNC_DIR, ["r2", "bucket", "create", "worlds-attachments"], { quiet: true });
if (!r2.ok && !/already exists|already own/i.test(r2.out)) {
  if (/enable R2|R2 is not enabled|10042/i.test(r2.out))
    fail("R2 storage is off on your account. Open dash.cloudflare.com, choose R2, press Enable (it is free up to 10 GB), then run this again.");
  say(r2.out);
  fail("Could not create the attachment bucket.");
}
ok("worlds-attachments");

step(8, "Sync service");
writeConfig(SYNC_DIR, { JWKS_URL: `${state.identityUrl}/.well-known/jwks.json` }, extras(HOSTS?.sync, false));
state.syncUrl = deploy(SYNC_DIR, "The sync service", HOSTS?.sync);
save();
const syncSecrets = join(STATE_DIR, "sync.secrets.json");
writeFileSync(syncSecrets, JSON.stringify({ INTERNAL_SECRET: state.internalSecret, SIGNING_SECRET: state.signingSecret, SYNC_WEBHOOK_SECRET: state.webhookSecret }));
if (!wrangler(SYNC_DIR, ["secret", "bulk", "../.deploy/sync.secrets.json", "-c", "wrangler.deploy.toml"], { quiet: true }).ok) fail("Could not store the sync service keys.");
ok(state.syncUrl);

step(9, "Connect the two services");
writeIdentity();
deploy(ID_DIR, "The account service", HOSTS?.identity);
ok("removing someone from a workspace now closes their live session at once");

step(10, "Point Worlds on this PC at them");
const dbPath = join(process.env.APPDATA ?? "", "Worlds", "worlds.db");
if (isWin && existsSync(dbPath)) {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const conn = new DatabaseSync(dbPath);
    const put = conn.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    put.run("account.serverUrl", JSON.stringify(state.identityUrl));
    put.run("sync.serverUrl", JSON.stringify(state.syncUrl));
    conn.close();
    ok("saved. Close Worlds and open it again.");
  } catch (e) {
    say(`   Could not write the settings (${e.message}).`);
    say(`   In Worlds: Settings, Account, Server: ${state.identityUrl}`);
  }
} else {
  say(`   In Worlds: Settings, Account, Server: ${state.identityUrl}`);
}

say("\n\x1b[1mAll set.\x1b[0m");
say(`   Accounts: ${state.identityUrl}`);
say(`   Sync:     ${state.syncUrl}`);
say("   In Worlds, open the workspace menu at the top of the sidebar and choose Sign In.");
if (state.domain)
  say("   Passkeys made on the old workers.dev address do not work on the new one. People sign in with the email code once and add a passkey again.");
