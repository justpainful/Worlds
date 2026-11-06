import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const [gpuPath, canvasPath, uiPath] = process.argv.slice(2);
assert(gpuPath && canvasPath && uiPath, "Pass GPU, forced-Canvas and editor browser result paths");
const read = async path => JSON.parse(await readFile(path, "utf8"));
const gpu = await read(gpuPath), canvas = await read(canvasPath), editor = await read(uiPath);
for (const result of [gpu, canvas]) {
  assert.equal(result.completed, true);
  assert.equal(result.passed, true);
  assert.equal(result.results.length, 7);
  assert(result.results.every(check => check.passed && !check.skipped));
  for (const check of result.results) {
    if (check.pngAlphaDifferences !== undefined) assert.equal(check.pngAlphaDifferences, 0);
    if (check.differences !== undefined) assert.equal(check.differences, 0);
    if (check.comparison) {
      assert.equal(check.comparison.differentPixels, 0);
      assert(check.comparison.maxError <= 2);
    }
  }
}
const states = editor.selections;
assert.equal(states.length, 19);
const checks = [], check = (name, passed) => { assert(passed, name); checks.push({ name, passed: true }); };
const count = (state, key) => Object.keys(state[key]).length;
const status = (at, expected) => states[at].selectionStatus === expected;
check("all then invert creates an active empty selection without a journal edit", status(0, "0 بكسل محدد") && states[0].revision === 1);
check("painting an empty active selection creates no artwork or asset", states[1].revision === 1 && count(states[1], "nodes") === 1 && count(states[1], "masks") === 0 && count(states[1], "assets") === 0);
check("native rectangle and subtraction retain a temporary hole", status(2, "8,000 بكسل محدد") && states[2].revision === 1 && count(states[2], "masks") === 0);
const painted = states[3], mask = Object.values(painted.masks)[0], asset = Object.values(painted.assets)[0];
check("one paint edit owns its full-resolution linked mask and PNG", painted.revision === 2 && count(painted, "nodes") === 2 && count(painted, "masks") === 1 && count(painted, "assets") === 1 && mask.linked === true && mask.assetId === asset.id && asset.width === 122 && asset.height === 82);
check("one Undo removes paint mask and asset together", states[4].revision === 3 && count(states[4], "nodes") === 1 && count(states[4], "masks") === 0 && count(states[4], "assets") === 0 && JSON.stringify(states[4].nodes) === JSON.stringify(states[0].nodes));
check("Redo restores the owned paint and mask without an editor crash", states[5].revision === 4 && count(states[5], "nodes") === 2 && count(states[5], "masks") === 1 && count(states[5], "assets") === 1);
for (const [index, name, expected] of [
  [6, "Ctrl+A", "921,600 بكسل محدد"], [7, "Ctrl+Shift+I", "0 بكسل محدد"],
  [8, "Ctrl+D", "لا يوجد تحديد بكسلات"], [9, "ellipse", "7,546 بكسل محدد"],
  [10, "grow three pixels", "8,782 بكسل محدد"], [11, "shrink three pixels", "7,546 بكسل محدد"],
  [12, "feather two pixels", "8,362 بكسل محدد"], [13, "polygon clicks and Enter", "4,800 بكسل محدد"],
  [14, "magic merged connected sample", "480 بكسل محدد"], [15, "magic current-layer noncontiguous sample", "1,010 بكسل محدد"],
  [16, "rectangle replace", "9,600 بكسل محدد"], [17, "add disconnected rectangle", "11,200 بكسل محدد"],
  [18, "intersect both regions", "5,600 بكسل محدد"],
]) {
  const state = states[index];
  check(`${name} leaves canonical artwork unchanged`, status(index, expected) && state.revision === 4 && state.pending === 0 && ["nodes", "masks", "assets"].every(key => JSON.stringify(state[key]) === JSON.stringify(states[5][key])));
}
const modules = ["pixels", "morphology", "pixelSelection", "selection.worker", "selectionTasks", "selectionController", "selectionPaint", "usePixelSelection", "renderer", "drafts", "Stage", "DrawingView", "SelectionControls"];
const hashes = {}, servedSourceMapMatches = {}, normalize = text => text.replace(/\r\n/g, "\n");
for (const name of modules) {
  const path = `src/drawing/${name}.${["Stage", "DrawingView", "SelectionControls"].includes(name) ? "tsx" : "ts"}`, disk = await readFile(path, "utf8"), response = await fetch(`http://127.0.0.1:1421/${path}`);
  assert(response.ok, path);
  const text = await response.text(), match = text.match(/sourceMappingURL=data:application\/json;(?:charset=[^;]+;)?base64,([^\s]+)/);
  assert(match, `Missing source map: ${path}`);
  const map = JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
  servedSourceMapMatches[path] = map.sourcesContent.some(content => typeof content === "string" && normalize(content) === normalize(disk));
  assert(servedSourceMapMatches[path], `Stale served source: ${path}`);
  hashes[path] = createHash("sha256").update(disk).digest("hex");
}
for (const path of ["src/drawing/drawing.css", "scripts/drawing-selection-smoke.html", "scripts/drawing-input-smoke.tsx", "services/sync/test/drawing-live.test.ts"]) hashes[path] = createHash("sha256").update(await readFile(path)).digest("hex");
await writeFile(".lab/drawing-selection-ui-43.json", JSON.stringify(editor, null, 2) + "\n");
await writeFile("docs/drawing/qa/browser-selection-checks.json", JSON.stringify({
  capturedAt: new Date().toISOString(), sources: { gpu: gpuPath, canvas: canvasPath, editor: uiPath },
  browser: "IAB2 tabs41/42 actual Worker/renderer; tab43 actual Arabic DrawingView and browser pointer/keyboard input; tabs closed",
  hashes, servedSourceMapMatches, gpu, canvas, editor, editorChecks: checks,
  failedReproduction: ".lab/drawing-selection-ui-40-failure.json",
  fixedRegression: "Undo previously removed a selected node before property controls pruned its ID. Synchronous ID validation and guarded Stage selection keep the editor mounted; tab43 Undo/Redo, canvas/tool presence and empty final console were observed.",
  scope: "Temporary pixel selection, full alpha PNG, selected new paint, linked transforms and observed editor modes. Explicit mock storage in browser fixtures. Does not accept floating pixels, pixel clipboard/cut/delete, native app/pen or visual layout. Freehand lasso has algorithm coverage; no real curved lasso gesture accepted here.",
  passed: true, nativeAcceptance: false, visualAcceptance: false, fullEditorAcceptance: false,
}, null, 2) + "\n");
console.log(JSON.stringify({ gpuChecks: 7, canvasChecks: 7, editorChecks: checks.length, servedModules: modules.length, passed: true, fullEditorAcceptance: false }));
