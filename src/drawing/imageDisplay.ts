import probes from "./fixtures/image-orientation-probes.json";
import { decodeImageElement, type LoadedImageElement } from "./imageElement";
const support = new Map<string, Promise<boolean>>();
/** A bounded, asymmetric codec probe distinguishes rotation/reflection support
 * even when a transformed image has the same dimensions as its source. */
export function codecAppliesOrientation(mime: string, orientation: number): Promise<boolean> {
  if (orientation === 1) return Promise.resolve(true);
  const key = `${mime}:${orientation}`,
    known = support.get(key);
  if (known) return known;
  const task = (async () => {
    const p = probes.images.find((p) => p.mime === mime && p.orientation === orientation);
    if (!p) throw new Error("Unsupported image orientation metadata");
    const loaded = await decodeImageElement(`data:${mime};base64,${p.base64}`);
    const c = new OffscreenCanvas(loaded.source.naturalWidth, loaded.source.naturalHeight);
    try {
      const ctx = c.getContext("2d");
      if (!ctx) throw new Error("The image processor is unavailable");
      ctx.drawImage(loaded.source, 0, 0);
      const color = ctx.getImageData(0, 0, 1, 1).data;
      return (
        loaded.source.naturalWidth === p.width &&
        loaded.source.naturalHeight === p.height &&
        p.corner.every((value, i) => Math.abs(value - color[i]) <= 32)
      );
    } finally {
      loaded.dispose();
      c.width = c.height = 1;
    }
  })();
  support.set(key, task);
  void task.catch(() => {
    if (support.get(key) === task) support.delete(key);
  });
  return task;
}
export async function orientDecodedImage(
  loaded: LoadedImageElement,
  mime: string,
  orientation: number,
  signal?: AbortSignal,
  honors = codecAppliesOrientation,
): Promise<LoadedImageElement> {
  if (orientation === 1) return loaded;
  const aborted = () => {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  };
  aborted();
  if (await honors(mime, orientation)) {
    aborted();
    return loaded;
  }
  aborted();
  const source = loaded.source,
    w = source.naturalWidth,
    h = source.naturalHeight,
    c = new OffscreenCanvas(orientation >= 5 ? h : w, orientation >= 5 ? w : h),
    ctx = c.getContext("2d");
  if (!ctx) throw new Error("The image processor is unavailable");
  const matrix: Record<number, [number, number, number, number, number, number]> = {
    2: [-1, 0, 0, 1, w, 0],
    3: [-1, 0, 0, -1, w, h],
    4: [1, 0, 0, -1, 0, h],
    5: [0, 1, 1, 0, 0, 0],
    6: [0, 1, -1, 0, h, 0],
    7: [0, -1, -1, 0, h, w],
    8: [0, -1, 1, 0, 0, w],
  };
  let blob: Blob;
  try {
    ctx.setTransform(...matrix[orientation]);
    ctx.drawImage(source, 0, 0);
    blob = await c.convertToBlob({ type: "image/png" });
  } finally {
    c.width = c.height = 1;
  }
  aborted();
  const corrected = await decodeImageElement(blob, signal);
  try {
    aborted();
    loaded.dispose();
    return corrected;
  } catch (error) {
    corrected.dispose();
    throw error;
  }
}
