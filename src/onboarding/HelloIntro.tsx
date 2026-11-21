/**
 * The first thing Worlds shows, seven seconds, one continuous piece:
 *
 *   0.0  a pen writes "Hello, Worlds!" in the site's two inks
 *   1.7  the letters swell into Imbue's five colours
 *   2.4  the swollen letters burst into coloured particles that fly into the
 *        Imbue logo
 *   4.0  Cognition: the Imbue particles dim and a pink ribbon scribbles
 *        itself over them, then the particles fade and the ribbon stays
 *   6.4  it fades, and the setup questions begin
 *
 * The letters of "Hello, Worlds!" are outlines from the site's start page
 * (web/content/hello.svg, made from the owner's font by web/hello).
 */
import { useEffect, useRef, useState } from "react";
import helloSvg from "../../web/content/hello.svg?raw";
import imbueLogo from "../assets/onboarding/imbue-logo.png";
import { tr } from "../i18n/ui";

const LENGTH = 7000;
const IMBUE = ["#003EFB", "#FA378B", "#FC5A00", "#02AC56", "#8330D5"];
/** How fat the letters swell, in the SVG's font units (matches .hl.is-swell). */
const SWELL = 170;

const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const bands = (id: string) =>
  `<linearGradient id="${id}" x1="0" x2="1" y1="0" y2="0">${IMBUE.map((c, i) => `<stop offset="${i / 5}" stop-color="${c}"/><stop offset="${(i + 1) / 5}" stop-color="${c}"/>`).join("")}</linearGradient>`;

interface Pt {
  x: number;
  y: number;
  c: string;
}

/** Points of a picture drawn `w` pixels wide: every `step` pixels that are not see-through, with their colour. */
async function pointsOf(src: string, w: number, step: number): Promise<{ pts: Pt[]; h: number }> {
  const width = Math.max(1, Math.round(w));
  const img = new Image();
  img.src = src;
  await img.decode();
  const h = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * width));
  const c = document.createElement("canvas");
  c.width = width;
  c.height = h;
  const g = c.getContext("2d")!;
  g.drawImage(img, 0, 0, width, h);
  const data = g.getImageData(0, 0, width, h).data;
  const pts: Pt[] = [];
  for (let y = 0; y < h; y += step)
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      if (data[i + 3] > 140) pts.push({ x, y, c: `rgb(${data[i]},${data[i + 1]},${data[i + 2]})` });
    }
  return { pts, h };
}

/** The swollen, Imbue-coloured "Hello, Worlds!" as a picture, with room for the swell around it. */
function swollenPicture(): { src: string; vb: number[]; pad: number } {
  const vb = (helloSvg.match(/viewBox="([^"]+)"/)?.[1] ?? "0 0 1000 500").split(/\s+/).map(Number);
  const pad = SWELL;
  const lines = [...helloSvg.matchAll(/<g class="hw-line hw-l(\d)" transform="([^"]+)"><path class="hw-fill" d="([^"]+)"/g)];
  const body = lines
    .map((m) => `<g transform="${m[2]}"><path d="${m[3]}" fill="url(#b${m[1]})" stroke="url(#b${m[1]})" stroke-width="${SWELL}" stroke-linejoin="round"/></g>`)
    .join("");
  const w = vb[2] + pad * 2;
  const h = vb[3] + pad * 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb[0] - pad} ${vb[1] - pad} ${w} ${h}" width="1600" height="${Math.round((1600 * h) / w)}"><defs>${bands("b0")}${bands("b1")}</defs>${body}</svg>`;
  return { src: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg), vb, pad };
}

type Step = "write" | "swell" | "burst" | "scribble" | "out";

export function HelloIntro({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [step, setStep] = useState<Step>("write");

  useEffect(() => {
    if (reduced()) {
      setStep("scribble");
      const t = setTimeout(onDone, 1600);
      return () => clearTimeout(t);
    }
    const svg = box.current?.querySelector("svg.hw") as SVGSVGElement | null;
    const cv = canvas.current;
    if (!svg || !cv) return;
    svg.querySelector("defs")?.insertAdjacentHTML("beforeend", bands("hi-bands"));
    const speed = 2.6;
    svg.querySelectorAll<SVGPathElement>("path[data-t]").forEach((p) => {
      p.style.setProperty("--t", `${Number(p.dataset.t) / speed}s`);
      p.style.setProperty("--d", `${Number(p.dataset.d) / speed}s`);
    });
    void svg.getBoundingClientRect();
    svg.classList.add("is-writing");
    const write = (Number(svg.dataset.total || 4.4) / speed) * 1000;

    let live = true;
    let raf = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(() => live && fn(), ms));
    at(write, () => svg.classList.add("is-done"));
    at(write + 60, () => setStep("swell"));

    // Prepare the particles while the pen writes (sampled once; placed on screen at the burst,
    // so a window resized meanwhile still lines up).
    const SAMPLE = { words: 1000, imbue: 760 };
    const pic = swollenPicture();
    const step0 = 7;
    const ready = Promise.all([pointsOf(pic.src, SAMPLE.words, step0), pointsOf(imbueLogo, SAMPLE.imbue, step0)]);
    const place = ([a, b]: Awaited<typeof ready>) => {
      const r = svg.getBoundingClientRect();
      const unit = r.width / pic.vb[2];
      const picW = (pic.vb[2] + pic.pad * 2) * unit;
      const kA = picW / SAMPLE.words;
      const left = r.left - pic.pad * unit;
      const top = r.top - pic.pad * unit;
      const imbueW = Math.min(innerWidth * 0.62, 760);
      const kB = imbueW / SAMPLE.imbue;
      const cx = innerWidth / 2;
      const cy = innerHeight / 2;
      return {
        step: Math.max(3, step0 * Math.min(kA, kB) * 1.15),
        A: a.pts.map((p) => ({ ...p, x: left + p.x * kA, y: top + p.y * kA })),
        B: b.pts.map((p) => ({ ...p, x: cx - imbueW / 2 + p.x * kB, y: cy - (b.h * kB) / 2 + p.y * kB })),
      };
    };

    const burstAt = write + 760;
    at(burstAt, () => {
      ready.then((samples) => {
        if (!live) return;
        const d = place(samples);
        setStep("burst");
        const n = Math.max(d.A.length, d.B.length);
        const sortX = (arr: Pt[]) => [...arr].sort((p, q) => p.x - q.x || p.y - q.y);
        const [A, B] = [sortX(d.A), sortX(d.B)];
        const pick = (arr: Pt[], i: number) => arr[Math.floor((i / n) * arr.length)];
        const fly = Array.from({ length: n }, () => ({ x: (Math.random() - 0.5) * 760, y: (Math.random() - 0.5) * 520, s: 0.5 + Math.random() }));
        const dpr = Math.min(2, devicePixelRatio || 1);
        cv.width = innerWidth * dpr;
        cv.height = innerHeight * dpr;
        const g = cv.getContext("2d")!;
        g.scale(dpr, dpr);
        const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
        const lerp = (p: number, q: number, t: number) => p + (q - p) * t;
        // Milliseconds from the burst: into Imbue, hold, dim under Cognition's ribbon, fade.
        const T = { toB: 1150, holdB: 1550, dim: 1950, fade: 3300 };
        const size = Math.max(2, d.step * 0.85);
        const t0 = performance.now();
        const frame = (now: number) => {
          const t = now - t0;
          g.clearRect(0, 0, innerWidth, innerHeight);
          g.globalAlpha = t < T.holdB ? 1 : t < T.dim ? 1 - 0.72 * ((t - T.holdB) / (T.dim - T.holdB)) : Math.max(0, 0.28 * (1 - (t - T.dim) / (T.fade - T.dim)));
          for (let i = 0; i < n; i++) {
            const p = pick(A, i);
            const q = pick(B, i);
            const f = fly[i];
            let x: number, y: number, col: string;
            const k = ease(Math.min(1, t / T.toB));
            const m = Math.sin(k * Math.PI);
            // After landing, a slow drift while the ribbon draws over them.
            const drift = t > T.holdB ? (t - T.holdB) / 1000 : 0;
            x = lerp(p.x, q.x, k) + f.x * m * 0.55 + f.x * drift * 0.03;
            y = lerp(p.y, q.y, k) + f.y * m * 0.55 + f.y * drift * 0.03;
            col = k < 0.5 ? p.c : q.c;
            g.fillStyle = col;
            g.fillRect(x - size / 2, y - size / 2, size, size);
          }
          if (t > T.holdB) setStep((s) => (s === "burst" ? "scribble" : s));
          if (t < T.fade && live) raf = requestAnimationFrame(frame);
          else g.clearRect(0, 0, innerWidth, innerHeight);
        };
        raf = requestAnimationFrame(frame);
      });
    });
    at(LENGTH - 600, () => setStep("out"));
    at(LENGTH, onDone);
    return () => {
      live = false;
      timers.forEach(clearTimeout);
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`hi is-${step}`} ref={box} dir="ltr">
      <div className="hl-word" dangerouslySetInnerHTML={{ __html: helloSvg }} />
      <canvas ref={canvas} className="hb-canvas" />
      <svg className="hl-scribble" viewBox="0 0 1000 560" aria-hidden="true">
        <path
          pathLength="1"
          d="M90 330 C 170 120, 360 90, 330 260 S 150 470, 290 450 S 520 110, 560 250 S 420 500, 560 470 S 800 120, 820 260 S 700 480, 820 430 S 950 250, 930 200"
        />
      </svg>
      <button className="hi-skip" onClick={onSkip}>
        {tr("Skip")}
      </button>
    </div>
  );
}
