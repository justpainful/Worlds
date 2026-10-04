import { useEffect, useState, type CSSProperties } from "react";

/**
 * A crop is a focus point (percent of the image) plus a zoom. It renders as
 * object-fit cover + object-position + scale around the same point, so the
 * chosen area stays put at every container size.
 */
export interface Crop {
  x: number;
  y: number;
  zoom: number;
}

export const NO_CROP: Crop = { x: 50, y: 50, zoom: 1 };

export function parseCrop(v: string | null | undefined, fallback: Crop = NO_CROP): Crop {
  if (!v) return fallback;
  const [x, y, z] = v.split(",").map(Number);
  return {
    x: Number.isFinite(x) ? clamp(x, 0, 100) : fallback.x,
    y: Number.isFinite(y) ? clamp(y, 0, 100) : fallback.y,
    zoom: Number.isFinite(z) ? clamp(z, 1, 4) : 1,
  };
}

export const formatCrop = (c: Crop) => `${c.x.toFixed(1)},${c.y.toFixed(1)},${c.zoom.toFixed(2)}`;

export function cropStyle(c: Crop): CSSProperties {
  return {
    objectFit: "cover",
    objectPosition: `${c.x}% ${c.y}%`,
    transform: c.zoom !== 1 ? `scale(${c.zoom})` : undefined,
    transformOrigin: `${c.x}% ${c.y}%`,
  };
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------------------
// Image analysis: natural size and an automatic focus point
// ---------------------------------------------------------------------------

export interface ImageInfo {
  width: number;
  height: number;
  /** Where the interesting part of the picture is (percent). */
  focus: { x: number; y: number };
}

const cache = new Map<string, Promise<ImageInfo>>();

/**
 * Saliency on a small copy: local contrast (gradient energy) and colourfulness,
 * a mild centre prior, then the weighted centroid of the strongest 12% of
 * pixels. Cheap, deterministic and good at finding faces, logos and subjects
 * against plain or blurred backgrounds.
 */
export function analyzeImage(src: string): Promise<ImageInfo> {
  const hit = cache.get(src);
  if (hit) return hit;
  const job = new Promise<ImageInfo>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      const W0 = img.naturalWidth || 1;
      const H0 = img.naturalHeight || 1;
      try {
        const W = 72;
        const H = Math.max(8, Math.round((H0 / W0) * W));
        const c = document.createElement("canvas");
        c.width = W;
        c.height = H;
        const ctx = c.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, W, H);
        const d = ctx.getImageData(0, 0, W, H).data;
        const lum = new Float32Array(W * H);
        const sat = new Float32Array(W * H);
        for (let i = 0; i < W * H; i++) {
          const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
          lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          sat[i] = mx ? (mx - mn) / mx : 0;
        }
        const energy = new Float32Array(W * H);
        for (let y = 1; y < H - 1; y++) {
          for (let x = 1; x < W - 1; x++) {
            const i = y * W + x;
            const gx = lum[i + 1] - lum[i - 1] + 0.5 * (lum[i - W + 1] - lum[i - W - 1] + lum[i + W + 1] - lum[i + W - 1]);
            const gy = lum[i + W] - lum[i - W] + 0.5 * (lum[i + W - 1] - lum[i - W - 1] + lum[i + W + 1] - lum[i - W + 1]);
            const dx = (x / W - 0.5) * 2, dy = (y / H - 0.45) * 2;
            const prior = 1 - 0.35 * Math.min(1, dx * dx + dy * dy);
            energy[i] = (Math.hypot(gx, gy) / 255 + 0.6 * sat[i]) * prior;
          }
        }
        const sorted = Array.from(energy).sort((a, b) => b - a);
        const cut = sorted[Math.floor(sorted.length * 0.12)] ?? 0;
        let sx = 0, sy = 0, sw = 0;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const e = energy[y * W + x];
            if (e < cut || e <= 0) continue;
            const w = e * e;
            sx += x * w;
            sy += y * w;
            sw += w;
          }
        }
        const focus = sw ? { x: clamp((sx / sw / (W - 1)) * 100, 5, 95), y: clamp((sy / sw / (H - 1)) * 100, 5, 95) } : { x: 50, y: 50 };
        resolve({ width: W0, height: H0, focus });
      } catch {
        resolve({ width: W0, height: H0, focus: { x: 50, y: 50 } });
      }
    };
    img.onerror = () => resolve({ width: 0, height: 0, focus: { x: 50, y: 50 } });
    img.src = src;
  });
  cache.set(src, job);
  return job;
}

export function useImageInfo(src: string | null): ImageInfo | null {
  const [info, setInfo] = useState<ImageInfo | null>(null);
  useEffect(() => {
    setInfo(null);
    if (!src) return;
    let live = true;
    analyzeImage(src).then((i) => live && setInfo(i));
    return () => {
      live = false;
    };
  }, [src]);
  return info;
}

/** The saved crop, or the automatic focus when the user never chose one. */
export function effectiveCrop(saved: string | null | undefined, info: ImageInfo | null): Crop {
  if (saved) return parseCrop(saved);
  return info ? { x: info.focus.x, y: info.focus.y, zoom: 1 } : NO_CROP;
}

/**
 * Banner height from the picture's own proportions, within calm bounds:
 * wide pictures stay short, tall ones are cropped rather than allowed to take
 * over the page, and low resolution pictures are not stretched taller than
 * they can stay sharp.
 */
export function bannerHeight(containerW: number, viewportH: number, info: ImageInfo | null): number {
  const min = 220;
  const max = Math.max(min, Math.min(viewportH * 0.44, 470));
  if (!info || !info.width || !info.height) return Math.round(Math.min(max, Math.max(min, viewportH * 0.34)));
  const natural = containerW * (info.height / info.width);
  let h = Math.min(max, Math.max(min, natural));
  // Sharpness guard: covering a box taller than the picture's own height x 1.6 blurs it.
  const dpr = window.devicePixelRatio || 1;
  const sharpMax = (info.height * 1.6) / dpr;
  if (h > sharpMax) h = Math.max(min, sharpMax);
  return Math.round(h);
}
