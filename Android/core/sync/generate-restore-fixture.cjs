// Produce cross-runtime version restore snapshots using the sync service's Yjs dependency.
const Y = require('../../../services/sync/node_modules/yjs');
const fs = require('node:fs');
const path = require('node:path');
const old = new Y.Doc({gc:false}); const root = old.getXmlFragment('default');
function paragraph(id, text, marks = {}) {
  const p = new Y.XmlElement('paragraph'); p.setAttribute('bid', id);
  const t = new Y.XmlText(); if (text) t.insert(0, text, marks); p.insert(0, [t]); return p;
}
const p = paragraph('a', 'hello😀', {bold: {}, link: {href:'https://example.test'}});
p.setAttribute('level', 2); root.insert(0, [p, paragraph('b','second')]);
const oldState = Y.encodeStateAsUpdate(old);
const current = new Y.Doc({gc:false}); Y.applyUpdate(current, oldState);
const liveRoot = current.getXmlFragment('default');
liveRoot.get(0).get(0).insert(0,'changed '); liveRoot.delete(1,1);
const peer = new Y.Doc({gc:false}); Y.applyUpdate(peer, Y.encodeStateAsUpdate(current));
peer.getXmlFragment('default').get(0).get(0).insert(15, '!');
const reorder = new Y.Doc({gc:false}); Y.applyUpdate(reorder, oldState);
const reorderRoot = reorder.getXmlFragment('default'); reorderRoot.delete(0,1);
const moved = paragraph('a', 'hello😀', {bold: {}, link: {href:'https://example.test'}}); moved.setAttribute('level', 2); reorderRoot.insert(1,[moved]);
const b64 = bytes => Buffer.from(bytes).toString('base64');
const fixture = {version:b64(oldState), current:b64(Y.encodeStateAsUpdate(current)), peer:b64(Y.encodeStateAsUpdate(peer)), peerDelta:b64(Y.encodeStateAsUpdate(peer,Y.encodeStateVector(current))), reordered:b64(Y.encodeStateAsUpdate(reorder))};
const encoded = JSON.stringify(fixture,null,2)+'\n';
fs.writeFileSync(path.join(__dirname,'src/androidTest/assets/restore-fixture.json'), encoded);
fs.writeFileSync(path.resolve(__dirname,'../../app/src/androidTest/assets/restore-fixture.json'), encoded);
