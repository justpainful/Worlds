type EncodeRequest = { bitmap: ImageBitmap; format: string; quality: number };

self.onmessage = async (event: MessageEvent<EncodeRequest>) => {
  const { bitmap, format, quality } = event.data;
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image export canvas is unavailable");
    context.drawImage(bitmap, 0, 0);
    const blob = await canvas.convertToBlob({ type: format, quality });
    if (blob.type !== format) throw new Error("This image export format is unavailable");
    self.postMessage({ blob });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    bitmap.close();
  }
};
