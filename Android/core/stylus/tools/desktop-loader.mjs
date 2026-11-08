// Isolate the actual desktop brush implementation from unrelated UI dependencies.
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const repo = resolvePath(dirname(fileURLToPath(import.meta.url)), '../../../..');
const drawing = resolvePath(repo, 'src/drawing');
const urlFor = (source) => `data:text/javascript,${encodeURIComponent(source)}`;

export async function resolve(specifier, context, nextResolve) {
  if (context.parentURL?.startsWith(pathToFileURL(drawing).href)) {
    if (specifier === './model') {
      const source = await readFile(resolvePath(drawing, 'model.ts'), 'utf8');
      const match = source.match(/export const DEFAULT_BRUSH: Brush = \{[\s\S]*?\n\};/);
      if (!match) throw new Error('Desktop DEFAULT_BRUSH was not found');
      return { url: urlFor(match[0].replace(': Brush', '')), shortCircuit: true };
    }
    if (specifier === './geometry') {
      const source = await readFile(resolvePath(drawing, 'geometry.ts'), 'utf8');
      const clamp = source.match(/^export const clamp = .*$/m)?.[0];
      const distance = source.match(/^export const distance = .*$/m)?.[0];
      if (!clamp || !distance) throw new Error('Desktop geometry helpers were not found');
      // Node strips TypeScript annotations for source files, but data URLs are JavaScript.
      return { url: urlFor(`${clamp.replaceAll(': number', '')}\n${distance.replaceAll(': Point', '')}`), shortCircuit: true };
    }
    if (specifier.startsWith('./')) return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
}
