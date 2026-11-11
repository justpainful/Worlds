import { imageHeader } from "./imageHeaders";
import type { AnimatedFrameRequest } from "./animatedImage";
import { validateAnimation } from "./animatedImageLimits";
import probes from "./fixtures/image-orientation-probes.json";
interface DecoderFrame {
  image: VideoFrame;
  complete: boolean;
}
interface ImageDecoderInstance {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
  completed: Promise<void>;
  decode: (options: { frameIndex: number; completeFramesOnly: boolean }) => Promise<DecoderFrame>;
  close: () => void;
}
interface ImageDecoderConstructor {
  new (options: { data: Uint8Array; type: string; preferAnimation: boolean }): ImageDecoderInstance;
  isTypeSupported: (type: string) => Promise<boolean>;
}
const Decoder = (self as unknown as { ImageDecoder?: ImageDecoderConstructor }).ImageDecoder;
async function orientationApplied(mime: string, orientation: number) {
  if (orientation === 1) return true;
  const p = probes.images.find((p) => p.mime === mime && p.orientation === orientation);
  if (!p || !Decoder) throw Error("Animated image orientation is unavailable");
  const decoder = new Decoder({ data: Uint8Array.from(atob(p.base64), (c) => c.charCodeAt(0)), type: mime, preferAnimation: true });
  let image: VideoFrame | undefined, c: OffscreenCanvas | undefined;
  try {
    await decoder.tracks.ready;
    image = (await decoder.decode({ frameIndex: 0, completeFramesOnly: true })).image;
    c = new OffscreenCanvas(image.displayWidth, image.displayHeight);
    const ctx = c.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    const color = ctx.getImageData(0, 0, 1, 1).data;
    return c.width === p.width && c.height === p.height && p.corner.every((v, i) => Math.abs(v - color[i]) <= 32);
  } finally {
    image?.close();
    decoder.close();
    if (c) c.width = c.height = 1;
  }
}
self.onmessage = async (event: MessageEvent<AnimatedFrameRequest>) => {
  let decoder: ImageDecoderInstance | undefined, image: VideoFrame | undefined, c: OffscreenCanvas | undefined;
  try {
    const { bytes, mime, index, orientation } = event.data,
      header = imageHeader(bytes, 1_000_000, 256 * 1024 * 1024, true);
    validateAnimation(header, index);
    if (header.mime !== mime || !Number.isInteger(orientation) || orientation < 1 || orientation > 8) throw Error("Invalid animated image");
    if (!Decoder || !(await Decoder.isTypeSupported(mime))) throw Error("Static animation frames are unavailable in this window");
    decoder = new Decoder({ data: bytes, type: mime, preferAnimation: true });
    await decoder.tracks.ready;
    await decoder.completed;
    const count = decoder.tracks.selectedTrack?.frameCount;
    if (count !== header.frameCount) throw Error("Animation frame count does not match its header");
    const result = await decoder.decode({ frameIndex: index, completeFramesOnly: true });
    image = result.image;
    if (!result.complete) throw Error("The animation frame is incomplete");
    const honors = await orientationApplied(mime, orientation),
      w = image.displayWidth,
      h = image.displayHeight;
    const width = orientation >= 5 ? header.height : header.width,
      height = orientation >= 5 ? header.width : header.height;
    if (w !== (honors ? width : header.width) || h !== (honors ? height : header.height))
      throw Error("Animation frame dimensions do not match its header");
    c = new OffscreenCanvas(width, height);
    const ctx = c.getContext("2d");
    if (!ctx) throw Error("The image processor is unavailable");
    if (!honors) {
      const matrix: Record<number, [number, number, number, number, number, number]> = {
        2: [-1, 0, 0, 1, w, 0],
        3: [-1, 0, 0, -1, w, h],
        4: [1, 0, 0, -1, 0, h],
        5: [0, 1, 1, 0, 0, 0],
        6: [0, 1, -1, 0, h, 0],
        7: [0, -1, -1, 0, h, w],
        8: [0, -1, 1, 0, 0, w],
      };
      ctx.setTransform(...matrix[orientation]);
    }
    ctx.drawImage(image, 0, 0);
    const blob = await c.convertToBlob({ type: "image/png" });
    self.postMessage({ blob, frameCount: count, index, width, height });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    image?.close();
    decoder?.close();
    if (c) c.width = c.height = 1;
  }
};
