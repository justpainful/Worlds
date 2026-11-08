// Generate golden wire frames using the desktop application's lib0 dependency.
const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const localRequire = createRequire(path.resolve(process.argv[2], 'package.json'));
const e = localRequire('lib0/encoding');
const payload = Uint8Array.from([0, 1, 127, 128, 255]);
async function main() {
const desktop = await import(pathToFileURL(path.resolve(process.argv[2], 'src/sync/protocol.ts')).href);
function manual(write) { const w = e.createEncoder(); write(w); return e.toUint8Array(w); }
const examples = {
  sync: manual(w => { e.writeVarUint(w, desktop.MSG_SYNC); e.writeVarUint(w, 1); e.writeVarUint(w, 2); e.writeVarUint8Array(w, payload); }),
  awareness: desktop.encodeAwareness(payload),
  query: manual(w => e.writeVarUint(w, desktop.MSG_QUERY_AWARENESS)),
  auth: desktop.encodeAuthState('edit', 'مستخدم 🚀'),
  update: desktop.encodeUpdate(Number.MAX_SAFE_INTEGER, 0, payload),
  ack: desktop.encodeAck(16384, 1, 'refused'),
  notice: desktop.encodeNotice('rights', '変更'),
  refresh: desktop.encodeAuthRefresh('a.b.c'),
  awareness_entries: desktop.encodeAwarenessUpdate([
    { clientID: 7, clock: 3, state: '{"user":{"id":"u"}}' },
    { clientID: 9, clock: 1, state: 'null' },
  ]),
};
fs.writeFileSync(process.argv[3], Object.entries(examples).map(([name, bytes]) => {
  return `${name} ${Buffer.from(bytes).toString('hex')}`;
}).join('\n') + '\n');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
