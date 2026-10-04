import { useEffect, useRef, useState } from "react";

/**
 * Small, still copies of pictures for grids, ambient light and previews.
 *
 * Decoding is done once per (source, width) with createImageBitmap's resize,
 * which runs off the main thread; animated GIFs become their first frame, so
 * a grid of GIFs costs nothing after it has loaded. At most two decodes run at
 * a time, and grid tiles only ask when they scroll into view.
 */

const cache = new Map<string, Promise<string | null>>();
const queue: (() => void)[] = [];
let running = 0;
const MAX_PARALLEL = 2;

function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    running++;
    queue.shift()!();
  }
}

async function make(src: string, width: number): Promise<string | null> {
  const res = await fetch(src);
  if (!res.ok) return null;
  const blob = await res.blob();
  if (blob.type === "image/svg+xml") return src; // vectors are already cheap
  const bmp = await createImageBitmap(blob, { resizeWidth: width, resizeQuality: "medium" });
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0);
  bmp.close();
  const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.82));
  return out ? URL.createObjectURL(out) : null;
}

export function thumbnail(src: string, width: number): Promise<string | null> {
  const key = `${width}|${src}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const job = new Promise<string | null>((resolve) => {
    queue.push(() => {
      make(src, width)
        .catch(() => null)
        .then((u) => {
          running--;
          pump();
          resolve(u);
        });
    });
    pump();
  });
  cache.set(key, job);
  return job;
}

/** A still, downscaled copy of `src`. With `lazy`, waits until `ref` is near the viewport. */
export function useThumb(src: string | null, width: number, lazy?: React.RefObject<Element | null>) {
  const [url, setUrl] = useState<string | null>(null);
  const [visible, setVisible] = useState(!lazy);
  useEffect(() => {
    if (!lazy?.current || visible) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(lazy.current);
    return () => io.disconnect();
  }, [lazy, visible]);
  useEffect(() => {
    setUrl(null);
    if (!src || !visible) return;
    let live = true;
    thumbnail(src, width).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [src, width, visible]);
  return url;
}

/** Convenience for components that only need a ref + thumb. */
export function useLazyThumb(src: string | null, width: number) {
  const ref = useRef<HTMLElement | null>(null);
  const url = useThumb(src, width, ref);
  return { ref, url };
}
