// Run with: node --no-warnings --loader ./core/stylus/tools/desktop-loader.mjs ./core/stylus/tools/desktop-fixtures.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const { strokeDabs } = await import(pathToFileURL(resolve(root, 'src/drawing/brush.ts')).href);
// Defaults below match model.ts; use explicit values so fixture intent is reviewable.
const defaults = { kind:'hard', size:12, opacity:1, flow:1, hardness:1, spacing:0.12, angle:0, roundness:1, smoothing:0.15, stabilizer:0, taperStart:0, taperEnd:0, pressureSize:true, pressureOpacity:false, pressureFlow:false, pressureCurve:1, color:'#202023' };
const point = (x, y, pressure, time) => ({ x, y, pressure, time, tiltX:0, tiltY:0 });
const points = [point(0, 1, 0.2, 0), point(3, 5, 0.6, 12), point(8, 5, 1, 30)];
const cases = [
  ['hard', { ...defaults, size:10, spacing:0.2, flow:0.8, pressureCurve:2, pressureOpacity:true, taperStart:0.2, taperEnd:0.3 }],
  ['spray', { ...defaults, kind:'spray', size:10, spacing:0.3, pressureFlow:true, angle:35 }],
];
const lines = cases.flatMap(([name, brush]) => strokeDabs(points, brush, 42).map(dab => [name, dab.x, dab.y, dab.size, dab.opacity, dab.angle, dab.roundness, dab.noise].join('\t')));
const file = resolve(root, 'Android/core/stylus/src/test/resources/desktop-brush-fixtures.tsv');
const content = lines.join('\n') + '\n';
if (process.argv.includes('--check')) {
  if (await readFile(file, 'utf8') !== content) throw new Error('Desktop brush fixture is stale');
  console.log(`Verified ${lines.length} desktop brush dabs`);
} else {
  await writeFile(file, content);
  console.log(`Wrote ${lines.length} desktop brush dabs`);
}
