// Load the desktop validator while refusing unrelated scene features in this narrow check.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
const root = resolvePath(dirname(fileURLToPath(import.meta.url)), '../../..');
const drawing = pathToFileURL(resolvePath(root, 'src/drawing/')).href;
const stub = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
export async function resolve(specifier, context, nextResolve) {
  if (context.parentURL?.startsWith(drawing)) {
    if (specifier === '../lib/api') return { url: stub('export const api={drawingLoad:async()=>globalThis.__fixtureDrawing}; export function fileUrl(){throw Error("Assets were not expected")}'), shortCircuit: true };
    if (specifier === './paths') return { url: stub('export function validPath(){throw Error("Path was not expected in this fixture")}'), shortCircuit: true };
    if (specifier === './libraryPublication') return { url: stub('export function validateLibraryPublication(){throw Error("Publication was not expected in this fixture")}'), shortCircuit: true };
    if (specifier === './geometry') return { url: stub('export function anchorPoint(){throw Error("Anchors were not expected in this fixture")}'), shortCircuit: true };
    if (specifier === './pixelGuard') return { url: stub('export function checkPixelGuard(){throw Error("Pixel guards were not expected in this fixture")}'), shortCircuit: true };
    if (specifier === './library') return { url: stub('export function validateLibraryMetadata(){throw Error("Libraries were not expected in this fixture")}'), shortCircuit: true };
    if (specifier === './imageHeaders') return { url: stub('export function imageHeader(){throw Error("Preview images were not expected in this fixture")}'), shortCircuit: true };
    if (specifier.startsWith('./')) return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
}
