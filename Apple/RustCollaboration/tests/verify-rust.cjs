const assert = require('node:assert/strict');
const fs = require('node:fs');
const Y = require('yjs');
const doc = new Y.Doc();
Y.applyUpdate(doc, fs.readFileSync(process.argv[2]));
assert.equal(doc.getText('shared').toString(), 'Rust to Yjs 🌍');
console.log('Yjs accepted yrs v1 update');
