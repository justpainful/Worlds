// Generate deterministic comparison inputs from the specified Worlds source.
// Usage: node generate-shape-corpus.cjs <source-checkout> <output-json>
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const { stripTypeScriptTypes } = require('module');
const [source, output] = process.argv.slice(2);
if (!source || !output) throw new Error('Provide source checkout and output file');
const transpile = code => stripTypeScriptTypes(code, { mode: 'strip' });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'worlds-shapes-'));
try {
  const geometry = transpile(fs.readFileSync(path.join(source, 'src/drawing/geometry.ts'), 'utf8')).replace(/^import .*;\s*$/gm, '');
  const recognition = transpile(fs.readFileSync(path.join(source, 'src/drawing/recognition.ts'), 'utf8')).replace('from "./geometry"', 'from "./geometry.mjs"');
  fs.writeFileSync(path.join(tmp, 'geometry.mjs'), geometry);
  fs.writeFileSync(path.join(tmp, 'recognition.mjs'), recognition);
  (async () => {
    const { recognizeShape } = await import(pathToFileURL(path.join(tmp, 'recognition.mjs')).href);
    const entries = [];
    const add = (name, points) => entries.push({ name, points, result: recognizeShape(points) });
    const segment = (vertices, count, amplitude = 0) => {
      const result = [];
      for (let i = 0; i < vertices.length - 1; i++) for (let j = 0; j < count; j++) {
        const t = j / count, a = vertices[i], b = vertices[i + 1], wobble = amplitude * Math.sin((i * count + j) * 1.71);
        result.push({ x: a[0] + (b[0] - a[0]) * t + wobble, y: a[1] + (b[1] - a[1]) * t + wobble * 0.7 });
      }
      const last = vertices[vertices.length - 1]; result.push({ x: last[0], y: last[1] }); return result;
    };
    add('short-rejected', segment([[0, 0], [12, 5]], 10));
    add('noisy-line', segment([[5, 14], [180, 23]], 50, 0.7));
    add('curved-open-rejected', Array.from({length: 80}, (_, i) => ({x: i * 2, y: Math.sin(i / 12) * 20})));
    add('square', segment([[0,0],[100,0],[100,100],[0,100],[0,0]], 20, 0.5));
    add('edge-start-rectangle', segment([[50,0],[120,0],[120,70],[0,70],[0,0],[50,0]], 16, 0.6));
    add('rotated-square', segment([[50,-20],[120,50],[50,120],[-20,50],[50,-20]], 24, 0.5));
    add('right-triangle', segment([[2,2],[130,5],[4,100],[2,2]], 28, 0.6));
    add('oblique-triangle', segment([[20,90],[130,95],[78,5],[20,90]], 25, 0.6));
    add('circle', Array.from({length: 101}, (_, i) => ({x: 80 + 62 * Math.cos(i * Math.PI * 2 / 100) + 0.5 * Math.sin(i * 2), y: 80 + 62 * Math.sin(i * Math.PI * 2 / 100)})));
    add('ellipse', Array.from({length: 101}, (_, i) => ({x: 80 + 70 * Math.cos(i * Math.PI * 2 / 100), y: 50 + 38 * Math.sin(i * Math.PI * 2 / 100)})));
    add('long-line-resampling', segment([[0,0],[500,15]], 2401, 0.1));
    add('zigzag-rejected', segment([[0,0],[30,30],[60,0],[90,30],[120,0]], 20, 0.1));
    fs.writeFileSync(output, JSON.stringify(entries));
  })().finally(() => fs.rmSync(tmp, { recursive: true, force: true })).catch(e => { console.error(e); process.exitCode = 1; });
} catch (error) { fs.rmSync(tmp, { recursive: true, force: true }); throw error; }
