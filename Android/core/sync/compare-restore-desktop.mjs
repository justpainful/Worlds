// Differential check against the original desktop mirror. The desktop repository path is supplied by the caller.
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
const desktop = resolve(process.argv[2]);
const require = createRequire(join(desktop, 'package.json'));
const Y = await import(pathToFileURL(join(desktop, 'node_modules/yjs/dist/yjs.mjs')));
const { seedY, writeBlocks, blocksFromY } = await import(pathToFileURL(join(desktop, 'src/sync/mirror.ts')));
const here = dirname(fileURLToPath(import.meta.url));
const binary = resolve(here, 'native/target/debug/examples/restore_fixture.exe');
const tmp = mkdtempSync(join(tmpdir(), 'worlds-restore-'));
const file = name => join(tmp, name);
const p = (bid, text, marks) => ({type:'paragraph', attrs:{bid}, content:text ? [{type:'text', text, ...(marks ? {marks} : {})}] : []});
const old = [p('a','Alpha'),p('b','Bravo'),p('c','Charlie')];
const cases = [
  {name:'edited text', before:[p('a','Alpha changed'),p('b','Bravo'),p('c','Charlie')], peer:'b'},
  {name:'missing first', before:[p('b','Bravo'),p('c','Charlie')], peer:'b'},
  {name:'extra first', before:[p('x','Extra'),p('a','Alpha'),p('b','Bravo'),p('c','Charlie')], peer:'b'},
  {name:'swap first two', unsupported:true, before:[p('b','Bravo'),p('a','Alpha'),p('c','Charlie')], peer:'b'},
  {name:'rotate blocks', unsupported:true, before:[p('c','Charlie'),p('a','Alpha'),p('b','Bravo')], peer:'b'},
  {name:'empty first', old:[p('a',''),p('b','Bravo')], before:[p('a','Local'),p('b','Bravo')], peer:'a'},
  {name:'restore deleted', before:[p('a','Alpha'),p('c','Charlie')], peer:'c'},
  {name:'changed formatting', old:[p('a','Alpha',[{type:'bold'},{type:'link',attrs:{href:'https://example.test'}}]),p('b','Bravo')],before:[p('a','Alpha',[{type:'italic'}]),p('b','Bravo')],peer:'b'},
  {name:'nested list reorder', unsupported:true, old:[{type:'bulletList',attrs:{bid:'l'},content:[{type:'listItem',content:[p(undefined,'One')]},{type:'listItem',content:[p(undefined,'Two')]}]}], before:[{type:'bulletList',attrs:{bid:'l'},content:[{type:'listItem',content:[p(undefined,'Two')]},{type:'listItem',content:[p(undefined,'One')]}]}], peer:'l', nested:true},
];
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, key === 'marks' ? val.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))) : canonical(val)]));
}
let mismatches = 0;
for (const item of cases) {
  const prior = new Y.Doc({gc:false}); seedY(prior,item.old || old);
  const live = new Y.Doc({gc:false}); Y.applyUpdate(live,Y.encodeStateAsUpdate(prior)); writeBlocks(live,item.before);
  const peer = new Y.Doc({gc:false}); Y.applyUpdate(peer,Y.encodeStateAsUpdate(live));
  const node = peer.getXmlFragment('default').toArray().find(x => x.getAttribute('bid') === item.peer);
  if (!node || !node.get(0)) throw Error(`Peer node unavailable: ${item.name}`);
  const text = item.nested ? node.get(0).get(0).get(0) : node.get(0);
  text.insert(text.length,'!');
  const peerDelta = Y.encodeStateAsUpdate(peer,Y.encodeStateVector(live));
  writeFileSync(file('current.bin'),Y.encodeStateAsUpdate(live)); writeFileSync(file('version.bin'),Y.encodeStateAsUpdate(prior));
  try {
    execFileSync(binary,[file('current.bin'),file('version.bin'),file('update.bin')],{stdio:'pipe'});
    if (item.unsupported) { console.error(`${item.name}: unsafe reorder was accepted`); mismatches++; continue; }
  } catch (e) {
    if (item.unsupported && String(e.stderr).includes('Reordered blocks')) { console.log(`${item.name}: rejected to protect concurrent edits`); continue; }
    throw e;
  }
  const android = new Y.Doc({gc:false}); Y.applyUpdate(android,Y.encodeStateAsUpdate(live)); Y.applyUpdate(android,readFileSync(file('update.bin')));
  const nativeBefore = blocksFromY(android); writeBlocks(live,blocksFromY(prior)); const desktopBefore = blocksFromY(live);
  if (!isDeepStrictEqual(canonical(nativeBefore),canonical(desktopBefore))) { console.error(`${item.name}: version content differs\nAndroid: ${JSON.stringify(nativeBefore)}\nDesktop: ${JSON.stringify(desktopBefore)}`); mismatches++; continue; }
  Y.applyUpdate(android,peerDelta); Y.applyUpdate(live,peerDelta);
  const left = blocksFromY(android), right = blocksFromY(live);
  if (!isDeepStrictEqual(canonical(left),canonical(right))) { mismatches++; console.log(`${item.name}: concurrent outcome differs\nAndroid: ${JSON.stringify(left)}\nDesktop: ${JSON.stringify(right)}`); }
  else console.log(`${item.name}: matches desktop`);
}
if (mismatches) { console.error(`${mismatches} concurrent cases differ`); process.exitCode=1; }
