#!/usr/bin/env node
// Moves the website's download facts from one published release to the next:
// file names, sizes and SHA-256 fingerprints, read from the two GitHub
// releases. Run it after the new release is published, then rebuild the site.
//
//   node scripts/site-release.mjs 0.3.2 1.0.0 [--date-ar "21 نوفمبر 2026"] [--date-en "21 November 2026"]
//
// New rows can hold @@size:<suffix>@@ and @@sha:<suffix>@@, where the suffix
// is the file name after "Worlds-<version>-", e.g. Linux-amd64.deb.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const [oldV, newV] = process.argv.slice(2);
if (!oldV || !newV) {
  console.error("usage: node scripts/site-release.mjs <old version> <new version>");
  process.exit(1);
}
const flag = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};

const gh = (...args) => execFileSync("gh", args, { encoding: "utf8" });

function release(v) {
  const assets = JSON.parse(gh("release", "view", `v${v}`, "--json", "assets")).assets;
  const prefix = `Worlds-${v}-`;
  const size = {};
  for (const a of assets) if (a.name.startsWith(prefix)) size[a.name.slice(prefix.length)] = a.size;
  const sums = gh("release", "download", `v${v}`, "-p", "SHA256SUMS.txt", "-O", "-");
  const sha = {};
  for (const line of sums.split(/\r?\n/)) {
    const m = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/);
    if (m && m[2].startsWith(prefix)) sha[m[2].slice(prefix.length)] = m[1];
  }
  return { size, sha };
}

const mb = (bytes) => {
  const v = bytes / 1048576;
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} MB`;
};

const before = release(oldV);
const after = release(newV);

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".html") && !p.endsWith("story.html")) files.push(p);
  }
})("web/content");

const left = [];
for (const p of files) {
  let s = readFileSync(p, "utf8");
  const start = s;

  // Sizes, line by line: a line that names a file gets that file's new size.
  s = s
    .split("\n")
    .map((line) => {
      for (const [suffix, bytes] of Object.entries(before.size)) {
        if (!line.includes(`Worlds-${oldV}-${suffix}`) || !after.size[suffix]) continue;
        line = line.replace(mb(bytes), mb(after.size[suffix]));
      }
      return line;
    })
    .join("\n");

  // A size on its own line: only when the old figure belongs to one file.
  const owners = {};
  for (const [suffix, bytes] of Object.entries(before.size)) (owners[mb(bytes)] ??= []).push(suffix);
  for (const [text, suffixes] of Object.entries(owners)) {
    const next = new Set(suffixes.map((x) => after.size[x] && mb(after.size[x])));
    if (next.size === 1 && [...next][0]) s = s.replaceAll(`<dd>${text}</dd>`, `<dd>${[...next][0]}</dd>`);
  }

  for (const [suffix, hash] of Object.entries(before.sha)) if (after.sha[suffix]) s = s.replaceAll(hash, after.sha[suffix]);
  // The Windows guide quotes the start and end of its fingerprint as well.
  for (const [suffix, hash] of Object.entries(before.sha))
    if (after.sha[suffix]) s = s.replaceAll(`<code>${hash.slice(0, 8)}</code>`, `<code>${after.sha[suffix].slice(0, 8)}</code>`).replaceAll(`<code>${hash.slice(-9)}</code>`, `<code>${after.sha[suffix].slice(-9)}</code>`);
  s = s.replace(/@@size:([^@]+)@@/g, (m, x) => (after.size[x] ? mb(after.size[x]) : m));
  s = s.replace(/@@sha:([^@]+)@@/g, (m, x) => after.sha[x] ?? m);
  s = s.replaceAll(oldV, newV);

  const ar = flag("--date-ar");
  const en = flag("--date-en");
  if (ar) s = s.replace(/نُشر في \d+ \S+ \d{4}/, `نُشر في ${ar}`);
  if (en) s = s.replace(/published on \d+ \w+ \d{4}/i, (m) => `${m.slice(0, 13)}${en}`);

  if (s !== start) writeFileSync(p, s);
  if (/@@(size|sha):/.test(s)) left.push(p);
}

console.log(`Updated the site from ${oldV} to ${newV}.`);
for (const [suffix, bytes] of Object.entries(after.size)) console.log(`  ${suffix}  ${mb(bytes)}`);
if (left.length) {
  console.log("Still holding placeholders:");
  for (const p of left) console.log(`  ${p}`);
  process.exitCode = 1;
}
