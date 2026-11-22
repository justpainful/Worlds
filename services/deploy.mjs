#!/usr/bin/env node
/**
 * One command that puts the Worlds account and sync services on your own
 * Cloudflare account and points this PC's Worlds at them:
 *
 *   pnpm cloud:deploy
 *   pnpm cloud:deploy --domain enterworlds.space
 *   pnpm cloud:deploy --domain enterworlds.space --edge-account <account id>
 *
 * With a domain on the same Cloudflare account, the services answer at
 * login.<domain> (accounts) and connect.<domain> (sync), and sign-in codes
 * are sent from no-reply@<domain> through Cloudflare Email Service, with
 * Resend as the fallback when a key is given. The domain is remembered.
 *
 * When the domain is on another Cloudflare account than the services (a
 * custom domain can only point at a Worker on its own account), add
 * --edge-account with that account's id: the services stay where they are,
 * and services/edge goes on the domain's account to forward login.<domain>
 * and connect.<domain> to them and send the codes from the domain. The
 * Cloudflare user signed in to Wrangler must be a member of both accounts.
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

function run(cmd, args, { cwd = here, input, quiet = false, interactive = false, env } = {}) {
  const r = spawnSync(cmd, args, {
    cwd,
    input,
    env: env ? { ...process.env, ...env } : process.env,
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

/** Asks in the terminal without echoing what is pasted. */
async function hiddenQuestion(prompt) {
  let muted = false;
  const output = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  process.stdout.write(prompt);
  muted = true;
  const answer = (await rl.question("")).trim();
  muted = false;
  process.stdout.write("\n");
  rl.close();
  return answer;
}

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
const edgeArg = (() => {
  const i = process.argv.findIndex((a) => a === "--edge-account" || a.startsWith("--edge-account="));
  if (i < 0) return undefined;
  return (process.argv[i].includes("=") ? process.argv[i].split("=")[1] : process.argv[i + 1])?.trim().toLowerCase();
})();
if (edgeArg !== undefined) {
  if (!/^[0-9a-f]{32}$/.test(edgeArg)) fail(`"${edgeArg}" is not a Cloudflare account id (32 letters and digits, shown in the dashboard's address).`);
  state.edgeAccount = edgeArg;
}
const HOSTS = state.domain ? { identity: `login.${state.domain}`, sync: `connect.${state.domain}` } : null;
// The domain on its own account: the services stay on workers.dev behind services/edge.
const EDGE = HOSTS && state.edgeAccount ? { account: state.edgeAccount, mailUrl: `https://${HOSTS.identity}/_edge/mail` } : null;
const EDGE_DIR = join(here, "edge");
const onEdgeAccount = EDGE ? { CLOUDFLARE_ACCOUNT_ID: EDGE.account } : undefined;
const publicIdentity = () => (HOSTS ? `https://${HOSTS.identity}` : state.identityUrl);
const publicSync = () => (HOSTS ? `https://${HOSTS.sync}` : state.syncUrl);

/** A custom domain for the Worker, plus the Email Service binding for the account service (same account only). */
const extras = (host, withEmail) =>
  EDGE ? "" : [
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

function deploy(dir, label, host, config = "wrangler.deploy.toml", env) {
  let r = wrangler(dir, ["deploy", "-c", config], { quiet: true, env });
  if (!r.ok && /workers\.dev subdomain/i.test(r.out)) {
    // A new Cloudflare account has no workers.dev name yet: let Wrangler ask for one.
    say("   Your Cloudflare account needs a workers.dev name (one time).");
    say("   Answer Y, then type any short name, for example worlds-yourname.");
    if (!wrangler(dir, ["deploy", "-c", config], { interactive: true, env }).ok)
      fail("No workers.dev name was set. Run this again, or pick one in dash.cloudflare.com under Workers & Pages.");
    r = wrangler(dir, ["deploy", "-c", config], { quiet: true, env });
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
let who = wrangler(ID_DIR, ["whoami"], { quiet: true });
if (!who.out.match(/associated with the email|You are logged in/i)) {
  say("   Your browser will open. Sign in to Cloudflare and press Allow.");
  if (!wrangler(ID_DIR, ["login"], { interactive: true }).ok) fail("Cloudflare sign-in did not finish.");
  who = wrangler(ID_DIR, ["whoami"], { quiet: true });
}
// The services' account is remembered, so a sign-in that sees more than one
// account (the domain's too) still deploys them where they already are.
const accounts = [...who.out.matchAll(/│\s*([^│\n]+?)\s*│\s*([0-9a-f]{32})\s*│/g)].map((m) => ({ name: m[1], id: m[2] }));
if (!state.servicesAccount) {
  const candidates = accounts.filter((a) => a.id !== state.edgeAccount);
  if (candidates.length === 1) state.servicesAccount = candidates[0].id;
  else if (candidates.length > 1)
    fail(`This sign-in sees several Cloudflare accounts. Set servicesAccount in services/.deploy/state.json to one of: ${candidates.map((a) => `${a.name} (${a.id})`).join(", ")}.`);
  save();
}
if (state.servicesAccount) process.env.CLOUDFLARE_ACCOUNT_ID = state.servicesAccount;
if (EDGE && accounts.length && !accounts.some((a) => a.id === EDGE.account))
  fail(`This Cloudflare sign-in cannot reach the domain's account ${EDGE.account}. Add this user to that account (Manage Account, Members) and run this again.`);
ok("signed in");

step(3, "Email for sign-in codes");
if (state.domain) {
  // Cloudflare Email Service sends from the domain itself; this adds its SPF and DKIM records.
  const en = wrangler(ID_DIR, ["email", "sending", "enable", state.domain], { quiet: true, env: onEdgeAccount });
  if (!en.ok && !/already/i.test(en.out)) {
    say(en.out);
    say(`   Could not turn on Email Sending for ${state.domain}. It needs the Workers Paid plan on that account; then in dash.cloudflare.com: Email Service, Email Sending, Onboard domain.`);
    if (!state.resendKey) say("   Until then, the Resend key below sends the codes.");
  }
  state.domainFrom = `Worlds <no-reply@${state.domain}>`;
  // Resend and Brevo send from the domain once it is verified with both
  // (run once with --domain-verified; it is remembered). Until then Resend
  // keeps its own test sender, so a fallback never uses an address it refuses.
  if (process.argv.includes("--domain-verified")) state.domainVerified = true;
  // --new-email-keys asks for the Resend and Brevo keys again (a new account).
  if (process.argv.includes("--new-email-keys")) {
    if (!process.stdin.isTTY) fail("--new-email-keys asks for the keys, so run it in a terminal.");
    delete state.resendKey;
    delete state.brevoKey;
  }
  if (!EDGE || state.domainVerified || !state.resendKey || !state.emailFrom) state.emailFrom = state.domainFrom;
  // Keys are only asked for in a terminal, and never echoed.
  if (process.stdin.isTTY) {
    if (state.resendKey === undefined) {
      say(`   Resend sends the codes for free (100 a day). Add ${state.domain} in Resend, Domains.`);
      state.resendKey = await hiddenQuestion("   Resend API key (press Enter to skip): ");
      if (state.resendKey && !state.resendKey.startsWith("re_")) fail("That does not look like a Resend key (they start with re_).");
    }
    if (state.brevoKey === undefined) {
      say(`   Brevo takes over when Resend's daily limit is reached (free, 300 a day). Add ${state.domain} in Brevo, Senders, Domains.`);
      state.brevoKey = await hiddenQuestion("   Brevo API key (press Enter to skip): ");
      if (state.brevoKey && !state.brevoKey.startsWith("xkeysib-")) fail("That does not look like a Brevo API key (they start with xkeysib-).");
    }
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
ok(
  state.domain
    ? `codes are sent from ${state.domainFrom} through Cloudflare${state.resendKey ? `, then Resend from ${state.emailFrom}` : ""}${state.brevoKey && state.emailFrom === state.domainFrom ? ", then Brevo" : ""}`
    : `codes are sent from ${state.emailFrom}`,
);
if (state.emailFrom.includes("resend.dev"))
  say("   Note: with Resend's test sender, codes only reach the email you signed up to Resend with. Add your own domain in Resend to invite others.");

step(4, "Keys");
if (!state.jwk) state.jwk = JSON.stringify(generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" }));
state.webhookSecret ??= secret();
state.internalSecret ??= secret();
state.signingSecret ??= secret();
if (EDGE) {
  state.edgeSecret ??= secret();
  state.mailSecret ??= secret();
}
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
  // Worlds on the web signs in from the browser (src/account/webAccount.ts).
  ALLOWED_ORIGINS: state.domain ? `https://app.${state.domain},https://${state.domain},https://admin.${state.domain}` : "",
  // The control dashboard signs in with the same passkeys (WebAuthn related origins).
  WEBAUTHN_RELATED_ORIGINS: state.domain ? `https://admin.${state.domain}` : "",
});
const writeIdentity = () => {
  const path = writeConfig(ID_DIR, idVars(HOSTS ? `https://${HOSTS.identity}` : state.identityUrl, state.syncUrl), extras(HOSTS?.identity, true));
  // EMAIL_FROM is not secret; it goes in [vars].
  const extraVars = [
    `EMAIL_FROM = ${JSON.stringify(state.emailFrom)}`,
    ...(EDGE ? [`EMAIL_WEBHOOK_URL = ${JSON.stringify(EDGE.mailUrl)}`] : []),
    // Email to Worlds: each person's address is <key>@<domain>; Email Routing's catch-all hands it to the edge.
    ...(state.domain ? [`MAIL_INBOX_DOMAIN = ${JSON.stringify(state.domain)}`] : []),
    // The dashboard's owners: account ids, set once in services/.deploy/state.json ("adminOwners").
    ...(state.adminOwners ? [`ADMIN_OWNERS = ${JSON.stringify(state.adminOwners)}`] : []),
  ];
  const toml = readFileSync(path, "utf8").replace(/^\[vars\]$/m, `[vars]\n${extraVars.join("\n")}`);
  writeFileSync(path, toml);
};
writeIdentity();
if (!wrangler(ID_DIR, ["d1", "migrations", "apply", "worlds-identity", "--remote", "-c", "wrangler.deploy.toml"], { input: "y\n" }).ok)
  fail("The database tables could not be created.");
ok("worlds-identity is ready");

step("5b", "Profile pictures");
// Public profiles keep their pictures here (services/identity/src/routes/profiles.ts).
const profilesBucket = wrangler(ID_DIR, ["r2", "bucket", "create", "worlds-profiles"], { quiet: true });
if (!profilesBucket.ok && !/already exists|already own/i.test(profilesBucket.out)) {
  if (/enable R2|R2 is not enabled|10042/i.test(profilesBucket.out))
    fail("R2 storage is off on your account. Open dash.cloudflare.com, choose R2, press Enable (it is free up to 10 GB), then run this again.");
  say(profilesBucket.out);
  fail("Could not create the profile picture bucket.");
}
ok("worlds-profiles");

step(6, "Account service");
state.identityUrl = deploy(ID_DIR, "The account service", EDGE ? undefined : HOSTS?.identity);
save();
const idSecrets = join(STATE_DIR, "identity.secrets.json");
writeFileSync(
  idSecrets,
  JSON.stringify({
    JWT_PRIVATE_JWK: state.jwk,
    SYNC_WEBHOOK_SECRET: state.webhookSecret,
    ...(state.resendKey ? { RESEND_API_KEY: state.resendKey } : {}),
    ...(state.brevoKey ? { BREVO_API_KEY: state.brevoKey } : {}),
    ...(EDGE ? { EDGE_SECRET: state.edgeSecret, EMAIL_WEBHOOK_SECRET: state.mailSecret } : {}),
  }),
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
writeConfig(SYNC_DIR, { JWKS_URL: `${state.identityUrl}/.well-known/jwks.json`, PUBLIC_URL: HOSTS ? `https://${HOSTS.sync}` : "" }, extras(HOSTS?.sync, false));
state.syncUrl = deploy(SYNC_DIR, "The sync service", EDGE ? undefined : HOSTS?.sync);
save();
const syncSecrets = join(STATE_DIR, "sync.secrets.json");
writeFileSync(syncSecrets, JSON.stringify({ INTERNAL_SECRET: state.internalSecret, SIGNING_SECRET: state.signingSecret, SYNC_WEBHOOK_SECRET: state.webhookSecret }));
if (!wrangler(SYNC_DIR, ["secret", "bulk", "../.deploy/sync.secrets.json", "-c", "wrangler.deploy.toml"], { quiet: true }).ok) fail("Could not store the sync service keys.");
ok(state.syncUrl);

step(9, "Connect the two services");
writeIdentity();
deploy(ID_DIR, "The account service", EDGE ? undefined : HOSTS?.identity);
ok("removing someone from a workspace now closes their live session at once");

if (EDGE) {
  step("9b", `The ${state.domain} edge`);
  let toml = readFileSync(join(EDGE_DIR, "wrangler.toml"), "utf8");
  const vars = {
    IDENTITY_ORIGIN: state.identityUrl,
    SYNC_ORIGIN: state.syncUrl,
    LOGIN_HOST: HOSTS.identity,
    CONNECT_HOST: HOSTS.sync,
    PROFILE_HOST: `profile.${state.domain}`,
    SITE_URL: `https://${state.domain}`,
    MAIL_FROM: state.domainFrom,
    MAIL_INBOX_DOMAIN: state.domain,
  };
  for (const [key, value] of Object.entries(vars)) toml = toml.replace(new RegExp(`^${key} = ".*"$`, "m"), `${key} = ${JSON.stringify(value)}`);
  toml = toml.replace(/^name = .*$/m, (line) => `${line}\naccount_id = ${JSON.stringify(EDGE.account)}`);
  toml +=
    `\n[[routes]]\npattern = ${JSON.stringify(HOSTS.identity)}\ncustom_domain = true\n` +
    `\n[[routes]]\npattern = ${JSON.stringify(HOSTS.sync)}\ncustom_domain = true\n` +
    `\n[[routes]]\npattern = ${JSON.stringify(`profile.${state.domain}`)}\ncustom_domain = true\n` +
    `\n[[send_email]]\nname = "EMAIL"\nallowed_sender_addresses = [${JSON.stringify(`no-reply@${state.domain}`)}]\n`;
  writeFileSync(join(EDGE_DIR, "wrangler.deploy.toml"), toml);
  deploy(ID_DIR, "The edge", HOSTS.identity, "../edge/wrangler.deploy.toml", onEdgeAccount);
  writeFileSync(join(STATE_DIR, "edge.secrets.json"), JSON.stringify({ EDGE_SECRET: state.edgeSecret, MAIL_SECRET: state.mailSecret }));
  if (!wrangler(ID_DIR, ["secret", "bulk", "../.deploy/edge.secrets.json", "-c", "../edge/wrangler.deploy.toml"], { quiet: true, env: onEdgeAccount }).ok)
    fail("Could not store the edge keys.");
  ok(`${HOSTS.identity} and ${HOSTS.sync} forward to the services, profile.${state.domain} shows public profiles; codes are sent from no-reply@${state.domain}`);
}

step(10, "Point Worlds on this PC at them");
const dbPath = join(process.env.APPDATA ?? "", "Worlds", "worlds.db");
if (isWin && existsSync(dbPath)) {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const conn = new DatabaseSync(dbPath);
    const put = conn.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    put.run("account.serverUrl", JSON.stringify(publicIdentity()));
    put.run("sync.serverUrl", JSON.stringify(publicSync()));
    conn.close();
    ok("saved. Close Worlds and open it again.");
  } catch (e) {
    say(`   Could not write the settings (${e.message}).`);
    say(`   In Worlds: Settings, Account, Server: ${publicIdentity()}`);
  }
} else {
  say(`   In Worlds: Settings, Account, Server: ${publicIdentity()}`);
}

say("\n\x1b[1mAll set.\x1b[0m");
say(`   Accounts: ${publicIdentity()}`);
say(`   Sync:     ${publicSync()}`);
say("   In Worlds, open the workspace menu at the top of the sidebar and choose Sign In.");
if (state.domain)
  say("   Passkeys made on the old workers.dev address do not work on the new one. People sign in with the email code once and add a passkey again.");
