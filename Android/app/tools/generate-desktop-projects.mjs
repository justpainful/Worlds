// Create fixtures with the desktop model, operation journal and package writer.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const load = (name) => import(pathToFileURL(resolve(root, `src/drawing/${name}.ts`)).href);
const { newNode, DEFAULT_BRUSH } = await load('model');
const { newDrawing, appendOperation, edit, historyToggle, putNode } = await load('operations');
const { createDrawingPackage, readDrawingPackage } = await load('package');
let doc = newDrawing();
function stroke(x, name) {
  const n = newNode('stroke', doc.scene.layerOrder[0], doc.scene.defaultFrameId, {x, y:100, w:150, h:30});
  n.name = name; n.brush = {...DEFAULT_BRUSH}; n.erase = false; n.alphaLock = false; n.seed = 123;
  n.samples = [{x:10,y:15,pressure:.7,tiltX:0,tiltY:0,time:0},{x:140,y:15,pressure:.7,tiltX:0,tiltY:0,time:10}];
  return n;
}
const a = stroke(100, 'Brush stroke');
doc = appendOperation(doc, edit('desktop-alice', doc.revision, 'Brush', putNode(doc.scene, a)));
doc = appendOperation(doc, historyToggle(doc, 'desktop-alice'));
const b = stroke(300, 'Brush stroke');
doc = appendOperation(doc, edit('desktop-bob', doc.revision, 'Brush', putNode(doc.scene, b)));
doc = appendOperation(doc, historyToggle(doc, 'desktop-alice', true));
if (doc.scene.nodeOrder.join(',') !== [b.id, a.id].join(',')) throw Error('Desktop replay order mismatch');
globalThis.__fixtureDrawing = doc;
const out = resolve(root, 'Android/app/src/androidTest/assets');
await mkdir(out, {recursive:true});
for (const [name, options] of [['desktop-scene.worldsdraw', {}], ['desktop-history.worldsdraw', {includeHistory:true}]]) {
  const blob = await createDrawingPackage(doc.scene, undefined, 'fixture-page', undefined, options);
  const parsed = await readDrawingPackage(blob);
  if (parsed.version !== (options.includeHistory ? 2 : 1)) throw Error('Unexpected package version');
  await writeFile(resolve(out, name), Buffer.from(await blob.arrayBuffer()));
  console.log(`${name}: desktop package version ${parsed.version}, ${doc.operations.length} original operations`);
}

// Desktop uniform pens: transparent highlighter and pressure-sensitive marker.
doc = newDrawing();
const highlight = stroke(100, 'Highlighter');
highlight.brush = {...DEFAULT_BRUSH, kind:'highlighter', size:28, opacity:.35, pressureSize:false, color:'#e6c235'};
doc = appendOperation(doc, edit('desktop-alice', doc.revision, 'Highlight', putNode(doc.scene, highlight)));
const marker = stroke(300, 'Brush stroke');
marker.brush = {...DEFAULT_BRUSH, kind:'marker', size:20, flow:.6, pressureSize:true, straightLine:true, color:'#245b93'};
doc = appendOperation(doc, edit('desktop-bob', doc.revision, 'Marker', putNode(doc.scene, marker)));
globalThis.__fixtureDrawing = doc;
const uniform = await createDrawingPackage(doc.scene, undefined, 'fixture-page', undefined, {includeHistory:true});
await readDrawingPackage(uniform);
await writeFile(resolve(out, 'desktop-uniform.worldsdraw'), Buffer.from(await uniform.arrayBuffer()));
console.log('desktop-uniform.worldsdraw: highlighter and marker');
