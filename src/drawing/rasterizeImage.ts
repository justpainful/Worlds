import { DrawingRenderer } from "./renderer";
import { id, type Asset, type Change, type DrawingScene } from "./model";
import { imageCropSourceKey } from "./imageCrop";
import { effectiveLayer } from "./layers";
import { encodeMaskRaster } from "./maskRasterTasks";
import { decodeImageElement } from "./imageElement";
/** Bake one image's current crop, effects and alpha into a new owned original.
 * The previous image/masks remain in the journal and asset table for Undo. */
export async function rasterizeImage(
  scene: DrawingScene,
  nodeId: string,
  signal: AbortSignal,
  previewImages?: ReadonlyMap<string, HTMLImageElement>,
): Promise<{ blob: Blob; width: number; height: number; sourceKey: string }> {
  const n = scene.nodes[nodeId],
    asset = scene.assets[n?.assetId ?? ""];
  if (!n || !asset || !["image", "raster"].includes(n.kind) || n.erase) throw Error("rasterize-source");
  if (n.locked || effectiveLayer(scene, n.layerId).locked) throw Error("rasterize-locked");
  const crop = n.crop ?? { x: 0, y: 0, w: asset.width, h: asset.height },
    width = Math.ceil(crop.w),
    height = Math.ceil(crop.h);
  if (width * height > 8 * 1024 * 1024) throw Error("rasterize-size");
  const sourceKey = imageCropSourceKey(scene, nodeId),
    geometry = n.geometrySize ?? { w: n.w, h: n.h },
    images = new Map<string, HTMLImageElement>(previewImages),
    renderer = new DrawingRenderer({ previewImages: images }),
    dispose: (() => void)[] = [],
    abort = () => renderer.dispose();
  signal.addEventListener("abort", abort, { once: true });
  const check = () => {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  };
  try {
    check();
    const frameId = id(),
      layer = { ...scene.layers[n.layerId], parentId: null, visible: true, opacity: 1, blend: "source-over" as const },
      projected = {
        ...structuredClone(n),
        x: 0,
        y: 0,
        w: width,
        h: height,
        geometrySize: geometry,
        rotation: 0,
        flipX: false,
        flipY: false,
        opacity: 1,
        alphaLock: false,
        frameId,
      },
      masks = { ...scene.masks },
      assets = { ...scene.assets };
    for (const maskId of [...new Set([n.maskId, ...n.effects.map((e) => e.maskId)].filter((v): v is string => !!v))]) {
      const mask = scene.masks[maskId];
      if (!mask) throw Error("rasterize-mask-missing");
      if (mask.linked || !mask.enabled) continue;
      const alpha = await renderer.rasterMask(scene, n, mask, width, height, {
        linked: true,
        rect: { x: 0, y: 0, w: geometry.w, h: geometry.h },
      });
      check();
      const blob = await encodeMaskRaster(alpha, signal),
        url = URL.createObjectURL(blob);
      let loaded;
      try {
        loaded = await decodeImageElement(url, signal);
      } catch (e) {
        URL.revokeObjectURL(url);
        throw e;
      }
      dispose.push(() => {
        loaded.dispose();
        URL.revokeObjectURL(url);
      });
      const assetId = id();
      assets[assetId] = { id: assetId, attachmentId: assetId, name: "Baked mask", mime: "image/png", width, height };
      images.set(assetId, loaded.source);
      masks[maskId] = { ...mask, linked: true, x: 0, y: 0, w: geometry.w, h: geometry.h, inverted: false, base: 0, strokes: [], assetId };
    }
    const neededMasks = [projected.maskId, ...projected.effects.map((e) => e.maskId)].filter((v): v is string => !!v),
      neededAssets = new Set(
        [
          projected.assetId,
          ...neededMasks.flatMap((id) => {
            const m = masks[id];
            return m ? [m.assetId, ...m.strokes.map((s) => s.brush.tipAssetId)] : [];
          }),
        ].filter((v): v is string => !!v),
      );
    const frame = {
        ...scene.frames[scene.defaultFrameId],
        id: frameId,
        x: 0,
        y: 0,
        w: width,
        h: height,
        clip: true,
        background: "transparent",
      },
      sample: DrawingScene = {
        ...scene,
        defaultFrameId: frameId,
        frames: { [frameId]: frame },
        frameOrder: [frameId],
        layers: { [layer.id]: layer },
        layerOrder: [layer.id],
        nodes: { [projected.id]: projected },
        nodeOrder: [projected.id],
        masks,
        assets: Object.fromEntries([...neededAssets].map((id) => [id, assets[id]])),
        steps: {},
        stepOrder: [],
      };
    check();
    const blob = await renderer.exportFrame(sample, frame, 1, true);
    check();
    return { blob, width, height, sourceKey };
  } finally {
    signal.removeEventListener("abort", abort);
    renderer.dispose();
    for (const release of dispose) release();
  }
}
export function rasterizedImageChanges(scene: DrawingScene, nodeId: string, sourceKey: string, asset: Asset): Change[] {
  const n = scene.nodes[nodeId];
  if (!n || imageCropSourceKey(scene, nodeId) !== sourceKey) throw Error("rasterize-stale");
  if (n.locked || effectiveLayer(scene, n.layerId).locked) throw Error("rasterize-locked");
  return [
    { type: "put", collection: "assets", id: asset.id, value: asset },
    {
      type: "patch",
      collection: "nodes",
      id: nodeId,
      fields: { kind: "raster", assetId: asset.id, crop: null, effects: [], maskId: null },
    },
  ];
}
