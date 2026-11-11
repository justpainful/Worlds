import type { DrawingScene } from "./model";
import { DrawingRenderer } from "./renderer";
import { createZip } from "./archive";
export async function exportAnnotatedArchive(
  scene: DrawingScene,
  frameId: string,
  scale: number,
  signal: AbortSignal,
): Promise<{ blob: Blob; preview: Blob }> {
  if (!scene.frames[frameId] || new TextEncoder().encode(JSON.stringify(scene)).length * 2 > 16 * 1024 * 1024)
    throw Error("This batch exceeds the export-context limit. Select fewer frames.");
  const renderer = new DrawingRenderer(),
    abort = () => renderer.dispose();
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const clean = await renderer.exportFrame(scene, scene.frames[frameId], scale, false);
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const annotated = await renderer.exportFrame(scene, scene.frames[frameId], scale, true);
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    if (clean.size + annotated.size > 256 * 1024 * 1024) throw Error("The frame archive exceeds 256 MiB");
    return {
      blob: await createZip(
        [
          { name: "clean.png", blob: clean },
          { name: "annotated.png", blob: annotated },
        ],
        signal,
      ),
      preview: annotated,
    };
  } finally {
    signal.removeEventListener("abort", abort);
    renderer.dispose();
  }
}
export async function exportFrameArchive(
  scene: DrawingScene,
  frameIds: string[],
  scale: number,
  annotations: boolean,
  signal: AbortSignal,
  onProgress?: (done: number, total: number) => void,
): Promise<{ blob: Blob; preview: Blob }> {
  const selected = scene.frameOrder.filter((id) => frameIds.includes(id));
  if (!selected.length || selected.length !== new Set(frameIds).size) throw Error("Choose existing frames for the archive");
  if (selected.length > 64 || new TextEncoder().encode(JSON.stringify(scene)).length * selected.length > 16 * 1024 * 1024)
    throw Error("This batch exceeds the export-context limit. Select fewer frames.");
  const renderer = new DrawingRenderer(),
    entries: { name: string; blob: Blob }[] = [];
  let total = 0;
  const abort = () => renderer.dispose();
  signal.addEventListener("abort", abort, { once: true });
  try {
    for (const [idIndex, id] of selected.entries()) {
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      const frame = scene.frames[id],
        blob = await renderer.exportFrame(scene, frame, scale, annotations),
        name =
          frame.name
            .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
            .trim()
            .slice(0, 80) || "Frame";
      total += blob.size;
      if (total > 256 * 1024 * 1024) throw Error("The frame archive exceeds 256 MiB");
      entries.push({ name: `${String(idIndex + 1).padStart(3, "0")}-${name}.png`, blob });
      onProgress?.(entries.length, selected.length);
    }
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    return { blob: await createZip(entries, signal), preview: entries[0].blob };
  } finally {
    signal.removeEventListener("abort", abort);
    renderer.dispose();
  }
}
