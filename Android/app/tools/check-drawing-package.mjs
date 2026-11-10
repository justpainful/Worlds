// Exercise the original desktop package reader against an Android-generated file.
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
if (!process.argv[2]) throw Error('Supply the Android-generated package path');
const bytes = await readFile(process.argv[2]);
const { readDrawingPackage } = await import(pathToFileURL(resolve(root, 'src/drawing/package.ts')).href);
const pack = await readDrawingPackage(new Blob([bytes]));
if (pack.version !== 2 || !pack.history || !isDeepStrictEqual(pack.scene, pack.history.scene)) throw Error('Project history is missing or does not match');
console.log(`Desktop package reader accepted version ${pack.version}, ${pack.history.operations.length} history operations`);
