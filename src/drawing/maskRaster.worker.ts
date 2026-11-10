import { editMaskRaster, validateMaskRaster, type MaskRaster, type MaskRasterTask } from './maskRaster';

self.onmessage = async (event: MessageEvent<{ task: MaskRasterTask | { kind: 'encode'; mask: MaskRaster; invert?: boolean } }>) => {
  let canvas: OffscreenCanvas | undefined;
  try {
    const task = event.data.task;
    if (task.kind !== 'encode') {
      const mask = editMaskRaster(task);
      self.postMessage({ mask }, { transfer: [mask.alpha.buffer] });
      return;
    }
    validateMaskRaster(task.mask);
    const { width, height, alpha } = task.mask;
    canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('The mask processor is unavailable');
    // Avoid allocating another four bytes per pixel for the complete mask.
    // The worker can be terminated between tiles when its caller cancels.
    const tileWidth = Math.min(width, 8192);
    const rows = Math.max(1, Math.min(128, Math.floor(4 * 1024 * 1024 / (tileWidth * 4))));
    for (let top = 0; top < height; top += rows) {
      const tileHeight = Math.min(rows, height - top);
      for (let left = 0; left < width; left += tileWidth) {
        const tileSize = Math.min(tileWidth, width - left), pixels = new Uint8ClampedArray(tileSize * tileHeight * 4);
        for (let y = 0; y < tileHeight; y++) for (let x = 0; x < tileSize; x++) {
          const i = (y * tileSize + x) * 4, value = alpha[(top + y) * width + left + x];
          pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
          pixels[i + 3] = task.invert ? 255 - value : value;
        }
        ctx.putImageData(new ImageData(pixels, tileSize, tileHeight), left, top);
      }
    }
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    self.postMessage({ blob });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    if (canvas) canvas.width = canvas.height = 1;
  }
};
