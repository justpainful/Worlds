import { useEffect, useRef, useState } from "react";
import { glassScene, type GlassStats } from "../glass/scene";
import { longFrames, startupMs } from "./monitor";

interface Sample {
  fps: number;
  avg: number;
  p95: number;
  heap: number | null;
  glass: GlassStats;
  long: number;
}

/** Developer overlay: frame time, glass cost, memory, startup. */
export function PerfOverlay() {
  const [s, setS] = useState<Sample | null>(null);
  const times = useRef<number[]>([]);
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      times.current.push(t - last);
      if (times.current.length > 120) times.current.shift();
      last = t;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const iv = window.setInterval(() => {
      const ts = [...times.current].sort((a, b) => a - b);
      if (!ts.length) return;
      const avg = ts.reduce((a, b) => a + b, 0) / ts.length;
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      setS({
        fps: Math.round(1000 / avg),
        avg,
        p95: ts[Math.floor(ts.length * 0.95)] ?? avg,
        heap: mem ? mem.usedJSHeapSize / 1048576 : null,
        glass: glassScene.stats(),
        long: longFrames,
      });
    }, 500);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(iv);
    };
  }, []);
  if (!s) return null;
  const bad = s.p95 > 25;
  return (
    <div className="perf-overlay" aria-hidden>
      <div className={bad ? "is-bad" : ""}>
        {s.fps} fps · {s.avg.toFixed(1)} ms · p95 {s.p95.toFixed(1)} ms
      </div>
      <div>
        glass {s.glass.surfaces}: {s.glass.lenses} lens · {s.glass.flat} flat · {s.glass.hidden} off-screen
      </div>
      <div>
        quality {s.glass.quality}
        {s.glass.autoReduced ? " (auto)" : ""} · sample {s.glass.sampleMs.toFixed(1)} ms · layout {s.glass.layoutMs.toFixed(1)} ms
      </div>
      <div>
        {s.heap !== null ? `heap ${s.heap.toFixed(0)} MB · ` : ""}long frames {s.long} · startup {startupMs} ms
      </div>
    </div>
  );
}
