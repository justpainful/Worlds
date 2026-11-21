// Deploys status.enterworlds.space to the Cloudflare account that holds the domain.
//   node services/status/deploy.mjs --account <id>      create or find the database, migrate, deploy
//   node services/status/deploy.mjs --prepare           only copy the fonts and icons, for `wrangler dev`
// The database id and the account go into wrangler.deploy.toml, which git ignores.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, "..", "..", "web", "site");
const wranglerBin = join(here, "..", "identity", "node_modules", ".bin", process.platform === "win32" ? "wrangler.cmd" : "wrangler");
const fail = (m) => { console.error(`status: ${m}`); process.exit(1); };

mkdirSync(join(here, "public", "fonts"), { recursive: true });
for (const f of readdirSync(join(site, "fonts"))) copyFileSync(join(site, "fonts", f), join(here, "public", "fonts", f));
for (const f of ["icon-32.png", "icon-256.png"]) copyFileSync(join(site, f), join(here, "public", f));
writeFileSync(join(here, "public", "_headers"), "/fonts/*\n  Cache-Control: public, max-age=31536000, immutable\n");
if (process.argv.includes("--prepare")) {
  console.log("status: fonts and icons copied into public/");
  process.exit(0);
}

const i = process.argv.indexOf("--account");
const account = i > 0 ? process.argv[i + 1] : process.env.CLOUDFLARE_ACCOUNT_ID;
if (!account || !/^[0-9a-f]{32}$/.test(account)) fail("pass --account <the domain's Cloudflare account id>");
const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: account };
const wrangler = (args, opts = {}) => {
  const r = spawnSync(wranglerBin, args, { cwd: here, env, encoding: "utf8", shell: process.platform === "win32", stdio: opts.capture ? "pipe" : "inherit" });
  if (r.status !== 0) fail(`wrangler ${args.join(" ")} failed${opts.capture ? `:\n${r.stderr}` : ""}`);
  return r.stdout ?? "";
};

const list = JSON.parse(wrangler(["d1", "list", "--json"], { capture: true }));
let db = list.find((d) => d.name === "worlds-status");
if (!db) {
  wrangler(["d1", "create", "worlds-status"]);
  db = JSON.parse(wrangler(["d1", "list", "--json"], { capture: true })).find((d) => d.name === "worlds-status");
  if (!db) fail("the database was not created");
}
const toml = readFileSync(join(here, "wrangler.toml"), "utf8")
  .replace(/^name = .*$/m, (line) => `${line}\naccount_id = ${JSON.stringify(account)}`)
  .replace(/^database_id = .*$/m, `database_id = ${JSON.stringify(db.uuid)}`);
writeFileSync(join(here, "wrangler.deploy.toml"), toml);
wrangler(["d1", "migrations", "apply", "worlds-status", "--remote", "-c", "wrangler.deploy.toml"]);
wrangler(["deploy", "-c", "wrangler.deploy.toml"]);
console.log("status: deployed to https://status.enterworlds.space");
