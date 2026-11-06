import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const [gpuPath, canvasPath] = process.argv.slice(2);
assert(gpuPath && canvasPath, "Pass the completed GPU and forced-Canvas browser JSON paths");
const checks = JSON.parse(await readFile(gpuPath, "utf8")), fallbackChecks = JSON.parse(await readFile(canvasPath, "utf8"));
for (const record of [checks, fallbackChecks]) {
  assert.equal(record.completed, true);
  for (const flag of ["streamingPassed", "compositionPassed", "fullRasterAcceptance", "resourcePassed", "semanticPassed", "texturePassed"]) assert.equal(record[flag], true, flag);
  for (const result of record.results) {
    assert(!result.skipped, `Skipped browser case: ${result.name}`);
    if (result.cacheDifferences !== undefined) assert.equal(result.cacheDifferences, 0, result.name);
  }
}
assert.equal(checks.results.length, 30); assert.equal(fallbackChecks.results.length, 29);
assert(checks.results.some(r => r.name === "actual WebGL context loss falls back and restores" && r.passed));
for (const result of fallbackChecks.results.filter(r => r.composition)) assert(["aligned", "canvas", "uniform"].includes(result.backend), result.name);
const modules = ["renderer", "affine", "pigmentMip", "tileCompositor", "tileSampling", "strokeSpatial", "brush", "brushBounds", "brushConfig", "geometry", "model", "uniformStroke", "objectTransforms", "DrawingView", "TransformDialog", "imageHeaders"];
const sourceHashes = {}, servedSourceMapMatches = {};
const normalize = text => text.replace(/\r\n/g, "\n");
for (const name of modules) {
  const path = `src/drawing/${name}.${["DrawingView", "TransformDialog"].includes(name) ? "tsx" : "ts"}`, disk = await readFile(path, "utf8"), response = await fetch(`http://127.0.0.1:1421/${path}`);
  assert(response.ok, `Missing served module: ${path}`);
  const source = await response.text(), match = source.match(/sourceMappingURL=data:application\/json;(?:charset=[^;]+;)?base64,([^\s]+)/);
  assert(match, `Missing inline source map: ${path}`);
  const map = JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
  servedSourceMapMatches[path] = map.sourcesContent.some(content => typeof content === "string" && normalize(content) === normalize(disk));
  assert(servedSourceMapMatches[path], `Stale browser source: ${path}`);
  sourceHashes[path] = createHash("sha256").update(disk).digest("hex");
}
const harnessPath = "scripts/drawing-render-smoke.html", harness = await readFile(harnessPath, "utf8");
sourceHashes[harnessPath] = createHash("sha256").update(harness).digest("hex");
const artifact = {
  capturedAt: new Date().toISOString(), source: gpuPath, fallbackSource: canvasPath,
  browser: "IAB2 actual GPU and forced Canvas primary cases; temporary tabs closed",
  sourceHashes, servedSourceMapMatches,
  scope: "16 controlled 4096x2048 source comparisons, original/negative-tip semantics, 150-stroke eviction and actual GPU loss/restoration. Explicit aligned integer premultiplied RGBA8 mip reduction, Y then X, with a separate final linear sampler. CPU-readable canonical storage is frozen from the original rasterizer; hot replay does not read back or repaint pigment. No native pen, fully software browser, hardware performance or full-editor acceptance.",
  checks, fallbackChecks, sampledPixelGatePassed: true, fullEditorAcceptance: false,
};
await writeFile("docs/drawing/qa/browser-transform-pixels.json", JSON.stringify(artifact, null, 2) + "\n");
console.log(JSON.stringify({ gpuCases: checks.results.length, fallbackCases: fallbackChecks.results.length, servedModules: modules.length, sampledPixelGatePassed: true, fullEditorAcceptance: false }));
