// Fail when desktop collaboration dependencies drift from the contract test.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const lock = fs.readFileSync(path.resolve(__dirname, '../../../../pnpm-lock.yaml'), 'utf8');
const local = require('./interop-deps/package.json').dependencies;
const importer = lock.split('packages:')[0];
for (const [name, version] of Object.entries({ '@tiptap/y-tiptap': local['@tiptap/y-tiptap'], yjs: local.yjs })) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:'${escaped}'|${escaped}):\\s*\\n\\s*specifier:[^\\n]*\\n\\s*version: ([^\\n]+)`);
  const match = importer.match(pattern);
  assert(match, `Desktop lock lacks ${name}`);
  assert(match[1] === version || match[1].startsWith(`${version}(`), `Update Android contract dependencies for desktop ${name}: ${match[1]}`);
  if (name === '@tiptap/y-tiptap') for (const peer of ['prosemirror-model', 'prosemirror-state', 'prosemirror-view', 'y-protocols', 'yjs']) {
    assert(match[1].includes(`${peer}@${local[peer]}`), `Update Android contract dependency for desktop ${peer}`);
  }
}
console.log('Android contract dependencies match the desktop lock');
