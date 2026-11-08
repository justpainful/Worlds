// Verify an Android-produced restore update with Yjs itself.
const Y = require('../../../services/sync/node_modules/yjs');
const assert = require('node:assert/strict');
const fixture = JSON.parse(require('node:fs').readFileSync(process.argv[2], 'utf8'));
const from = field => new Uint8Array(Buffer.from(fixture[field], 'base64'));
const restored = new Y.Doc({gc:false}); Y.applyUpdate(restored, from('current')); Y.applyUpdate(restored, from('restoreUpdate'));
const old = new Y.Doc({gc:false}); Y.applyUpdate(old, from('version'));
const tree = d => d.getXmlFragment('default').toArray().map(n => ({tag:n.nodeName,attrs:n.getAttributes(),kids:n.toArray().map(t=>t.toDelta())}));
assert.deepEqual(tree(restored), tree(old));
Y.applyUpdate(restored, from('peerDelta'));
const peer = new Y.Doc({gc:false}); Y.applyUpdate(peer, from('peer')); Y.applyUpdate(peer, from('restoreUpdate'));
assert.deepEqual(tree(restored), tree(peer));
assert.equal(restored.getXmlFragment('default').get(0).get(0).toDelta().map(d => d.insert).join(''), 'hello😀!');
console.log('Yjs accepted restore, preserved marks and converged with concurrent edit');
