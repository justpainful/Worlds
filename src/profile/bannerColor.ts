import { useEffect, useState } from "react";

export interface BannerTone {
  /** Dominant colour, "r, g, b". */
  rgb: string;
  /** A softer, darker version for the page canvas. */
  deep: string;
  /** Average luminance of the banner's lower band (0..1): light banners get dark controls. */
  luma: number;
  /** Luminance of the top band and the top-right corner (where floating buttons sit). */
  lumaTop: number;
  lumaTopRight: number;
}

const cache = new Map<string, BannerTone>();

function toHsl(r: number, g: number, b: number) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  const s = max === min ? 0 : l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
  return { s, l };
}

/** Samples a small copy of the image: saturation-weighted dominant colour + lower-band luminance. */
export function sampleTone(src: string): Promise<BannerTone> {
  const hit = cache.get(src);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      try {
        const W = 48;
        const H = Math.max(8, Math.round((img.naturalHeight / Math.max(1, img.naturalWidth)) * W));
        const c = document.createElement("canvas");
        c.width = W;
        c.height = H;
        const ctx = c.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, W, H);
        const d = ctx.getImageData(0, 0, W, H).data;
        let r = 0, g = 0, b = 0, wsum = 0, lum = 0, lumN = 0, top = 0, topN = 0, tr = 0, trN = 0;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            const pr = d[i], pg = d[i + 1], pb = d[i + 2];
            const { s, l } = toHsl(pr, pg, pb);
            // Prefer saturated mid-tones; ignore near-black and near-white.
            const w = (0.15 + s * s) * (l > 0.08 && l < 0.92 ? 1 : 0.1);
            r += pr * w;
            g += pg * w;
            b += pb * w;
            wsum += w;
            const L = (0.2126 * pr + 0.7152 * pg + 0.0722 * pb) / 255;
            if (y > H * 0.6) {
              lum += L;
              lumN++;
            }
            if (y < H * 0.35) {
              top += L;
              topN++;
              if (x > W * 0.6) {
                tr += L;
                trN++;
              }
            }
          }
        }
        r /= wsum;
        g /= wsum;
        b /= wsum;
        // The canvas colour keeps the banner's hue but stays dark enough for light text.
        const raw = [r, g, b].map((v) => v * 0.32 + 14);
        const k = Math.min(1, 46 / Math.max(...raw));
        const deep = raw.map((v) => Math.round(v * k)).join(", ");
        const tone = {
          rgb: [r, g, b].map(Math.round).join(", "),
          deep,
          luma: lumN ? lum / lumN : 0,
          lumaTop: topN ? top / topN : 0,
          lumaTopRight: trN ? tr / trN : 0,
        };
        cache.set(src, tone);
        resolve(tone);
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = reject;
    img.src = src;
  });
}

const FALLBACK: BannerTone = { rgb: "120, 110, 140", deep: "32, 30, 38", luma: 0.2, lumaTop: 0.2, lumaTopRight: 0.2 };

/** Light picture areas get dark ink on a light frost; dark areas the reverse. */
export const isLight = (luma: number) => luma > 0.56;

export function useBannerTone(src: string | null): BannerTone {
  const [tone, setTone] = useState<BannerTone>(() => (src && cache.get(src)) || FALLBACK);
  useEffect(() => {
    if (!src) {
      setTone(FALLBACK);
      return;
    }
    let live = true;
    sampleTone(src)
      .then((t) => live && setTone(t))
      .catch(() => live && setTone(FALLBACK));
    return () => {
      live = false;
    };
  }, [src]);
  return tone;
}
