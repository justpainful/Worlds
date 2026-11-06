import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const paths = [".lab/drawing-handles-browser-34.json", ".lab/drawing-handles-browser-35.json", ".lab/drawing-handles-browser-37.json", ".lab/drawing-handles-editor-38.json", ".lab/drawing-handles-editor-39.json"];
const [a,b,c,d,e] = await Promise.all(paths.map(async path => JSON.parse(await readFile(path,"utf8"))));
const last = record => record.transforms.at(-1);
const checks = {
  pointerOneEdit: a.drag.revision === a.baseline.revision + 1 && a.drag.originalsIntact,
  undoRestoresOriginalBox: a.undo.revision === a.drag.revision + 1 && a.undo.nodes[0].w === a.baseline.nodes[0].w && a.undo.nodes[0].h === a.baseline.nodes[0].h,
  reflectedSourceRetained: a.drag.nodes[0].flipX && JSON.stringify(a.drag.nodes[0].samples) === JSON.stringify(a.baseline.nodes[0].samples),
  uniformMultipleObjects: Math.abs(a.pair.nodes[0].w / 200 - a.pair.nodes[1].w / 110) < 1e-10 && a.pair.originalsIntact,
  pendingEscapeCancels: a.waiting.status === "waiting" && a.cancel.revision === a.waiting.revision,
  rightsLossCancels: !a.readOnly.editable && a.readOnly.revision === a.waiting.revision,
  independentBrushColorRetained: b.color.nodes[0].brush.color === "#0088ff" && b.color.revision === b.base.revision + 2,
  staleGeometryRefused: b.stale.revision === b.color.revision + 1 && b.stale.nodes[0].w === b.color.nodes[0].w && b.stale.events.some(event => event.error?.includes("changed")),
  toolAndSelectionCancel: b.tool.tool === "brush" && b.tool.revision === b.stale.revision && b.selection.revision === b.stale.revision,
  queuedEscapeCancels: c.waiting.status === "waiting" && c.cancelledQueue.revision === c.waiting.revision,
  lostReservationExplained: c.rejectedLease.revision === c.waiting.revision && c.rejectedLease.events.some(event => event.error?.includes("reservation was lost")),
  fiveQueuedKeys: last(d.burst).revision === 6 && last(d.burst).rotation === 75,
  arabicPointerOneEdit: last(d.drag).revision === 7 && last(d.drag).geometrySize.w === 160,
  arabicUndo: last(d.undo).revision === 8 && last(d.undo).w === 160 && last(d.undo).h === 40 && last(d.undo).rotation === 75,
  numericSheetCancel: last(d.cancelSheet).revision === last(d.undo).revision,
  arabicGripTargets: d.dom.dir === "rtl" && d.dom.grips.length === 9 && d.dom.grips.every(grip => grip.width === 32 && grip.height === 32 && /[\u0600-\u06ff]/.test(grip.label)),
  noArbitraryScaleCap: last(e.large).w === 1600000 && last(e.large).h === 400000 && last(e.large).geometrySize.w === 160,
  largeScaleUndo: last(e.restored).w === 160 && last(e.restored).h === 40 && !last(e.restored).geometrySize,
  finalSourceQueuedKeys: e.busy === "false" && last(e.rapid).revision === 6 && last(e.rapid).rotation === 45,
  originalSamples: JSON.stringify(last(e.large).samples) === JSON.stringify(last(e.restored).samples) && JSON.stringify(last(d.drag).samples) === JSON.stringify(last(d.undo).samples),
  cleanConsole: [a,b,c,d,e].every(record => record.console.length === 0),
};
for (const [name, passed] of Object.entries(checks)) assert(passed, name);
const sourceHashes = {}, servedSourceMapMatches = {}, normalize = text => text.replace(/\r\n/g,"\n");
for (const name of ["Stage.tsx", "DrawingView.tsx", "objectTransforms.ts", "transformHandles.ts", "drafts.ts"]) {
  const path = `src/drawing/${name}`, disk = await readFile(path,"utf8"), response = await fetch(`http://127.0.0.1:1421/${path}`); assert(response.ok);
  const text = await response.text(), match = text.match(/sourceMappingURL=data:application\/json;(?:charset=[^;]+;)?base64,([^\s]+)/); assert(match, path);
  const map = JSON.parse(Buffer.from(match[1],"base64").toString("utf8"));
  servedSourceMapMatches[path] = map.sourcesContent.some(content => typeof content === "string" && normalize(content) === normalize(disk)); assert(servedSourceMapMatches[path], path);
  sourceHashes[path] = createHash("sha256").update(disk).digest("hex");
}
for (const path of ["src/drawing/drawing.css", "services/sync/src/drawing-authority.ts", "services/sync/test/drawing-live.test.ts", "scripts/drawing-handles-smoke.tsx", "scripts/drawing-input-smoke.tsx"]) sourceHashes[path] = createHash("sha256").update(await readFile(path)).digest("hex");
await writeFile("docs/drawing/qa/browser-handles-checks.json", JSON.stringify({ capturedAt:new Date().toISOString(), paths, sourceHashes, servedSourceMapMatches, checks, passed:true, visualAcceptance:false, nativeAcceptance:false, scope:"Real browser pointer/keyboard input. Isolated mock persistence. Delayed/lost leases are explicitly injected in Stage harness; server authority has a separate real two-client Worker test. Tab38 tests final Stage and ordinary transform behavior; tab39 tests the subsequent scale-range expansion on final source. Earlier scenarios retain their original source-stage limits. Screenshot capture failed and is not accepted as visual evidence.", records:[a,b,c,d,e] },null,2)+"\n");
console.log(JSON.stringify({ checks:Object.keys(checks).length, passed:true, visualAcceptance:false, nativeAcceptance:false, servedModules:Object.keys(servedSourceMapMatches).length }));
