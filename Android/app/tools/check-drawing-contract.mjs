// Validate an Android-generated, stroke-only document against the desktop scene validator.
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const file = process.argv[2];
if (!file) throw Error('Supply the path to an Android-generated drawing JSON');
const doc = JSON.parse(await readFile(file, 'utf8'));
for (const scene of [doc.seed, doc.scene]) {
  if (Object.values(scene.nodes).some(node => node.kind !== 'stroke' || node.path !== undefined) || scene.libraryPublication !== undefined) throw Error('Unexpected fixture content');
}
const { validateScene } = await import(pathToFileURL(resolve(root, 'src/drawing/model.ts')).href);
validateScene(doc.seed); validateScene(doc.scene);
const { replay } = await import(pathToFileURL(resolve(root, 'src/drawing/operations.ts')).href);
if (!isDeepStrictEqual(replay(doc.seed, doc.operations), doc.scene)) throw Error('Desktop journal replay differs from Android scene');
console.log(`Desktop validator and journal replay accepted revision ${doc.revision}`);
