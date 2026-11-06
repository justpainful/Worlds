import { useEffect, useRef, useState } from "react";
import type { DrawingScene, Rect } from "./model";
import { DrawingRenderer } from "./renderer";
/** A real renderer preview. Asset failure is visible instead of a fake thumbnail. */
export function DrawingScenePreview({ scene, label, frameId, camera,previewImages,preparation }: { scene: DrawingScene; label: string; frameId?: string; camera?: Rect;previewImages?:ReadonlyMap<string,HTMLImageElement>;preparation?:DrawingScene }) {
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const renderer = new DrawingRenderer({previewImages}); let active = true;
    setError(null);
    const draw = () => {
      if (!active || !canvas.current || !host.current) return;
      const f = camera ?? scene.frames[frameId ?? scene.defaultFrameId], w = host.current.clientWidth, h = host.current.clientHeight, scale = Math.min(w / f.w, h / f.h) * 0.9, dpr = devicePixelRatio || 1;
      canvas.current.width = Math.max(1, Math.round(w * dpr)); canvas.current.height = Math.max(1, Math.round(h * dpr));
      renderer.render(canvas.current, scene, { x: f.x - (w / scale - f.w) / 2, y: f.y - (h / scale - f.h) / 2, w: w / scale, h: h / scale, scale: scale * dpr }, { frameId, region: camera });
    };
    renderer.onAssetChange = draw;
    void renderer.prepare(preparation??scene).then(draw).catch((e) => { if (active) setError(String(e)); });
    const observer = new ResizeObserver(draw); if (host.current) observer.observe(host.current);
    return () => { active = false; observer.disconnect(); renderer.dispose(); };
  }, [scene, frameId, camera,previewImages,preparation]);
  return <div className="drawing-library-preview" ref={host}><canvas ref={canvas} role="img" aria-label={label} />{error && <p role="alert">{error}</p>}</div>;
}
