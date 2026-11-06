import {readFile,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import assert from "node:assert/strict";
const [pixelPath,movePath,cutPath,clipboardPath,finalPath]=process.argv.slice(2);
assert(pixelPath&&movePath&&cutPath&&clipboardPath&&finalPath,"Pass pixel, move, cut/delete, clipboard and final guarded editor JSON paths");
const read=async p=>JSON.parse(await readFile(p,"utf8")),pixels=await read(pixelPath),move=await read(movePath),cut=await read(cutPath),clipboard=await read(clipboardPath),final=await read(finalPath);
assert.equal(pixels.completed,true);assert.equal(pixels.passed,true);assert.equal(pixels.results.length,7);
for(const check of pixels.results){assert.equal(check.passed,true);assert.equal(check.comparison.differentPixels,0);assert(check.comparison.maxError<=2);}
const checks=[],check=(name,passed)=>{assert(passed,name);checks.push({name,passed:true});},count=(s,key)=>Object.keys(s[key]).length;
const a=move.selections,b=cut.selections,c=final.selections;assert.equal(a.length,7);assert.equal(b.length,7);assert.equal(c.length,4);
const unchanged=(x,y)=>["nodes","assets","layers","masks","nodeOrder","layerOrder"].every(key=>JSON.stringify(x[key])===JSON.stringify(y[key]));
check("cancel of edited preview creates no history, asset or destination layer",a[1].revision===1&&unchanged(a[0],a[1]));
check("unchanged move is a no-op",a[2].revision===1&&unchanged(a[0],a[2]));
const moved=Object.values(a[3].nodes).find(n=>n.kind==="raster"&&!n.erase);
check("numeric move scale rotation reflection are one edit with preserved source size",a[3].revision===2&&count(a[3],"assets")===2&&count(a[3],"layers")===2&&moved.w===164&&moved.h===84&&moved.rotation===30&&moved.flipX&&moved.geometrySize.w===82&&moved.geometrySize.h===42);
check("one Undo restores all pre-move source data",a[4].revision===3&&unchanged(a[0],a[4]));
const duplicate=Object.values(a[5].nodes).find(n=>n.kind==="raster");
check("actual pointer move and resize duplicate pixels without erasing",a[5].revision===4&&count(a[5],"assets")===1&&count(a[5],"nodes")===2&&duplicate.w===102&&duplicate.h===57&&duplicate.x===159&&duplicate.y===119&&!Object.values(a[5].nodes).some(n=>n.erase));
check("one Undo restores the pre-duplicate source",a[6].revision===5&&unchanged(a[0],a[6]));
check("copy to browser clipboard creates no journal edit",b[1].revision===1&&unchanged(b[0],b[1]));
check("cut adds only one raster erase and owned alpha asset",b[3].revision===2&&count(b[3],"nodes")===2&&count(b[3],"assets")===1&&count(b[3],"layers")===1&&Object.values(b[3].nodes).some(n=>n.kind==="raster"&&n.erase));
check("one Undo restores cut source elements",b[4].revision===3&&unchanged(b[0],b[4]));
check("delete preserves original elements and source layer",b[5].revision===4&&count(b[5],"nodes")===2&&count(b[5],"assets")===1&&count(b[5],"layers")===1&&Object.values(b[5].nodes).some(n=>n.erase));
check("one Undo restores deleted pixels without replacing originals",b[6].revision===5&&unchanged(b[0],b[6]));
const png=clipboard.clipboard[0];
check("actual page Clipboard API reads and decodes the selected transparent PNG",png.type==="image/png"&&png.width===82&&png.height===42&&png.decodedWidth===82&&png.decodedHeight===42&&png.nonzero===960&&png.maxAlpha===255&&png.bytes>0);
check("injected clipboard-write refusal leaves all drawing state unchanged",c[1].revision===1&&unchanged(c[0],c[1]));
const operation=c[2].operations.at(-1),guard=operation.pixelGuard;
check("final editor persists a source-layer read guard alongside one move edit",c[2].revision===2&&count(c[2],"nodes")===3&&count(c[2],"assets")===2&&guard.source==="current"&&guard.expected.layers.length===1&&JSON.stringify(guard.expected.nodes)===JSON.stringify(Object.values(c[0].nodes)));
check("one final-source Undo restores the entire initial source",c[3].revision===3&&unchanged(c[0],c[3]));
const modules=["renderer","Stage","DrawingView","floatingPixels","floatingTasks","floating.worker","pixelCapture","usePixelEdits","PixelSelectionActions","FloatingPixelsDialog","pixelGuard","operations","canonical","transport","syncManager"],hashes={},servedSourceMapMatches={},normalize=s=>s.replace(/\r\n/g,"\n");
for(const name of modules){
 const path=`src/drawing/${name}.${["Stage","DrawingView","PixelSelectionActions","FloatingPixelsDialog"].includes(name)?"tsx":"ts"}`,disk=await readFile(path,"utf8"),response=await fetch(`http://127.0.0.1:1421/${path}`);assert(response.ok,path);
 const source=await response.text(),match=source.match(/sourceMappingURL=data:application\/json;(?:charset=[^;]+;)?base64,([^\s]+)/);assert(match,path);const map=JSON.parse(Buffer.from(match[1],"base64").toString("utf8"));servedSourceMapMatches[path]=map.sourcesContent.some(value=>typeof value==="string"&&normalize(value)===normalize(disk));assert(servedSourceMapMatches[path],path);hashes[path]=createHash("sha256").update(disk).digest("hex");
}
for(const path of["src/drawing/drawing.css","src-tauri/src/drawing.rs","src-tauri/src/drawing_sync.rs","services/sync/src/doc.ts","scripts/drawing-input-smoke.tsx","scripts/drawing-floating-smoke.html","scripts/drawing-native-smoke.mjs"])hashes[path]=createHash("sha256").update(await readFile(path)).digest("hex");
for(const[tag,data]of[["46",move],["47",cut],["48",clipboard],["51",final]])await writeFile(`.lab/drawing-floating-ui-${tag}.json`,JSON.stringify(data,null,2)+"\n");
await writeFile("docs/drawing/qa/browser-floating-checks.json",JSON.stringify({capturedAt:new Date().toISOString(),sources:{pixels:pixelPath,move:movePath,cut:cutPath,clipboard:clipboardPath,final:finalPath},hashes,servedSourceMapMatches,pixels,editorChecks:checks,move,cut,clipboard,final,
 sourceStages:"Tab46 checks handles/numeric/cancel/Undo before durable read-guard support was added. Tabs47/48 exercise final guard-capable production source; tab51 explicitly records the persisted guard and injected clipboard-write refusal. The later harness changes add receipts and diagnostics only.",
 limitations:"Explicit mock browser storage. Clipboard PNG was read/decoded through the actual page API; CUA clipboard.read returned an empty provider list and is not its evidence. Control+C/Control+X automation produced no captured page keydown and no shortcut acceptance is claimed. No paste-to-floating flow, native physical clipboard/pen, full-size visual acceptance or full editor acceptance. No synthetic fault is described as a real service/permission outage.",
 passed:true,nativeAcceptance:false,visualAcceptance:false,fullEditorAcceptance:false},null,2)+"\n");
console.log(JSON.stringify({pixelChecks:7,editorChecks:checks.length,servedModules:modules.length,passed:true,fullEditorAcceptance:false}));
