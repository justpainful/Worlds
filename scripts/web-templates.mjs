// The built-in templates for Worlds on the web, read from the desktop's list
// (src-tauri/src/templates.rs) so the two never differ.
//   node scripts/web-templates.mjs   writes src/web/builtinTemplates.json
import { readFileSync, writeFileSync } from "node:fs";

const rs = readFileSync(new URL("../src-tauri/src/templates.rs", import.meta.url), "utf8");

function field(block, name) {
  const at = block.indexOf(`${name}:`);
  if (at < 0) return null;
  const rest = block.slice(at + name.length + 1).trimStart();
  if (rest.startsWith('r#"')) return rest.slice(3, rest.indexOf('"#'));
  if (rest.startsWith('"')) {
    let i = 1;
    while (i < rest.length && rest[i] !== '"') i += rest[i] === "\\" ? 2 : 1;
    return JSON.parse(rest.slice(0, i + 1));
  }
  return null;
}

const list = [];
for (const block of rs.split(/\n\s*Template \{/).slice(1)) {
  const t = {};
  for (const name of ["key", "title", "icon", "category", "description", "markdown"]) {
    t[name] = field(block, name);
    if (t[name] === null) throw new Error(`could not read ${name} in: ${block.slice(0, 80)}`);
  }
  list.push(t);
}
writeFileSync(new URL("../src/web/builtinTemplates.json", import.meta.url), `${JSON.stringify(list, null, 1)}\n`);
console.log(`${list.length} templates`);
