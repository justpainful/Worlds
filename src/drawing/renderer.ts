import { viewportPrefixPlan, draftDeviceBounds, unionDeviceBounds } from "./viewportPrefix";
import { layerTree, layerDisplayOrder, effectiveLayer } from "./layers";
import { fileUrl } from "../lib/api";
import { iterateStrokeDabs, normalizeBrush, type Dab } from "./brush";
import { requireStrokeBudget } from "./brushWork";
import { straightStrokeSamples, uniformStrokeRadii } from "./uniformStroke";
import { anchorPoint, bounds, contains, intersects, worldRenderBounds } from "./geometry";
import { sourceInkRect } from "./brushBounds";
import type { Asset, DrawingNode, DrawingScene, Frame, Paint, Point, Rect, Mask } from "./model";
import { runPixelTask } from "./pixelTasks";
import type { Pixels } from "./pixels";
import { DrawingReferenceCache } from "./references";
import { exportPreparationScene } from "./exportScope";
import { releaseTileCompositor, tileCompositor } from "./tileCompositor";
import { strokeLod } from "./tileSampling";
import { StrokeSpatialIndex } from "./strokeSpatial";
import {
  inverse as invertMatrix,
  identity,
  multiply,
  nodeMatrix,
  rotate,
  scale as scaleMatrix,
  transformPoint,
  translate,
  type Affine,
} from "./affine";
import { reducePigmentPairs } from "./pigmentMip";
import { decodeImageElement } from "./imageElement";
import { orientDecodedImage } from "./imageDisplay";
import { decodeDrawingImage } from "./imageIngest";
import { canvasFont, textDirection, textLines } from "./textLayout";
import { encodeBmpTask } from "./bmpTask";
import { encodeExportCanvas } from "./exportEncode";
import { pathSegments } from "./paths";
import { isRedaction, redactionShown, redactionBounds } from "./redaction";
let effectQueue: Promise<unknown> = Promise.resolve();
function serialEffect<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  const task = effectQueue
    .catch(() => {})
    .then(() => {
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      return work();
    });
  effectQueue = task.catch(() => {});
  return task;
}
const imageCacheKey = (attachmentId: string, asset?: Asset) =>
  `${attachmentId}${asset?.orientation && asset.orientation !== 1 ? `:orientation:${asset.orientation}` : ""}${asset?.frameIndex !== undefined ? `:frame:${asset.frameIndex}` : ""}`;

export interface Viewport extends Rect {
  scale: number;
}
export interface DraftClip {
  rect: Rect;
  source: CanvasImageSource;
}
export interface RenderOptions {
  frameId?: string;
  region?: Rect;
  layerId?: string;
  activeLayerId?: string;
  hiddenNodeIds?: string[];
  annotations?: boolean;
  background?: boolean;
  draft?: DrawingNode;
  drafts?: DrawingNode[];
  draftClips?: Map<string, DraftClip>;
  uncached?: boolean;
  incremental?: boolean;
  immutableScene?: boolean;
}
const surface = (w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
};
function ctx2d(c: HTMLCanvasElement, pigment = false) {
  const ctx = c.getContext("2d", pigment ? { willReadFrequently: true } : undefined);
  if (!ctx) throw new Error("Drawing graphics are unavailable");
  return ctx;
}
const rasterSubpixel = (value: number) => Math.round(value * 256) / 256;
function canvasEffect(effect: DrawingNode["effects"][number]): string {
  switch (effect.kind) {
    case "brightness":
      return `brightness(${1 + effect.amount})`;
    case "contrast":
      return `contrast(${1 + effect.amount})`;
    case "saturation":
      return `saturate(${1 + effect.amount})`;
    case "grayscale":
      return `grayscale(${effect.amount})`;
    case "invert":
      return `invert(${effect.amount})`;
    case "blur":
      return `blur(${effect.amount}px)`;
    default:
      return "";
  }
}
/** Some image-only effects have no equivalent in the vector canvas path. */
export function unsupportedVectorEffects(node: DrawingNode): boolean {
  return (
    node.kind !== "image" &&
    node.kind !== "raster" &&
    !isRedaction(node) &&
    node.effects.some((effect) => effect.enabled && !canvasEffect(effect))
  );
}

/** Viewport-sized compositing surfaces; the world canvas never allocates its full bounds. */
export class DrawingRenderer {
  private images = new Map<string, HTMLImageElement>();
  private failedImages = new Set<string>();
  private imageTasks = new Map<string, Promise<void>>();
  private imageResources = new Map<string, () => void>();
  private imageLifetime = new AbortController();
  private strokes = new Map<string, { key: string; canvas: HTMLCanvasElement; bytes: number }>();
  private spatial = new Map<string, { key: string; index: StrokeSpatialIndex }>();
  private spatialBytes = 0;
  private emptyTile: HTMLCanvasElement | null = null;
  private cacheBytes = 0;
  private viewportPrefix: {
    pixels: ImageData;
    target: HTMLCanvasElement;
    key: string;
    keyBytes: number;
    dirty?: Rect;
    hadCompound?: boolean;
  } | null = null;
  private assetEpoch = 0;
  private immutablePrefixSource: { scene: DrawingScene; content: string } | null = null;
  readonly viewportDiagnostics = {
    hits: 0,
    misses: 0,
    rootsReused: 0,
    lastPrefixRoots: 0,
    peakBytes: 0,
    partialFrames: 0,
    repaintPixels: 0,
  };
  private invalidatePrefix() {
    this.viewportPrefix = null;
  }
  private assetChanged = () => {
    this.assetEpoch++;
    this.invalidatePrefix();
    this.onAssetChange?.();
  };
  private get strokeCacheBudget() {
    return (
      this.cacheLimit -
      (this.immutablePrefixSource?.content.length ?? 0) * 2 -
      (this.viewportPrefix ? this.viewportPrefix.pixels.data.byteLength + this.viewportPrefix.keyBytes : 0)
    );
  }
  private trimStrokeCache() {
    while (this.cacheBytes > this.strokeCacheBudget && this.strokes.size) {
      const first = this.strokes.keys().next().value!;
      this.cacheBytes -= this.strokes.get(first)!.bytes;
      this.strokes.delete(first);
    }
  }
  private effects = new Map<string, HTMLCanvasElement>();
  private effectCacheBytes = 0;
  private processing = new Map<string, Promise<HTMLCanvasElement>>();
  private effectErrors = new Map<string, string>();
  private groupSurfaces: HTMLCanvasElement[] = [];
  private strokeSurface: HTMLCanvasElement | null = null;
  private strokePadding: HTMLCanvasElement | null = null;
  private strokePatch: HTMLCanvasElement | null = null;
  private clipContent: HTMLCanvasElement | null = null;
  private clipAlpha: HTMLCanvasElement | null = null;
  private references = new DrawingReferenceCache();
  private matrices = new WeakMap<CanvasRenderingContext2D, Affine>();
  private matrix(ctx: CanvasRenderingContext2D): Affine {
    return this.matrices.get(ctx) ?? ctx.getTransform();
  }
  private setMatrix(ctx: CanvasRenderingContext2D, m: Affine) {
    this.matrices.set(ctx, m);
    ctx.setTransform(m);
  }
  private worldRect(ctx: CanvasRenderingContext2D, r: Rect, clip: boolean) {
    const base = this.matrix(ctx);
    ctx.setTransform(translate(base, r.x, r.y));
    if (clip) {
      ctx.beginPath();
      ctx.rect(0, 0, r.w, r.h);
      ctx.clip();
    } else ctx.fillRect(0, 0, r.w, r.h);
    ctx.setTransform(base);
  }
  constructor(
    private readonly options: {
      tileBackend?: "auto" | "canvas";
      previewImages?: ReadonlyMap<string, HTMLImageElement>;
      viewportCache?: boolean;
    } = {},
  ) {
    this.references.onChange = this.assetChanged;
    document.fonts?.addEventListener?.("loadingdone", this.assetChanged);
  }
  setPreviewImages(images: ReadonlyMap<string, HTMLImageElement> | undefined) {
    if (images !== this.options.previewImages) {
      this.options.previewImages = images;
      this.assetChanged();
    }
  }
  readonly cacheLimit = 128 * 1024 * 1024;
  readonly rasterDiagnostics = {
    backend: "aligned" as "aligned" | "gpu" | "canvas" | "uniform",
    levelX: 0,
    levelY: 0,
    canonicalTilesGenerated: 0,
    mipTilesGenerated: 0,
    maxPatchPixels: 0,
    sourceMatrix: [] as number[],
  };
  get cacheDiagnostics() {
    const prefixPixels = this.viewportPrefix ? this.viewportPrefix.pixels.data.byteLength : 0,
      prefixKeyBytes = (this.viewportPrefix?.keyBytes ?? 0) + (this.immutablePrefixSource?.content.length ?? 0) * 2;
    return {
      pixels: this.cacheBytes + prefixPixels,
      strokePixels: this.cacheBytes,
      prefixPixels,
      prefixKeyBytes,
      spatial: this.spatialBytes,
      pixelLimit: this.cacheLimit,
      spatialLimit: 8 * 1024 * 1024,
    };
  }
  onAssetChange?: () => void;
  dispose() {
    this.invalidatePrefix();
    this.immutablePrefixSource = null;
    document.fonts?.removeEventListener?.("loadingdone", this.assetChanged);
    for (const canvas of this.groupSurfaces) canvas.width = canvas.height = 1;
    this.groupSurfaces = [];
    releaseTileCompositor(this);
    this.references.dispose();
    this.onAssetChange = undefined;
    this.imageLifetime.abort();
    for (const dispose of this.imageResources.values()) dispose();
    this.imageResources.clear();
    this.imageTasks.clear();
    this.failedImages.clear();
    for (const image of this.images.values()) {
      image.onload = null;
      image.onerror = null;
    }
    this.images.clear();
    // Canvas backing stores can otherwise remain allocated until a later GC cycle.
    for (const entry of this.strokes.values()) entry.canvas.width = entry.canvas.height = 1;
    for (const canvas of this.effects.values()) canvas.width = canvas.height = 1;
    for (const canvas of [this.emptyTile, this.strokeSurface, this.strokePadding, this.strokePatch, this.clipContent, this.clipAlpha])
      if (canvas) canvas.width = canvas.height = 1;
    this.strokes.clear();
    this.spatial.clear();
    this.spatialBytes = 0;
    this.emptyTile = null;
    this.effects.clear();
    this.effectCacheBytes = 0;
    this.processing.clear();
    this.strokeSurface = null;
    this.strokePadding = null;
    this.strokePatch = null;
    this.clipContent = null;
    this.clipAlpha = null;
    this.cacheBytes = 0;
  }
  asset(scene: DrawingScene, id: string | undefined): HTMLImageElement | null {
    const a = id && scene.assets[id];
    if (!a) return null;
    return this.options.previewImages?.get(a.attachmentId) ?? this.attachment(a.attachmentId, a);
  }
  private attachment(attachmentId: string, asset?: Asset): HTMLImageElement | null {
    const key = imageCacheKey(attachmentId, asset);
    if (this.failedImages.has(key)) return null;
    let img = this.images.get(key);
    if (asset && ((asset.orientation && asset.orientation !== 1) || asset.frameIndex !== undefined)) {
      if (this.imageTasks.has(key)) return null;
      if (!img) {
        const signal = this.imageLifetime.signal;
        const task = (async () => {
          const animated = asset.frameIndex !== undefined;
          let loaded;
          if (animated) {
            const response = await fetch(fileUrl(attachmentId), { signal });
            if (!response.ok) throw new Error("Could not read the animated original");
            const blob = await response.blob();
            loaded = await decodeDrawingImage(new Blob([blob], { type: asset.mime }), signal, undefined, asset.frameIndex);
            if (!loaded.animation) {
              loaded.dispose();
              throw new Error("The selected animation frame is unavailable");
            }
          } else loaded = await decodeImageElement(fileUrl(attachmentId), signal);
          try {
            if (!animated) loaded = await orientDecodedImage(loaded, asset.mime, asset.orientation!, signal);
            if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
            if (loaded.source.naturalWidth !== asset.width || loaded.source.naturalHeight !== asset.height)
              throw new Error("Image orientation dimensions do not match the original");
            this.images.set(key, loaded.source);
            this.imageResources.set(key, loaded.dispose);
          } catch (error) {
            loaded.dispose();
            throw error;
          }
        })()
          .catch((error) => {
            if (!signal.aborted) {
              this.failedImages.add(key);
            }
            throw error;
          })
          .finally(() => {
            if (this.imageTasks.get(key) === task) this.imageTasks.delete(key);
            if (!signal.aborted) this.assetChanged();
          });
        this.imageTasks.set(key, task);
        void task.catch(() => {});
        return null;
      }
      return img.complete && img.naturalWidth ? img : null;
    }
    if (!img) {
      img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = this.assetChanged;
      img.onerror = () => {
        this.failedImages.add(key);
        this.assetChanged();
      };
      img.src = fileUrl(attachmentId);
      this.images.set(key, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  }
  async prepare(scene: DrawingScene): Promise<void> {
    if (
      Object.values(scene.nodes).some(
        (node) => node.visible && effectiveLayer(scene, node.layerId).visible && unsupportedVectorEffects(node),
      )
    )
      throw new Error(
        "This drawing has an unsupported adjustment on a vector or text element. Disable or remove it before preparing or exporting the image.",
      );
    await Promise.all(
      [
        ...new Set(
          Object.values(scene.nodes)
            .filter((n) => n.kind === "reference" && n.sourceMode !== "snapshot" && n.sourceId)
            .map((n) => n.sourceId!),
        ),
      ].map((source) => this.references.ensure(source)),
    );
    await Promise.all(
      Object.keys(scene.assets).map((id) => {
        this.asset(scene, id);
        const a = scene.assets[id],
          key = imageCacheKey(a.attachmentId, a),
          task = this.imageTasks.get(key),
          img = this.images.get(key);
        if (this.failedImages.has(key)) throw new Error(`Could not load ${a.name}`);
        return (task ?? img?.decode())?.catch(() => {
          throw new Error(`Could not load ${scene.assets[id].name}`);
        });
      }),
    );
    await document.fonts.ready;
    await Promise.all(
      Object.values(scene.nodes)
        .filter((n) => n.kind === "text")
        .map((n) => document.fonts.load(canvasFont(n.textStyle))),
    );
    await Promise.all(
      Object.values(scene.nodes)
        .filter((n) => (n.kind === "image" || n.kind === "raster") && n.effects.some((e) => e.enabled))
        .map((n) => this.processImage(scene, n)),
    );
    await Promise.all(
      Object.values(scene.nodes)
        .filter((n) => n.kind === "reference" && n.sourceMode !== "snapshot" && n.sourceId)
        .map(async (n) => {
          const data = this.references.get(n.sourceId!);
          if (data.state === "ready" && data.imageAttachmentId) {
            this.attachment(data.imageAttachmentId);
            await this.images
              .get(data.imageAttachmentId)
              ?.decode()
              .catch(() => {});
          }
        }),
    );
  }
  async refreshReferences(scene: DrawingScene): Promise<void> {
    await Promise.all(
      [
        ...new Set(
          Object.values(scene.nodes)
            .filter((n) => n.kind === "reference" && n.sourceMode !== "snapshot" && n.sourceId)
            .map((n) => n.sourceId!),
        ),
      ].map((source) => this.references.refresh(source)),
    );
  }
  private effectKey(scene: DrawingScene, n: DrawingNode): string {
    const a = scene.assets[n.assetId ?? ""],
      masks = n.effects.flatMap((e) => (e.maskId ? [scene.masks[e.maskId]] : [])).filter(Boolean),
      assets = masks
        .flatMap((m) => [m.assetId, ...m.strokes.map((s) => s.brush.tipAssetId)])
        .filter((id): id is string => !!id)
        .map((id) => scene.assets[id]);
    return JSON.stringify([
      a?.attachmentId,
      a?.orientation,
      a?.frameIndex,
      n.crop,
      n.effects,
      masks,
      assets,
      n.geometrySize ?? { w: n.w, h: n.h },
      masks.some((m) => !m.linked) ? [n.x, n.y, n.w, n.h, n.rotation, n.flipX, n.flipY] : null,
    ]);
  }
  private async prepareMaskAssets(scene: DrawingScene, mask: Mask) {
    for (const id of [mask.assetId, ...mask.strokes.map((s) => s.brush.tipAssetId)].filter((v): v is string => !!v)) {
      const a = scene.assets[id];
      if (!a) throw Error("A mask original is missing");
      if (this.asset(scene, id)) continue;
      const key = imageCacheKey(a.attachmentId, a),
        task = this.imageTasks.get(key),
        image = this.images.get(key);
      await (task ?? image?.decode());
      if (!this.asset(scene, id)) throw Error("The mask image could not be loaded");
    }
  }
  /** Draw mask pigment consistently in the editor, effects and export. */
  private drawMaskStrokes(ctx: CanvasRenderingContext2D, matrix: Affine, mask: Mask): void {
    for (const stroke of mask.strokes) {
      const brush = normalizeBrush(stroke.brush);
      ctx.globalCompositeOperation = stroke.reveal ? "source-over" : "destination-out";
      for (const dab of iterateStrokeDabs(stroke.samples, brush)) {
        ctx.setTransform(scaleMatrix(rotate(translate(matrix, dab.x, dab.y), (dab.angle * Math.PI) / 180), 1, dab.roundness));
        ctx.globalAlpha = dab.opacity * brush.opacity;
        const radius = dab.size / 2;
        if (brush.hardness < 0.99) {
          const gradient = ctx.createRadialGradient(0, 0, radius * brush.hardness, 0, 0, radius);
          gradient.addColorStop(0, "#ffffff");
          gradient.addColorStop(1, "transparent");
          ctx.fillStyle = gradient;
        } else ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  private maskSurface(scene: DrawingScene, n: DrawingNode, mask: Mask, w: number, h: number, matrix: Affine): HTMLCanvasElement {
    const canvas = surface(w, h),
      ctx = ctx2d(canvas);
    this.setMatrix(ctx, matrix);
    ctx.setTransform(translate(matrix, mask.x, mask.y));
    const mw = mask.w ?? (mask.linked ? (n.geometrySize?.w ?? n.w) : n.w),
      mh = mask.h ?? (mask.linked ? (n.geometrySize?.h ?? n.h) : n.h);
    ctx.fillStyle = `rgba(255,255,255,${mask.base ?? (mask.assetId ? 0 : 1)})`;
    ctx.fillRect(0, 0, mw, mh);
    if (mask.assetId) {
      const image = this.asset(scene, mask.assetId);
      if (!image) throw Error("The mask image is not loaded");
      ctx.drawImage(image, 0, 0, mw, mh);
    }
    this.drawMaskStrokes(ctx, matrix, mask);
    if (mask.inverted) {
      const inverse = surface(w, h),
        ic = ctx2d(inverse);
      ic.fillStyle = "#ffffff";
      ic.fillRect(0, 0, w, h);
      ic.globalCompositeOperation = "destination-out";
      ic.drawImage(canvas, 0, 0);
      ctx.resetTransform();
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(inverse, 0, 0);
      inverse.width = inverse.height = 1;
    }
    return canvas;
  }
  /** Bake an existing mask into a chosen local or world pixel domain. */
  async rasterMask(
    scene: DrawingScene,
    n: DrawingNode,
    mask: Mask,
    width: number,
    height: number,
    domain: { linked: boolean; rect: Rect },
  ): Promise<import("./maskRaster").MaskRaster> {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 16 * 1024 * 1024)
      throw Error("The mask exceeds the working memory limit");
    await this.prepareMaskAssets(scene, mask);
    if (this.imageLifetime.signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const r = domain.rect,
      toPixels: Affine = { a: width / r.w, b: 0, c: 0, d: height / r.h, e: (-r.x * width) / r.w, f: (-r.y * height) / r.h },
      coordinates =
        mask.linked === domain.linked ? identity() : mask.linked ? nodeMatrix(identity(), n) : invertMatrix(nodeMatrix(identity(), n)),
      canvas = this.maskSurface(scene, n, mask, width, height, multiply(toPixels, coordinates));
    try {
      const data = ctx2d(canvas).getImageData(0, 0, width, height).data,
        alpha = new Uint8ClampedArray(width * height);
      for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
      return { width, height, alpha };
    } finally {
      canvas.width = canvas.height = 1;
    }
  }
  private processImage(scene: DrawingScene, n: DrawingNode): Promise<HTMLCanvasElement> {
    const key = this.effectKey(scene, n),
      ready = this.effects.get(key);
    if (ready) {
      this.effects.delete(key);
      this.effects.set(key, ready);
      return Promise.resolve(ready);
    }
    const running = this.processing.get(key);
    if (running) return running;
    const promise = serialEffect(async () => {
      const image = this.asset(scene, n.assetId);
      if (!image) throw Error("The image is not loaded");
      const crop = n.crop ?? { x: 0, y: 0, w: image.naturalWidth, h: image.naturalHeight };
      if (crop.w * crop.h > 8 * 1024 * 1024) throw Error("The image exceeds the effect working memory limit");
      const canvas = surface(crop.w, crop.h),
        ctx = ctx2d(canvas);
      ctx.drawImage(image, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height);
      try {
        let pixels: Pixels = { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
        for (const effect of n.effects.filter((e) => e.enabled)) {
          const mask = effect.maskId ? scene.masks[effect.maskId] : undefined;
          if (effect.maskId && !mask) throw Error("An effect mask is missing");
          if (mask?.enabled) {
            const geometry = n.geometrySize ?? { w: n.w, h: n.h },
              raster = await this.rasterMask(scene, n, mask, pixels.width, pixels.height, {
                linked: true,
                rect: { x: 0, y: 0, w: geometry.w, h: geometry.h },
              });
            pixels = await runPixelTask({ kind: "masked-effect", image: pixels, effect, mask: raster.alpha }, this.imageLifetime.signal);
          } else pixels = await runPixelTask({ kind: "effect", image: pixels, effect }, this.imageLifetime.signal);
        }
        if (this.imageLifetime.signal.aborted) throw new DOMException("Cancelled", "AbortError");
        ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), canvas.width, canvas.height), 0, 0);
        const bytes = canvas.width * canvas.height * 4;
        while (this.effectCacheBytes + bytes > 64 * 1024 * 1024 && this.effects.size) {
          const oldest = this.effects.keys().next().value!,
            old = this.effects.get(oldest)!;
          this.effectCacheBytes -= old.width * old.height * 4;
          old.width = old.height = 1;
          this.effects.delete(oldest);
        }
        this.effects.set(key, canvas);
        this.effectCacheBytes += bytes;
        this.assetChanged();
        return canvas;
      } catch (error) {
        canvas.width = canvas.height = 1;
        throw error;
      }
    }, this.imageLifetime.signal);
    this.processing.set(key, promise);
    promise.then(
      () => {
        if (this.processing.get(key) === promise) this.processing.delete(key);
      },
      (e) => {
        if (this.processing.get(key) === promise) this.processing.delete(key);
        if (!this.imageLifetime.signal.aborted) {
          this.effectErrors.set(key, e instanceof Error ? e.message : String(e));
          this.assetChanged();
        }
      },
    );
    return promise;
  }
  render(canvas: HTMLCanvasElement, scene: DrawingScene, view: Viewport, options: RenderOptions = {}) {
    try {
      this.renderViewport(canvas, scene, view, options);
    } catch (error) {
      this.invalidatePrefix();
      canvas.width = canvas.width;
      for (const c of this.groupSurfaces) c.width = c.height = 1;
      this.groupSurfaces = [];
      throw error;
    }
  }
  private renderViewport(canvas: HTMLCanvasElement, scene: DrawingScene, view: Viewport, options: RenderOptions = {}) {
    const ctx = ctx2d(canvas),
      w = canvas.width,
      h = canvas.height;
    ctx.resetTransform();
    const transform = (c: CanvasRenderingContext2D) =>
      this.setMatrix(c, { a: view.scale, b: 0, c: 0, d: view.scale, e: -view.x * view.scale, f: -view.y * view.scale });
    transform(ctx);
    const tree = layerTree(scene),
      nodes = scene.nodeOrder.map((id) => scene.nodes[id]);
    if (options.draft && !scene.nodes[options.draft.id]) nodes.push(options.draft);
    if (options.drafts) nodes.push(...options.drafts.filter((n) => !scene.nodes[n.id]));
    const nodesByLayer = new Map<string, DrawingNode[]>();
    for (const node of nodes) {
      const list = nodesByLayer.get(node.layerId) ?? [];
      list.push(node);
      nodesByLayer.set(node.layerId, list);
    }
    const attributes = ctx.getContextAttributes?.(),
      colorType = (attributes as { colorType?: string } | undefined)?.colorType,
      transparentShadow = ctx.shadowColor.replace(/\s+/g, "").endsWith(",0)") || ctx.shadowColor === "#00000000",
      safeContext =
        transparentShadow &&
        (!colorType || colorType === "unorm8") &&
        ctx.globalAlpha === 1 &&
        ctx.globalCompositeOperation === "source-over" &&
        ctx.filter === "none" &&
        !ctx.shadowBlur &&
        !ctx.shadowOffsetX &&
        !ctx.shadowOffsetY &&
        (!attributes?.colorSpace || attributes.colorSpace === "srgb");
    let immutableContent: string | undefined;
    if (options.immutableScene) {
      if (this.immutablePrefixSource?.scene !== scene) {
        const content = JSON.stringify(scene);
        this.immutablePrefixSource = content.length * 2 <= 2 * 1024 * 1024 ? { scene, content } : null;
      }
      immutableContent = this.immutablePrefixSource?.content;
    } else this.immutablePrefixSource = null;
    this.trimStrokeCache();
    const plan =
      this.options.viewportCache !== false &&
      !options.uncached &&
      !this.options.previewImages &&
      !this.processing.size &&
      !this.imageTasks.size &&
      safeContext
        ? viewportPrefixPlan(scene, view, w, h, options, this.assetEpoch, immutableContent)
        : null;
    if (plan) plan.key += JSON.stringify([ctx.imageSmoothingEnabled, ctx.imageSmoothingQuality]);
    else this.invalidatePrefix();
    const hit = !!plan && this.viewportPrefix?.target === canvas && this.viewportPrefix.key === plan.key;
    const currentDirty = plan ? draftDeviceBounds(scene, view, w, h, options) : null;
    const compound = !!options.drafts?.some((n) => !scene.nodes[n.id]);
    const combined =
      hit && !compound && !this.viewportPrefix?.hadCompound && options.incremental && currentDirty && this.viewportPrefix?.dirty
        ? unionDeviceBounds(currentDirty, this.viewportPrefix.dirty)
        : null;
    const partial = combined && combined.w * combined.h < w * h * 0.75 ? combined : null;
    const workW = partial ? Math.max(1, partial.w) : w,
      workH = partial ? Math.max(1, partial.h) : h;
    const dirtyWorld = partial
      ? {
          x: view.x + (partial.x - 4) / view.scale,
          y: view.y + (partial.y - 4) / view.scale,
          w: (partial.w + 8) / view.scale,
          h: (partial.h + 8) / view.scale,
        }
      : null;
    const workTransform = (context: CanvasRenderingContext2D) =>
      this.setMatrix(context, {
        a: view.scale,
        b: 0,
        c: 0,
        d: view.scale,
        e: -view.x * view.scale - (partial?.x ?? 0),
        f: -view.y * view.scale - (partial?.y ?? 0),
      });
    ctx.save();
    ctx.resetTransform();
    if (!partial) ctx.clearRect(0, 0, w, h);
    ctx.restore();
    ctx.save();
    if (partial) {
      ctx.resetTransform();
      ctx.beginPath();
      ctx.rect(partial.x, partial.y, partial.w, partial.h);
      ctx.clip();
      transform(ctx);
      this.viewportDiagnostics.partialFrames++;
      this.viewportDiagnostics.repaintPixels += partial.w * partial.h;
    }
    if (options.region) this.worldRect(ctx, options.region, true);
    if (hit) {
      const pixels = this.viewportPrefix!.pixels;
      if (partial && partial.w > 0 && partial.h > 0) {
        const crop = new ImageData(partial.w, partial.h);
        for (let row = 0; row < partial.h; row++) {
          const from = ((partial.y + row) * w + partial.x) * 4;
          crop.data.set(pixels.data.subarray(from, from + partial.w * 4), row * partial.w * 4);
        }
        ctx.putImageData(crop, partial.x, partial.y);
      } else if (!partial) ctx.putImageData(pixels, 0, 0);
      this.viewportDiagnostics.hits++;
      this.viewportDiagnostics.rootsReused += plan!.prefixCount;
    } else if (options.background !== false)
      for (const fid of scene.frameOrder) {
        if (options.frameId && fid !== options.frameId) continue;
        const f = scene.frames[fid];
        ctx.fillStyle = f.background;
        this.worldRect(ctx, f, false);
      }
    const renderLayer = (lid: string, target: CanvasRenderingContext2D, depth: number) => {
      const layer = scene.layers[lid];
      if (!layer.visible || layer.opacity <= 0) return;
      if (depth > 64 || (depth + 1) * workW * workH * 4 > 256 * 1024 * 1024)
        throw new Error("Layer groups exceed the compositing memory limit");
      let layerCanvas = this.groupSurfaces[depth];
      if (!layerCanvas) layerCanvas = this.groupSurfaces[depth] = surface(workW, workH);
      if (layerCanvas.width !== workW || layerCanvas.height !== workH) {
        layerCanvas.width = workW;
        layerCanvas.height = workH;
      }
      const lc = ctx2d(layerCanvas);
      lc.resetTransform();
      lc.clearRect(0, 0, workW, workH);
      workTransform(lc);
      for (const n of nodesByLayer.get(lid) ?? []) {
        if (isRedaction(n)) continue;
        if (
          n.layerId !== lid ||
          !n.visible ||
          (options.frameId && n.frameId !== options.frameId && n.frameId !== null) ||
          options.hiddenNodeIds?.includes(n.id)
        )
          continue;
        if (options.annotations === false && (n.anchor || n.annotationGroup)) continue;
        if (
          dirtyWorld &&
          !n.anchor &&
          !n.endAnchor &&
          ["stroke", "text", "image", "raster"].includes(n.kind) &&
          !intersects(worldRenderBounds(n), dirtyWorld)
        )
          continue;
        const f = n.frameId && scene.frames[n.frameId];
        lc.save();
        if (f && f.clip) this.worldRect(lc, f, true);
        // Rotated bounds and attached arrows can extend outside their original box.
        if (n.rotation || n.anchor || intersects(worldRenderBounds(n), view)) {
          const clip = !scene.nodes[n.id] ? options.draftClips?.get(n.id) : undefined;
          if (clip) this.drawClippedNode(lc, scene, n, clip);
          else this.drawNode(lc, scene, n);
        }
        lc.restore();
      }
      if (!options.layerId) for (const child of tree.get(lid) ?? []) renderLayer(child, lc, depth + 1);
      target.save();
      target.resetTransform();
      target.globalAlpha = layer.opacity;
      target.globalCompositeOperation = layer.blend === "normal" || layer.blend === "source-over" ? "source-over" : layer.blend;
      target.drawImage(layerCanvas, depth === 0 ? (partial?.x ?? 0) : 0, depth === 0 ? (partial?.y ?? 0) : 0);
      target.restore();
    };
    if (this.groupSurfaces.some((c) => c.width !== workW || c.height !== workH)) {
      for (const c of this.groupSurfaces) c.width = c.height = 1;
      this.groupSurfaces = [];
    }
    if (options.layerId) {
      if (effectiveLayer(scene, options.layerId).visible) renderLayer(options.layerId, ctx, 0);
    } else {
      const roots = tree.get(null) ?? [],
        start = hit ? plan!.prefixCount : 0;
      const capture = () => {
        if (!plan || plan.epoch !== this.assetEpoch) return;
        this.invalidatePrefix();
        const pixels = ctx.getImageData(0, 0, w, h);
        this.viewportPrefix = { pixels, target: canvas, key: plan.key, keyBytes: plan.keyBytes };
        this.viewportDiagnostics.peakBytes = Math.max(this.viewportDiagnostics.peakBytes, w * h * 4 + plan.keyBytes);
        this.trimStrokeCache();
        this.viewportDiagnostics.misses++;
        this.viewportDiagnostics.lastPrefixRoots = plan.prefixCount;
      };
      for (let i = start; i < roots.length; i++) {
        if (!hit && plan && i === plan.prefixCount) capture();
        renderLayer(roots[i], ctx, 0);
      }
      if (!hit && plan && plan.prefixCount === roots.length) capture();
    }
    ctx.restore();
    ctx.resetTransform();
    if (this.viewportPrefix && plan && this.viewportPrefix.key === plan.key) this.viewportPrefix.hadCompound = compound;
    if (this.viewportPrefix && plan && this.viewportPrefix.key === plan.key)
      this.viewportPrefix.dirty =
        currentDirty ?? (!options.draft && !options.drafts?.length && options.activeLayerId ? { x: 0, y: 0, w: 0, h: 0 } : undefined);
    // Source and device-pixel rounding prevent partially transparent covers at
    // fractional export scales. Clip rectangles first, then paint opaque pixels.
    if (partial) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(partial.x, partial.y, partial.w, partial.h);
      ctx.clip();
    }
    const redactions = [...Object.values(scene.nodes).filter(isRedaction), ...nodes.filter((n) => isRedaction(n) && !scene.nodes[n.id])];
    for (const node of redactions) {
      if (
        !redactionShown(scene, node) ||
        (options.frameId && node.frameId !== null && node.frameId !== options.frameId) ||
        options.hiddenNodeIds?.includes(node.id)
      )
        continue;
      let box = redactionBounds(node);
      const frame = node.frameId ? scene.frames[node.frameId] : null;
      for (const clip of [frame?.clip ? frame : null, options.region])
        if (clip) {
          const x = Math.max(box.x, clip.x),
            y = Math.max(box.y, clip.y);
          box = {
            x,
            y,
            w: Math.max(0, Math.min(box.x + box.w, clip.x + clip.w) - x),
            h: Math.max(0, Math.min(box.y + box.h, clip.y + clip.h) - y),
          };
        }
      if (box.w <= 0 || box.h <= 0) continue;
      const x = Math.min(w, Math.max(0, Math.floor((box.x - view.x) * view.scale))),
        y = Math.min(h, Math.max(0, Math.floor((box.y - view.y) * view.scale))),
        right = Math.max(0, Math.min(w, Math.ceil((box.x + box.w - view.x) * view.scale))),
        bottom = Math.max(0, Math.min(h, Math.ceil((box.y + box.h - view.y) * view.scale)));
      if (right <= x || bottom <= y) continue;
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#000000";
      ctx.fillRect(x, y, right - x, bottom - y);
      ctx.restore();
    }
    if (partial) ctx.restore();
  }
  private drawClippedNode(target: CanvasRenderingContext2D, scene: DrawingScene, n: DrawingNode, clip: DraftClip) {
    const w = target.canvas.width,
      h = target.canvas.height;
    const content = (this.clipContent ??= surface(w, h)),
      alpha = (this.clipAlpha ??= surface(w, h));
    for (const c of [content, alpha])
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
    const cc = ctx2d(content),
      ac = ctx2d(alpha);
    cc.resetTransform();
    cc.clearRect(0, 0, w, h);
    cc.globalAlpha = 1;
    cc.globalCompositeOperation = "source-over";
    this.setMatrix(cc, this.matrix(target));
    this.drawNode(cc, scene, { ...n, erase: false, alphaLock: false });
    ac.resetTransform();
    ac.clearRect(0, 0, w, h);
    ac.globalAlpha = 1;
    ac.globalCompositeOperation = "source-over";
    ac.setTransform(translate(this.matrix(target), clip.rect.x, clip.rect.y));
    ac.drawImage(clip.source, 0, 0, clip.rect.w, clip.rect.h);
    cc.resetTransform();
    cc.globalCompositeOperation = "destination-in";
    cc.drawImage(alpha, 0, 0);
    target.save();
    target.resetTransform();
    target.globalCompositeOperation = n.erase ? "destination-out" : n.alphaLock ? "source-atop" : "source-over";
    target.drawImage(content, 0, 0);
    target.restore();
  }
  private strokeTiles(n: DrawingNode, scene: DrawingScene, requested: Map<string, { x: number; y: number }>, key: string) {
    const b = n.brush!,
      size = 512;
    const pad =
      b.kind === "crayon" || b.kind === "natural-pencil" ? Math.ceil(Math.max(16, b.size * (b.kind === "crayon" ? 0.035 : 0.065) + 2)) : 0;
    const ready = new Map<string, HTMLCanvasElement>(),
      missing: { id: string; x: number; y: number }[] = [];
    for (const [id, tile] of requested) {
      const cacheId = `${n.id}:${id}`,
        old = this.strokes.get(cacheId);
      if (old?.key === key) {
        this.strokes.delete(cacheId);
        this.strokes.set(cacheId, old);
        ready.set(id, old.canvas);
      } else {
        if (old) {
          this.cacheBytes -= old.bytes;
          this.strokes.delete(cacheId);
        }
        missing.push({ id, ...tile });
      }
    }
    for (let index = 0; index < missing.length; index += 16) {
      const group = missing.slice(index, index + 16);
      const minX = Math.min(...group.map((t) => t.x)),
        maxX = Math.max(...group.map((t) => t.x)),
        minY = Math.min(...group.map((t) => t.y)),
        maxY = Math.max(...group.map((t) => t.y));
      const batch = new Map(
        group.map((tile) => {
          const canvas = surface(size + pad * 2, size + pad * 2),
            ctx = ctx2d(canvas);
          this.setMatrix(ctx, { a: 1, b: 0, c: 0, d: 1, e: pad - tile.x * size, f: pad - tile.y * size });
          return [tile.id, { ...tile, canvas, ctx }] as const;
        }),
      );
      if (b.kind === "highlighter" || b.kind === "marker") {
        for (const tile of batch.values())
          this.paintDabs(tile.ctx, iterateStrokeDabs(n.samples ?? [], b, n.seed), b, scene, {
            x: tile.x * size,
            y: tile.y * size,
            w: size,
            h: size,
          });
      } else {
        for (const dab of iterateStrokeDabs(n.samples ?? [], b, n.seed)) {
          // Include antialiased pigment at the edge as well as full granules.
          const radius = this.dabRadius(dab, b) + pad + 1;
          const left = Math.max(minX, Math.floor((dab.x - radius) / size)),
            top = Math.max(minY, Math.floor((dab.y - radius) / size));
          const right = Math.min(maxX, Math.floor((dab.x + radius) / size)),
            bottom = Math.min(maxY, Math.floor((dab.y + radius) / size));
          for (let y = top; y <= bottom; y++)
            for (let x = left; x <= right; x++) {
              const tile = batch.get(`${x}:${y}`);
              if (tile) this.paintDab(tile.ctx, dab, b, scene);
            }
        }
      }
      for (const tile of batch.values()) {
        // Preserve the original accelerated rasterizer, then freeze cold pigment
        // once in a readable surface. Repeated browser readbacks must not migrate
        // a live pigment canvas and change its unpremultiplication rounding.
        const canvas = surface(size, size);
        ctx2d(canvas, true).putImageData(tile.ctx.getImageData(pad, pad, size, size), 0, 0);
        tile.canvas.width = tile.canvas.height = 0;
        const bytes = size * size * 4;
        while (this.cacheBytes + bytes > this.strokeCacheBudget && this.strokes.size) {
          const oldest = this.strokes.keys().next().value!;
          this.cacheBytes -= this.strokes.get(oldest)!.bytes;
          this.strokes.delete(oldest);
        }
        this.strokes.set(`${n.id}:${tile.id}`, { canvas, key, bytes });
        this.cacheBytes += bytes;
        ready.set(tile.id, canvas);
        this.rasterDiagnostics.canonicalTilesGenerated++;
      }
    }
    return ready;
  }
  private strokeIndex(n: DrawingNode, key: string): StrokeSpatialIndex {
    const old = this.spatial.get(n.id);
    if (old?.key === key) {
      this.spatial.delete(n.id);
      this.spatial.set(n.id, old);
      return old.index;
    }
    if (old) {
      this.spatialBytes -= old.index.bytes;
      this.spatial.delete(n.id);
    }
    const index = new StrokeSpatialIndex(n.samples ?? [], n.brush!);
    while (this.spatialBytes + index.bytes > 8 * 1024 * 1024 && this.spatial.size) {
      const first = this.spatial.keys().next().value!,
        entry = this.spatial.get(first)!;
      this.spatial.delete(first);
      this.spatialBytes -= entry.index.bytes;
    }
    this.spatial.set(n.id, { key, index });
    this.spatialBytes += index.bytes;
    return index;
  }
  private strokeMipTile(
    n: DrawingNode,
    scene: DrawingScene,
    key: string,
    index: StrokeSpatialIndex,
    x: number,
    y: number,
    lx: number,
    ly: number,
  ): HTMLCanvasElement {
    const size = 512,
      id = `${n.id}:lod:${lx}:${ly}:${x}:${y}`,
      old = this.strokes.get(id);
    if (old?.key === key) {
      this.strokes.delete(id);
      this.strokes.set(id, old);
      return old.canvas;
    }
    if (old) {
      this.cacheBytes -= old.bytes;
      this.strokes.delete(id);
    }
    if (!index.intersects({ x: x * size * 2 ** lx, y: y * size * 2 ** ly, w: size * 2 ** lx, h: size * 2 ** ly }))
      return (this.emptyTile ??= surface(size, size));
    if (!lx && !ly) return this.strokeTiles(n, scene, new Map([[`${x}:${y}`, { x, y }]]), key).get(`${x}:${y}`)!;
    const canvas = surface(size, size),
      ctx = ctx2d(canvas, true);
    // Separable, global-grid reduction: Y levels precede X levels. Each exact
    // 2:1 pass consumes aligned pairs of original canonical pixels.
    for (let i = 0; i < 2; i++) {
      const child = this.strokeMipTile(n, scene, key, index, lx ? x * 2 + i : x, lx ? y : y * 2 + i, lx ? lx - 1 : 0, lx ? ly : ly - 1);
      if (child === this.emptyTile) continue;
      const reduced = reducePigmentPairs(
        { width: size, height: size, data: ctx2d(child).getImageData(0, 0, size, size).data },
        lx ? "x" : "y",
      );
      ctx.putImageData(
        new ImageData(new Uint8ClampedArray(reduced.data), reduced.width, reduced.height),
        lx ? (i * size) / 2 : 0,
        lx ? 0 : (i * size) / 2,
      );
    }
    const bytes = size * size * 4;
    while (this.cacheBytes + bytes > this.strokeCacheBudget && this.strokes.size) {
      const first = this.strokes.keys().next().value!,
        entry = this.strokes.get(first)!;
      this.strokes.delete(first);
      this.cacheBytes -= entry.bytes;
    }
    this.strokes.set(id, { key, canvas, bytes });
    this.cacheBytes += bytes;
    this.rasterDiagnostics.mipTilesGenerated++;
    return canvas;
  }
  private sampledStrokeTiles(
    n: DrawingNode,
    scene: DrawingScene,
    requested: Map<string, { x: number; y: number }>,
    key: string,
    lx: number,
    ly: number,
  ) {
    if (!lx && !ly) return this.strokeTiles(n, scene, requested, key);
    const index = this.strokeIndex(n, key),
      ready = new Map<string, HTMLCanvasElement>();
    for (const [id, p] of requested) ready.set(id, this.strokeMipTile(n, scene, key, index, p.x, p.y, lx, ly));
    return ready;
  }
  private drawStroke(target: CanvasRenderingContext2D, n: DrawingNode, scene: DrawingScene) {
    if (n.brush?.kind === "highlighter" || n.brush?.kind === "marker") {
      this.rasterDiagnostics.backend = "uniform";
      this.rasterDiagnostics.levelX = this.rasterDiagnostics.levelY = 0;
      this.drawUniformStroke(target, n);
      return;
    }
    const sourceMatrix = this.matrix(target),
      lod = strokeLod(sourceMatrix),
      stepX = 2 ** lod.x,
      stepY = 2 ** lod.y,
      matrix = scaleMatrix(sourceMatrix, stepX, stepY),
      inverse = invertMatrix(matrix);
    this.rasterDiagnostics.sourceMatrix = [sourceMatrix.a, sourceMatrix.b, sourceMatrix.c, sourceMatrix.d, sourceMatrix.e, sourceMatrix.f];
    this.rasterDiagnostics.levelX = lod.x;
    this.rasterDiagnostics.levelY = lod.y;
    const tip = n.brush?.kind === "texture" ? this.asset(scene, n.brush.tipAssetId) : null;
    const key = JSON.stringify([n.brush, n.seed, n.samples, scene.assets[n.brush?.tipAssetId ?? ""]?.attachmentId, !!tip]);
    const visible = bounds(
      [
        { x: 0, y: 0 },
        { x: target.canvas.width, y: 0 },
        { x: 0, y: target.canvas.height },
        { x: target.canvas.width, y: target.canvas.height },
      ].map((p) => transformPoint(inverse, p)),
    );
    const size = 512,
      original = sourceInkRect(n),
      ink = { x: original.x / stepX, y: original.y / stepY, w: original.w / stepX, h: original.h / stepY },
      mipHalo = lod.x || lod.y ? 1 : 0;
    const minX = Math.floor(ink.x / size) - mipHalo,
      minY = Math.floor(ink.y / size) - mipHalo,
      maxX = Math.ceil((ink.x + ink.w) / size) - 1 + mipHalo,
      maxY = Math.ceil((ink.y + ink.h) / size) - 1 + mipHalo;
    const aligned =
      !lod.x &&
      !lod.y &&
      Math.abs(matrix.a) === 1 &&
      Math.abs(matrix.d) === 1 &&
      matrix.b === 0 &&
      matrix.c === 0 &&
      Number.isInteger(matrix.e) &&
      Number.isInteger(matrix.f);
    this.rasterDiagnostics.backend = aligned ? "aligned" : "canvas";
    const halo = aligned ? 0 : 1;
    const x0 = Math.max(minX, Math.floor(visible.x / size) - halo),
      y0 = Math.max(minY, Math.floor(visible.y / size) - halo);
    const x1 = Math.min(maxX, Math.floor((visible.x + visible.w) / size) + halo),
      y1 = Math.min(maxY, Math.floor((visible.y + visible.h) / size) + halo);
    if (x0 > x1 || y0 > y1) return;
    if (aligned) {
      let batch: { x: number; y: number }[] = [];
      const draw = () => {
        const ready = this.strokeTiles(n, scene, new Map(batch.map((p) => [`${p.x}:${p.y}`, p])), key);
        for (const p of batch) target.drawImage(ready.get(`${p.x}:${p.y}`)!, p.x * size, p.y * size);
        batch = [];
      };
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          batch.push({ x, y });
          if (batch.length === 16) draw();
        }
      if (batch.length) draw();
      return;
    }
    const gpu = !aligned && this.options.tileBackend !== "canvas" ? tileCompositor() : null;
    if (gpu?.begin(this, target.canvas.width, target.canvas.height, this.assetChanged)) {
      try {
        const drawGPU = (tiles: { x: number; y: number }[]) => {
          const requested = new Map<string, { x: number; y: number }>();
          for (const tile of tiles)
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) {
                const x = tile.x + dx,
                  y = tile.y + dy;
                if (x >= minX && x <= maxX && y >= minY && y <= maxY) requested.set(`${x}:${y}`, { x, y });
              }
          const ready = this.sampledStrokeTiles(n, scene, requested, key, lod.x, lod.y);
          for (const tile of tiles)
            gpu.draw(
              this,
              `${n.id}:lod:${lod.x}:${lod.y}:${tile.x}:${tile.y}`,
              key,
              { x: tile.x * size, y: tile.y * size, w: size, h: size },
              matrix,
              () => this.strokeHalo(ready, tile),
            );
        };
        let tiles: { x: number; y: number }[] = [];
        for (let y = y0; y <= y1; y++)
          for (let x = x0; x <= x1; x++) {
            tiles.push({ x, y });
            if (tiles.length === 16) {
              drawGPU(tiles);
              tiles = [];
            }
          }
        if (tiles.length) drawGPU(tiles);
        const image = gpu.finish();
        if (image) {
          target.save();
          target.resetTransform();
          target.drawImage(image, 0, 0);
          target.restore();
          this.rasterDiagnostics.backend = "gpu";
          return;
        }
      } catch {
        releaseTileCompositor(this);
      }
    }
    this.drawStrokeCanvas(target, n, scene, key, matrix, inverse, minX, minY, maxX, maxY, lod.x, lod.y);
  }
  private drawStrokeCanvas(
    target: CanvasRenderingContext2D,
    n: DrawingNode,
    scene: DrawingScene,
    key: string,
    matrix: Affine,
    inverse: Affine,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    lx: number,
    ly: number,
  ) {
    // Integer device-pixel clips partition the output. Each source mosaic has
    // neighboring texels around the whole clip, so no canonical tile boundary
    // becomes a filtered image edge and no quad coverage is added twice.
    const size = 512,
      block = 128,
      canvas = (this.strokeSurface ??= surface(target.canvas.width, target.canvas.height));
    if (canvas.width !== target.canvas.width || canvas.height !== target.canvas.height) {
      canvas.width = target.canvas.width;
      canvas.height = target.canvas.height;
    }
    const destination = ctx2d(canvas);
    destination.resetTransform();
    destination.clearRect(0, 0, canvas.width, canvas.height);
    destination.globalAlpha = 1;
    destination.globalCompositeOperation = "source-over";
    for (let by = 0; by < canvas.height; by += block)
      for (let bx = 0; bx < canvas.width; bx += block) {
        const w = Math.min(block, canvas.width - bx),
          h = Math.min(block, canvas.height - by);
        const area = bounds(
          [
            { x: bx, y: by },
            { x: bx + w, y: by },
            { x: bx + w, y: by + h },
            { x: bx, y: by + h },
          ].map((p) => transformPoint(inverse, p)),
          2,
        );
        const x0 = Math.max(minX, Math.floor(area.x / size)),
          y0 = Math.max(minY, Math.floor(area.y / size)),
          x1 = Math.min(maxX, Math.floor((area.x + area.w) / size)),
          y1 = Math.min(maxY, Math.floor((area.y + area.h) / size));
        if (x0 > x1 || y0 > y1) continue;
        const patch = (this.strokePatch ??= surface(1, 1)),
          pw = (x1 - x0 + 1) * size,
          ph = (y1 - y0 + 1) * size;
        this.rasterDiagnostics.maxPatchPixels = Math.max(this.rasterDiagnostics.maxPatchPixels, pw * ph);
        if (patch.width !== pw || patch.height !== ph) {
          patch.width = pw;
          patch.height = ph;
        }
        const pc = ctx2d(patch);
        pc.resetTransform();
        pc.clearRect(0, 0, pw, ph);
        let batch: { x: number; y: number }[] = [];
        const copy = () => {
          const requested = new Map(batch.map((tile) => [tile.x + ":" + tile.y, tile])),
            ready = this.sampledStrokeTiles(n, scene, requested, key, lx, ly);
          for (const tile of batch) pc.drawImage(ready.get(tile.x + ":" + tile.y)!, (tile.x - x0) * size, (tile.y - y0) * size);
          batch = [];
        };
        for (let y = y0; y <= y1; y++)
          for (let x = x0; x <= x1; x++) {
            batch.push({ x, y });
            if (batch.length === 16) copy();
          }
        if (batch.length) copy();
        destination.save();
        destination.beginPath();
        destination.rect(bx, by, w, h);
        destination.clip();
        destination.setTransform(translate(matrix, x0 * size, y0 * size));
        destination.drawImage(patch, 0, 0);
        destination.restore();
      }
    target.save();
    target.resetTransform();
    target.drawImage(canvas, 0, 0);
    target.restore();
  }
  private strokeHalo(ready: Map<string, HTMLCanvasElement>, tile: { x: number; y: number }) {
    const size = 512,
      padded = (this.strokePadding ??= surface(size + 2, size + 2)),
      pc = ctx2d(padded);
    pc.resetTransform();
    pc.clearRect(0, 0, size + 2, size + 2);
    pc.drawImage(ready.get(`${tile.x}:${tile.y}`)!, 1, 1);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const neighbor = ready.get(`${tile.x + dx}:${tile.y + dy}`);
        if (!neighbor) continue;
        const sx = dx < 0 ? size - 1 : 0,
          sy = dy < 0 ? size - 1 : 0,
          w = dx ? 1 : size,
          h = dy ? 1 : size;
        pc.drawImage(neighbor, sx, sy, w, h, dx < 0 ? 0 : dx > 0 ? size + 1 : 1, dy < 0 ? 0 : dy > 0 ? size + 1 : 1, w, h);
      }
    return padded;
  }
  private drawUniformStroke(target: CanvasRenderingContext2D, n: DrawingNode) {
    const b = normalizeBrush(n.brush!),
      samples = straightStrokeSamples(n.samples ?? [], b.straightLine);
    if (!samples.length) return;
    requireStrokeBudget(samples, b);
    if (!this.strokeSurface) this.strokeSurface = surface(target.canvas.width, target.canvas.height);
    const canvas = this.strokeSurface;
    if (canvas.width !== target.canvas.width || canvas.height !== target.canvas.height) {
      canvas.width = target.canvas.width;
      canvas.height = target.canvas.height;
    }
    const ctx = ctx2d(canvas);
    ctx.resetTransform();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.setTransform(this.matrix(target));
    ctx.fillStyle = b.color;
    ctx.strokeStyle = b.color;
    ctx.lineWidth = b.size;
    ctx.lineJoin = "round";
    ctx.lineCap = b.kind === "highlighter" ? "butt" : "round";
    ctx.beginPath();
    if (samples.length === 1) {
      const p = samples[0],
        r = uniformStrokeRadii(samples, b)[0];
      if (b.kind === "marker") {
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      } else ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
    } else if (!b.pressureSize && !b.taperStart && !b.taperEnd) {
      samples.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
    } else {
      const radii = uniformStrokeRadii(samples, b);
      let segments = 0;
      for (let i = 1; i < samples.length; i++) {
        const p = samples[i - 1],
          q = samples[i],
          dx = q.x - p.x,
          dy = q.y - p.y,
          length = Math.hypot(dx, dy);
        if (!length) continue;
        const nx = -dy / length,
          ny = dx / length,
          a = radii[i - 1],
          z = radii[i];
        segments++;
        ctx.moveTo(p.x + nx * a, p.y + ny * a);
        ctx.lineTo(p.x - nx * a, p.y - ny * a);
        ctx.lineTo(q.x - nx * z, q.y - ny * z);
        ctx.lineTo(q.x + nx * z, q.y + ny * z);
        ctx.closePath();
      }
      for (let i = 0; i < samples.length; i++)
        if (b.kind === "marker" || (i > 0 && i < samples.length - 1)) {
          const p = samples[i],
            r = radii[i];
          ctx.moveTo(p.x + r, p.y);
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.closePath();
        }
      if (!segments && b.kind === "highlighter") {
        const p = samples[0];
        let r = 0.1;
        for (const radius of radii) r = Math.max(r, radius);
        ctx.rect(p.x - r, p.y - r, r * 2, r * 2);
      }
      ctx.fill();
    }
    target.save();
    target.resetTransform();
    target.globalAlpha *= b.flow;
    target.drawImage(canvas, 0, 0);
    target.restore();
  }
  private dabRadius(dab: Dab, b: NonNullable<DrawingNode["brush"]>) {
    const r = dab.size / 2;
    if (b.kind === "texture") return r * Math.hypot(1, dab.roundness);
    if (b.kind === "crayon" || b.kind === "natural-pencil") return r + Math.max(0.3, dab.size * (b.kind === "crayon" ? 0.035 : 0.065));
    if (b.kind === "watercolor") return Math.max(r, r * 0.9 + Math.max(0.5, r * 0.04) / 2);
    return r;
  }
  private paintDabs(
    ctx: CanvasRenderingContext2D,
    dabs: Iterable<Dab>,
    b: NonNullable<DrawingNode["brush"]>,
    scene: DrawingScene,
    tile: Rect,
  ) {
    const highlighter = b.kind === "highlighter" || b.kind === "marker";
    if (highlighter) {
      ctx.fillStyle = b.color;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = b.size;
      ctx.lineJoin = "round";
      ctx.lineCap = b.kind === "highlighter" ? "butt" : "round";
      let first: Dab | undefined,
        count = 0;
      ctx.beginPath();
      for (const p of dabs) {
        if (!count++) {
          first = p;
          ctx.moveTo(p.x, p.y);
        } else ctx.lineTo(p.x, p.y);
      }
      if (count === 1 && first) ctx.fillRect(first.x - b.size / 2, first.y - b.size / 2, b.size, b.size);
      else if (count) ctx.stroke();
    } else
      for (const dab of dabs) {
        const radius = this.dabRadius(dab, b) + 1;
        if (!intersects({ x: dab.x - radius, y: dab.y - radius, w: radius * 2, h: radius * 2 }, tile)) continue;
        this.paintDab(ctx, dab, b, scene);
      }
  }
  private paintDab(ctx: CanvasRenderingContext2D, dab: Dab, b: NonNullable<DrawingNode["brush"]>, scene: DrawingScene) {
    // A binary subpixel grid keeps small pigment circles independent of the
    // canvas's integer tile origin. Original pointer/pressure data is intact.
    ctx.save();
    ctx.setTransform(
      scaleMatrix(
        rotate(translate(this.matrix(ctx), rasterSubpixel(dab.x), rasterSubpixel(dab.y)), (dab.angle * Math.PI) / 180),
        1,
        dab.roundness,
      ),
    );
    ctx.globalAlpha = dab.opacity;
    let noise = (dab.noise * 4294967296) >>> 0 || 1;
    const random = () => {
      noise ^= noise << 13;
      noise ^= noise >>> 17;
      noise ^= noise << 5;
      return (noise >>> 0) / 4294967296;
    };
    if (b.kind === "crayon" || b.kind === "natural-pencil") {
      ctx.fillStyle = b.color;
      const count = Math.min(256, Math.max(5, Math.ceil(dab.size * (b.kind === "crayon" ? 5 : 4))));
      for (let i = 0; i < count; i++) {
        const a = random() * Math.PI * 2,
          radius = (Math.sqrt(random()) * dab.size) / 2;
        ctx.globalAlpha = dab.opacity * (0.15 + random() * 0.85);
        ctx.beginPath();
        ctx.arc(
          rasterSubpixel(Math.cos(a) * radius),
          rasterSubpixel(Math.sin(a) * radius),
          rasterSubpixel(Math.max(0.3, dab.size * (b.kind === "crayon" ? 0.035 : 0.065) * random())),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.restore();
      return;
    }
    if (b.kind === "oil") {
      ctx.beginPath();
      ctx.arc(0, 0, dab.size / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = b.color;
      ctx.globalAlpha = dab.opacity * 0.08;
      ctx.fillRect(-dab.size / 2, -dab.size / 2, dab.size, dab.size);
      ctx.strokeStyle = b.color;
      ctx.lineWidth = Math.max(0.4, dab.size / 30);
      for (let i = 0; i < 12; i++) {
        const x = (i / 11 - 0.5) * dab.size;
        ctx.globalAlpha = dab.opacity * (0.2 + random() * 0.7);
        ctx.beginPath();
        ctx.moveTo(x, -dab.size / 2);
        ctx.lineTo(x + (random() - 0.5) * dab.size * 0.08, dab.size / 2);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    if (b.kind === "watercolor") {
      const radius = dab.size / 2,
        wash = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
      wash.addColorStop(0, b.color);
      wash.addColorStop(0.65, b.color);
      wash.addColorStop(1, "transparent");
      ctx.fillStyle = wash;
      ctx.globalAlpha = dab.opacity * 0.55;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = b.color;
      ctx.lineWidth = Math.max(0.5, radius * 0.04);
      ctx.globalAlpha = dab.opacity * 0.08;
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      return;
    }
    if (b.kind === "texture") {
      const img = this.asset(scene, b.tipAssetId);
      if (img) {
        ctx.drawImage(img, -dab.size / 2, -dab.size / 2, dab.size, dab.size);
        ctx.restore();
        return;
      }
    }
    const r = dab.size / 2;
    if (b.hardness < 0.99) {
      const gradient = ctx.createRadialGradient(0, 0, r * b.hardness, 0, 0, r);
      gradient.addColorStop(0, b.color);
      gradient.addColorStop(1, "transparent");
      ctx.fillStyle = gradient;
    } else ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  private drawNode(ctx: CanvasRenderingContext2D, scene: DrawingScene, n: DrawingNode, skipMask = false) {
    const baseMatrix = this.matrix(ctx);
    const mask = n.maskId ? scene.masks[n.maskId] : undefined;
    if (!skipMask && mask?.enabled) {
      const content = surface(ctx.canvas.width, ctx.canvas.height),
        cc = ctx2d(content);
      this.setMatrix(cc, baseMatrix);
      this.drawNode(cc, scene, { ...n, erase: false, alphaLock: false }, true);
      const alpha = surface(content.width, content.height),
        mc = ctx2d(alpha);
      const maskMatrix = mask.linked ? nodeMatrix(baseMatrix, n) : baseMatrix;
      this.setMatrix(mc, maskMatrix);
      const x = mask.x,
        y = mask.y,
        w = mask.w ?? (mask.linked ? (n.geometrySize?.w ?? n.w) : n.w),
        h = mask.h ?? (mask.linked ? (n.geometrySize?.h ?? n.h) : n.h);
      mc.setTransform(translate(maskMatrix, x, y));
      mc.fillStyle = `rgba(255,255,255,${mask.base ?? (mask.assetId ? 0 : 1)})`;
      mc.fillRect(0, 0, w, h);
      const img = this.asset(scene, mask.assetId);
      if (img) mc.drawImage(img, 0, 0, w, h);
      this.drawMaskStrokes(mc, maskMatrix, mask);
      if (mask.inverted) {
        const inverted = surface(alpha.width, alpha.height),
          ic = ctx2d(inverted);
        ic.fillStyle = "#ffffff";
        ic.fillRect(0, 0, inverted.width, inverted.height);
        ic.globalCompositeOperation = "destination-out";
        ic.drawImage(alpha, 0, 0);
        mc.resetTransform();
        mc.clearRect(0, 0, alpha.width, alpha.height);
        mc.globalCompositeOperation = "source-over";
        mc.globalAlpha = 1;
        mc.drawImage(inverted, 0, 0);
        inverted.width = inverted.height = 1;
      }
      cc.resetTransform();
      cc.globalCompositeOperation = "destination-in";
      cc.drawImage(alpha, 0, 0);
      ctx.save();
      ctx.resetTransform();
      ctx.globalCompositeOperation = n.erase ? "destination-out" : n.alphaLock ? "source-atop" : "source-over";
      ctx.drawImage(content, 0, 0);
      ctx.restore();
      content.width = content.height = alpha.width = alpha.height = 1;
      return;
    }
    // Non-image objects can use the same ordered, independently masked
    // adjustments as images. Work in device coordinates so masks retain their
    // linked or world placement under rotation and zoom.
    if (n.kind !== "image" && n.kind !== "raster" && n.effects.some((e) => e.enabled && e.maskId)) {
      let current = surface(ctx.canvas.width, ctx.canvas.height);
      const original = ctx2d(current);
      this.setMatrix(original, baseMatrix);
      this.drawNode(original, scene, { ...n, effects: [], maskId: undefined, erase: false, alphaLock: false }, true);
      for (const effect of n.effects) {
        const filter = effect.enabled ? canvasEffect(effect) : "";
        if (!filter) continue;
        const effectMask = effect.maskId ? scene.masks[effect.maskId] : undefined;
        // A missing mask must never accidentally expand an adjustment to the whole object.
        if (effect.maskId && !effectMask) continue;
        // Trigger asynchronous asset loading and retain the previous image until ready.
        if (effectMask?.enabled && effectMask.assetId && !this.asset(scene, effectMask.assetId)) continue;
        const filtered = surface(current.width, current.height),
          fc = ctx2d(filtered);
        fc.filter = filter;
        fc.drawImage(current, 0, 0);
        fc.filter = "none";
        if (effectMask?.enabled) {
          const matrix = effectMask.linked ? nodeMatrix(baseMatrix, n) : baseMatrix;
          const alpha = this.maskSurface(scene, n, effectMask, current.width, current.height, matrix);
          fc.globalCompositeOperation = "destination-in";
          fc.drawImage(alpha, 0, 0);
          const cc = ctx2d(current);
          cc.globalCompositeOperation = "destination-out";
          cc.drawImage(alpha, 0, 0);
          cc.globalCompositeOperation = "lighter";
          cc.drawImage(filtered, 0, 0);
          cc.globalCompositeOperation = "source-over";
          alpha.width = alpha.height = filtered.width = filtered.height = 1;
        } else {
          current.width = current.height = 1;
          current = filtered;
        }
      }
      ctx.save();
      ctx.resetTransform();
      ctx.globalCompositeOperation = n.erase ? "destination-out" : n.alphaLock ? "source-atop" : "source-over";
      ctx.drawImage(current, 0, 0);
      ctx.restore();
      current.width = current.height = 1;
      return;
    }
    ctx.save();
    ctx.globalAlpha = n.opacity;
    if (n.erase) ctx.globalCompositeOperation = "destination-out";
    else if (n.alphaLock) ctx.globalCompositeOperation = "source-atop";
    const filters = n.effects
      .filter((e) => e.enabled)
      .map(canvasEffect)
      .filter(Boolean)
      .join(" ");
    if (filters && n.kind !== "image" && n.kind !== "raster") ctx.filter = filters;
    if (n.kind === "shape" && n.anchor) {
      const start = anchorPoint(scene, n.anchor).point,
        end = n.endAnchor ? anchorPoint(scene, n.endAnchor).point : { x: n.x + n.w, y: n.y + n.h };
      const scale = n.geometrySize ? Math.sqrt(((n.w / n.geometrySize.w) * n.h) / n.geometrySize.h) : 1;
      ctx.setTransform(translate(baseMatrix, start.x, start.y));
      this.drawArrow(
        ctx,
        { x: 0, y: 0 },
        { x: end.x - start.x, y: end.y - start.y },
        { ...n.paint, strokeWidth: n.paint.strokeWidth * scale },
        n.shape === "double-arrow",
        scale,
      );
      ctx.restore();
      return;
    }
    this.setMatrix(ctx, nodeMatrix(baseMatrix, n));
    if (n.geometrySize && !(n.kind === "text" && n.textStyle.resizeMode === "wrap")) n = { ...n, w: n.geometrySize.w, h: n.geometrySize.h };
    if (n.kind === "stroke") {
      ctx.globalAlpha *= n.brush?.opacity ?? 1;
      this.drawStroke(ctx, n, scene);
    } else if (n.kind === "image" || n.kind === "raster") {
      const img = this.asset(scene, n.assetId);
      const hasEffects = n.effects.some((e) => e.enabled),
        key = this.effectKey(scene, n);
      if (img && hasEffects) {
        const processed = this.effects.get(key);
        if (processed) ctx.drawImage(processed, 0, 0, n.w, n.h);
        else {
          if (!this.processing.has(key) && !this.effectErrors.has(key)) void this.processImage(scene, n).catch(() => {});
          ctx.fillStyle = "#e8e8e8";
          ctx.fillRect(0, 0, n.w, n.h);
          ctx.fillStyle = "#555555";
          ctx.font = "16px sans-serif";
          ctx.fillText(this.effectErrors.get(key) ?? "Processing image", 12, 28, n.w - 24);
        }
      } else if (img) {
        const crop = n.crop ?? { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
        ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, n.w, n.h);
      } else if (!n.erase) {
        ctx.fillStyle = "#e8e8e8";
        ctx.fillRect(0, 0, n.w, n.h);
        ctx.fillStyle = "#555555";
        ctx.font = "16px sans-serif";
        const a = scene.assets[n.assetId ?? ""];
        ctx.fillText(a && this.failedImages.has(imageCacheKey(a.attachmentId, a)) ? "Image unavailable" : "Loading image", 12, 28);
      }
    } else if (n.kind === "text") this.drawText(ctx, n);
    else if (n.kind === "reference") {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, n.w, n.h);
      ctx.clip();
      this.drawReference(ctx, scene, n);
      ctx.restore();
    } else this.drawShape(ctx, n);
    ctx.restore();
    this.matrices.set(ctx, baseMatrix);
  }
  private drawReference(ctx: CanvasRenderingContext2D, scene: DrawingScene, n: DrawingNode) {
    const data =
      n.sourceMode === "snapshot" && n.referenceSnapshot
        ? { ...n.referenceSnapshot, state: "ready" as const }
        : n.sourceId
          ? this.references.get(n.sourceId)
          : { state: "unavailable" as const };
    const ready = data.state === "ready",
      snapshot = n.sourceMode === "snapshot",
      arabic = n.textStyle.direction === "rtl";
    ctx.beginPath();
    ctx.rect(0, 0, n.w, n.h);
    ctx.clip();
    ctx.fillStyle = n.paint.fill === "transparent" ? "#f6f6f6" : n.paint.fill;
    ctx.fillRect(0, 0, n.w, n.h);
    ctx.strokeStyle = n.paint.stroke;
    ctx.lineWidth = n.paint.strokeWidth;
    ctx.strokeRect(0, 0, n.w, n.h);
    const label =
      data.state === "offline"
        ? arabic
          ? "غير متصل، أعد التحقق"
          : "Offline, reconnect to check"
        : ready
          ? ("title" in data ? data.title : "") || (arabic ? "بدون عنوان" : "Untitled")
          : data.state === "loading"
            ? arabic
              ? "جارٍ قراءة المصدر"
              : "Loading source"
            : arabic
              ? "المصدر غير متاح"
              : "Source unavailable";
    const title = {
      ...n,
      text: label,
      w: n.w - 28,
      h: 56,
      textStyle: {
        ...n.textStyle,
        size: 21,
        color: "#202023",
        leading: 1.35,
        weight: 600,
        background: "transparent",
        border: "transparent",
      },
    };
    ctx.save();
    ctx.translate(14, 12);
    ctx.beginPath();
    ctx.rect(0, 0, n.w - 28, 56);
    ctx.clip();
    this.drawText(ctx, title);
    ctx.restore();
    if (!ready) {
      if (data.state === "offline" && data.lastReadyAt) {
        ctx.fillStyle = "#565656";
        ctx.font = "12px sans-serif";
        ctx.fillText(
          `${arabic ? "آخر تحقق ناجح" : "Last successful check"}: ${new Date(data.lastReadyAt).toLocaleString()}`,
          14,
          n.h - 14,
          Math.max(1, n.w - 28),
        );
      }
      return;
    }
    const info = data as import("./references").ReferencePreview,
      image = snapshot ? this.asset(scene, n.assetId) : info.imageAttachmentId ? this.attachment(info.imageAttachmentId) : null;
    if (image) {
      const s = Math.min(88 / image.naturalWidth, 74 / image.naturalHeight);
      ctx.drawImage(image, 14, 76, image.naturalWidth * s, image.naturalHeight * s);
    }
    ctx.save();
    ctx.translate(image ? 114 : 14, 76);
    ctx.beginPath();
    ctx.rect(0, 0, n.w - (image ? 128 : 28), Math.max(0, n.h - 112));
    ctx.clip();
    this.drawText(ctx, {
      ...title,
      text: info.excerpt ?? "",
      w: n.w - (image ? 128 : 28),
      textStyle: { ...title.textStyle, size: 15, weight: 400, leading: 1.5, color: "#4c4c4c" },
    });
    ctx.restore();
    const tasks = info.tasksTotal ? `${info.tasksDone ?? 0}/${info.tasksTotal} ${arabic ? "مهام" : "tasks"} · ` : "";
    ctx.fillStyle = "#565656";
    ctx.font = "12px 'IBM Plex Sans Arabic', sans-serif";
    ctx.textAlign = "left";
    ctx.direction = "ltr";
    const date = new Date(info.checkedAt ?? Date.now()).toLocaleString();
    ctx.fillText(`${tasks}${snapshot ? (arabic ? "لقطة" : "Snapshot") : arabic ? "مرتبط" : "Linked"} · ${date}`, 14, n.h - 14, n.w - 28);
  }
  hitTest(scene: DrawingScene, point: Point): DrawingNode | null {
    for (const node of Object.values(scene.nodes).filter(isRedaction).reverse()) {
      if (!redactionShown(scene, node) || node.locked || effectiveLayer(scene, node.layerId).locked) continue;
      const b = redactionBounds(node),
        f = node.frameId ? scene.frames[node.frameId] : undefined;
      if (f?.clip && (point.x < f.x || point.y < f.y || point.x > f.x + f.w || point.y > f.y + f.h)) continue;
      if (point.x >= b.x && point.y >= b.y && point.x < b.x + b.w && point.y < b.y + b.h) return node;
    }
    const pixel = surface(1, 1),
      ctx = ctx2d(pixel);
    for (const layerId of layerDisplayOrder(scene).reverse()) {
      const layer = effectiveLayer(scene, layerId);
      if (!layer.visible || layer.locked) continue;
      for (const id of [...scene.nodeOrder].reverse()) {
        const n = scene.nodes[id];
        if (n.layerId !== layerId || !n.visible || n.locked || n.erase || n.opacity === 0) continue;
        const f = n.frameId ? scene.frames[n.frameId] : undefined;
        if (f?.clip && (point.x < f.x || point.y < f.y || point.x > f.x + f.w || point.y > f.y + f.h)) continue;
        if (!n.anchor && !contains(n, point)) continue;
        ctx.resetTransform();
        ctx.clearRect(0, 0, 1, 1);
        this.setMatrix(ctx, { a: 1, b: 0, c: 0, d: 1, e: -point.x, f: -point.y });
        this.drawNode(ctx, scene, { ...n, alphaLock: false });
        try {
          if (ctx.getImageData(0, 0, 1, 1).data[3] > 4) return n;
        } catch {
          if (contains(n, point)) return n;
        }
      }
    }
    return null;
  }
  private fill(ctx: CanvasRenderingContext2D, paint: Paint) {
    if (paint.gradient) {
      const g = paint.gradient;
      const gradient =
        g.type === "linear"
          ? ctx.createLinearGradient(g.from.x, g.from.y, g.to.x, g.to.y)
          : ctx.createRadialGradient(g.from.x, g.from.y, 0, g.from.x, g.from.y, Math.hypot(g.to.x - g.from.x, g.to.y - g.from.y));
      g.stops.forEach((s) => gradient.addColorStop(s.at, s.color));
      ctx.fillStyle = gradient;
    } else ctx.fillStyle = paint.fill;
    ctx.strokeStyle = paint.stroke;
    ctx.lineWidth = paint.strokeWidth;
    ctx.setLineDash(paint.dash);
    ctx.lineCap = paint.cap;
    ctx.lineJoin = "round";
  }
  private drawArrow(ctx: CanvasRenderingContext2D, a: Point, b: Point, paint: Paint, both: boolean, headScale = 1) {
    this.fill(ctx, paint);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const head = (p: Point, q: Point) => {
      const angle = Math.atan2(p.y - q.y, p.x - q.x),
        size = Math.max(10 * headScale, paint.strokeWidth * 4);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - size * Math.cos(angle - 0.45), p.y - size * Math.sin(angle - 0.45));
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - size * Math.cos(angle + 0.45), p.y - size * Math.sin(angle + 0.45));
      ctx.stroke();
    };
    head(b, a);
    if (both) head(a, b);
  }
  private drawShape(ctx: CanvasRenderingContext2D, n: DrawingNode) {
    this.fill(ctx, n.paint);
    const { w, h } = n;
    if (n.shape === "arrow" || n.shape === "double-arrow") {
      this.drawArrow(ctx, n.points?.[0] ?? { x: 0, y: 0 }, n.points?.at(-1) ?? { x: w, y: h }, n.paint, n.shape === "double-arrow");
      return;
    }
    ctx.beginPath();
    if (n.path) {
      const first = n.path.vertices[0];
      ctx.moveTo(first.x, first.y);
      for (const segment of pathSegments(n.path)) {
        if (segment.curve) ctx.bezierCurveTo(segment.c1.x, segment.c1.y, segment.c2.x, segment.c2.y, segment.b.x, segment.b.y);
        else ctx.lineTo(segment.b.x, segment.b.y);
      }
      if (n.path.closed) ctx.closePath();
    } else if (n.points?.length) {
      n.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      if (!["line", "polyline", "curve"].includes(n.shape ?? "")) ctx.closePath();
    } else
      switch (n.shape) {
        case "ellipse":
          ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
          break;
        case "triangle":
          ctx.moveTo(w / 2, 0);
          ctx.lineTo(w, h);
          ctx.lineTo(0, h);
          ctx.closePath();
          break;
        case "right-triangle":
          ctx.moveTo(0, 0);
          ctx.lineTo(0, h);
          ctx.lineTo(w, h);
          ctx.closePath();
          break;
        case "line":
          ctx.moveTo(0, 0);
          ctx.lineTo(w, h);
          break;
        case "star":
        case "polygon": {
          const sides = n.shape === "star" ? 10 : 6;
          for (let i = 0; i < sides; i++) {
            const angle = (i * Math.PI * 2) / sides - Math.PI / 2,
              r = n.shape === "star" && i % 2 ? 0.42 : 1;
            const x = w / 2 + ((Math.cos(angle) * w) / 2) * r,
              y = h / 2 + ((Math.sin(angle) * h) / 2) * r;
            if (i) ctx.lineTo(x, y);
            else ctx.moveTo(x, y);
          }
          ctx.closePath();
          break;
        }
        case "number":
          ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
          break;
        case "callout": {
          const b = h * 0.75,
            r = Math.min(n.paint.radius, w / 2, b / 2);
          ctx.moveTo(r, 0);
          ctx.lineTo(w - r, 0);
          ctx.quadraticCurveTo(w, 0, w, r);
          ctx.lineTo(w, b - r);
          ctx.quadraticCurveTo(w, b, w - r, b);
          ctx.lineTo(w * 0.55, b);
          ctx.lineTo(w * 0.35, h);
          ctx.lineTo(w * 0.35, b);
          ctx.lineTo(r, b);
          ctx.quadraticCurveTo(0, b, 0, b - r);
          ctx.lineTo(0, r);
          ctx.quadraticCurveTo(0, 0, r, 0);
          ctx.closePath();
          break;
        }
        case "roundrect":
          ctx.roundRect(0, 0, w, h, Math.min(n.paint.radius, w / 2, h / 2));
          break;
        default:
          ctx.rect(0, 0, w, h);
      }
    if (n.paint.fill !== "transparent" || n.paint.gradient) ctx.fill();
    if (n.paint.strokeWidth > 0 && n.paint.stroke !== "transparent") ctx.stroke();
    if (n.shape === "number") {
      ctx.fillStyle = n.paint.stroke;
      ctx.font = `600 ${Math.min(w, h) * 0.55}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(n.number ?? 1), w / 2, h / 2);
    }
  }
  private drawText(ctx: CanvasRenderingContext2D, n: DrawingNode) {
    const s = n.textStyle,
      rtl = textDirection(n.text ?? "", s.direction) === "rtl";
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, n.w, n.h);
    ctx.clip();
    ctx.fillStyle = s.background;
    ctx.fillRect(0, 0, n.w, n.h);
    if (s.border !== "transparent") {
      ctx.strokeStyle = s.border;
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, Math.max(0, n.w - 1), Math.max(0, n.h - 1));
    }
    ctx.direction = rtl ? "rtl" : "ltr";
    ctx.font = canvasFont(s);
    ctx.fillStyle = s.color;
    ctx.textBaseline = "top";
    ctx.textAlign = s.align;
    const x = s.align === "center" ? n.w / 2 : (s.align === "end" ? !rtl : rtl) ? n.w : 0;
    const lines = textLines(n.text ?? "", n.w, (text) => ctx.measureText(text).width);
    for (let index = 0; index < lines.length && index * s.size * s.leading < n.h; index++)
      ctx.fillText(lines[index], x, index * s.size * s.leading);
    ctx.restore();
  }
  async exportFrame(
    scene: DrawingScene,
    frame: Frame,
    scale = 1,
    annotations = true,
    format: "image/png" | "image/jpeg" | "image/webp" | "image/bmp" = "image/png",
    quality = 0.92,
    matte = "#ffffff",
  ): Promise<Blob> {
    if (!Number.isFinite(scale) || scale <= 0 || frame.w * frame.h * scale * scale > 64 * 1024 * 1024)
      throw new Error("The export exceeds the image memory limit");
    await this.prepare(exportPreparationScene(scene, frame.id, frame, annotations));
    if (this.imageLifetime.signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const canvas = surface(frame.w * scale, frame.h * scale);
    try {
      this.render(canvas, scene, { ...frame, scale }, { frameId: frame.id, annotations });
      if (format === "image/jpeg" || format === "image/bmp") {
        const ctx = ctx2d(canvas);
        ctx.globalCompositeOperation = "destination-over";
        ctx.fillStyle = matte;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      if (format === "image/bmp") {
        const data = ctx2d(canvas).getImageData(0, 0, canvas.width, canvas.height);
        return await encodeBmpTask({ width: data.width, height: data.height, data: data.data }, this.imageLifetime.signal);
      }
      return await encodeExportCanvas(canvas, format, quality, this.imageLifetime.signal);
    } finally {
      canvas.width = canvas.height = 1;
    }
  }
}
