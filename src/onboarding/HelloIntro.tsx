/**
 * The first thing Worlds shows, about five seconds, ending on the three marks:
 * Worlds, Imbue and Cognition. Three takes, picked with ?intro= while the owner
 * chooses (film is the default):
 *
 *   film   On black: the Worlds W assembles from its pieces with a light sweep,
 *          Imbue's letters drop in and bounce, Cognition's ribbon draws itself.
 *   line   One pen writes "Hello, Worlds!", the letters swell in Imbue's
 *          colours, a pink ribbon scribbles over them and becomes Cognition.
 *   burst  "Hello, Worlds!" breaks into coloured particles that fly into the
 *          Imbue logo, then into the Cognition logo, then the three marks.
 *
 * The letters of "Hello, Worlds!" are outlines from the site's start page
 * (web/content/hello.svg, made from the owner's font by web/hello).
 */
import { useEffect, useRef, useState } from "react";
import helloSvg from "../../web/content/hello.svg?raw";
import worldsLogo from "../assets/onboarding/worlds-logo.png";
import imbueLogo from "../assets/onboarding/imbue-logo.png";
import cognitionLogo from "../assets/onboarding/cognition-logo.png";
import imbueI from "../assets/onboarding/imbue-i.png";
import imbueM from "../assets/onboarding/imbue-m.png";
import imbueB from "../assets/onboarding/imbue-b.png";
import imbueU from "../assets/onboarding/imbue-u.png";
import imbueE from "../assets/onboarding/imbue-e.png";
import { tr } from "../i18n/ui";

export type IntroTake = "film" | "line" | "burst";
const LENGTH = 5000;
const IMBUE = ["#003EFB", "#FA378B", "#FC5A00", "#02AC56", "#8330D5"];

const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function takeFromUrl(): IntroTake {
  const v = typeof location !== "undefined" ? new URLSearchParams(location.search).get("intro") : null;
  return v === "line" || v === "burst" ? v : "film";
}

export function HelloIntro({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const [take] = useState(takeFromUrl);
  useEffect(() => {
    const t = setTimeout(onDone, reduced() ? 1400 : LENGTH);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className={`hi hi-${take} ${reduced() ? "is-still" : ""}`} dir="ltr">
      {take === "film" && <Film />}
      {take === "line" && <Line />}
      {take === "burst" && <Burst />}
      <button className="hi-skip" onClick={onSkip}>
        {tr("Skip")}
      </button>
    </div>
  );
}

/** The three marks in a row; each take decides how they arrive. */
function Marks({ imbueLetters = false }: { imbueLetters?: boolean }) {
  return (
    <div className="hi-row">
      <figure className="hi-m hi-m-worlds">
        <div className="hi-w">
          <img className="hi-w-base" src={worldsLogo} alt="" />
          <img className="hi-w-piece hi-w-l" src={worldsLogo} alt="" />
          <img className="hi-w-piece hi-w-c" src={worldsLogo} alt="" />
          <img className="hi-w-piece hi-w-r" src={worldsLogo} alt="" />
          <span className="hi-w-sweep" style={{ WebkitMaskImage: `url("${worldsLogo}")`, maskImage: `url("${worldsLogo}")` }} />
        </div>
        <figcaption>Worlds</figcaption>
      </figure>
      <figure className="hi-m hi-m-imbue">
        {imbueLetters ? (
          <div className="hi-letters">
            {[imbueI, imbueM, imbueB, imbueU, imbueE].map((src, i) => (
              <img key={i} src={src} alt="" className="hi-letter" style={{ ["--i" as string]: i }} />
            ))}
          </div>
        ) : (
          <img src={imbueLogo} alt="" className="hi-imbue-img" />
        )}
        <figcaption>Imbue</figcaption>
      </figure>
      <figure className="hi-m hi-m-cognition">
        <img src={cognitionLogo} alt="" className="hi-cog" />
        <figcaption>Cognition</figcaption>
      </figure>
    </div>
  );
}

/* ------------------------------------------------------------------ film */

function Film() {
  return <Marks imbueLetters />;
}

/* ------------------------------------------------------------------ line */

function Line() {
  const box = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<"write" | "swell" | "scribble" | "marks">("write");
  useEffect(() => {
    const svg = box.current?.querySelector("svg.hw") as SVGSVGElement | null;
    if (!svg || reduced()) {
      setStep("marks");
      return;
    }
    svg.querySelector("defs")?.insertAdjacentHTML(
      "beforeend",
      `<linearGradient id="hi-bands" x1="0" x2="1" y1="0" y2="0">${IMBUE.map((c, i) => `<stop offset="${i / 5}" stop-color="${c}"/><stop offset="${(i + 1) / 5}" stop-color="${c}"/>`).join("")}</linearGradient>`,
    );
    const speed = 2.6;
    svg.querySelectorAll<SVGPathElement>("path[data-t]").forEach((p) => {
      p.style.setProperty("--t", `${Number(p.dataset.t) / speed}s`);
      p.style.setProperty("--d", `${Number(p.dataset.d) / speed}s`);
    });
    void svg.getBoundingClientRect();
    svg.classList.add("is-writing");
    const write = (Number(svg.dataset.total || 4.4) / speed) * 1000;
    const timers = [
      setTimeout(() => svg.classList.add("is-done"), write),
      setTimeout(() => setStep("swell"), write + 80),
      setTimeout(() => setStep("scribble"), write + 850),
      setTimeout(() => setStep("marks"), write + 1900),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);
  return (
    <div className={`hl is-${step}`} ref={box}>
      <div className="hl-word" dangerouslySetInnerHTML={{ __html: helloSvg }} />
      <svg className="hl-scribble" viewBox="0 0 1000 560" aria-hidden="true">
        <path
          pathLength="1"
          d="M90 330 C 170 120, 360 90, 330 260 S 150 470, 290 450 S 520 110, 560 250 S 420 500, 560 470 S 800 120, 820 260 S 700 480, 820 430 S 950 250, 930 200"
        />
      </svg>
      <Marks />
    </div>
  );
}

/* ----------------------------------------------------------------- burst */

interface Pt {
  x: number;
  y: number;
  c: string;
}

/** Points of a picture: every few pixels that are not see-through, with their colour, centred on (0, 0). */
async function pointsOf(src: string, w: number, step: number): Promise<Pt[]> {
  const width = Math.round(w);
  const img = new Image();
  img.src = src;
  await img.decode();
  const h = Math.round((img.naturalHeight / img.naturalWidth) * width);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = h;
  const g = c.getContext("2d")!;
  g.drawImage(img, 0, 0, width, h);
  const data = g.getImageData(0, 0, width, h).data;
  const out: Pt[] = [];
  for (let y = 0; y < h; y += step)
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      if (data[i + 3] > 140) out.push({ x: x - width / 2, y: y - h / 2, c: `rgb(${data[i]},${data[i + 1]},${data[i + 2]})` });
    }
  return out;
}

/** "Hello, Worlds!" as a picture, in the site's two inks. */
function helloPicture(): string {
  const vb = helloSvg.match(/viewBox="([^"]+)"/)?.[1] ?? "0 0 1000 500";
  const lines = [...helloSvg.matchAll(/<g class="hw-line hw-l(\d)" transform="([^"]+)"><path class="hw-fill" d="([^"]+)"/g)];
  const body = lines.map((m) => `<g transform="${m[2]}"><path fill="${m[1] === "0" ? "#d4644d" : "#24706b"}" d="${m[3]}"/></g>`).join("");
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="1400" height="${Math.round(1400 * (Number(vb.split(" ")[3]) / Number(vb.split(" ")[2])))}">${body}</svg>`);
}

function Burst() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [showMarks, setShowMarks] = useState(false);
  useEffect(() => {
    const cv = canvas.current;
    if (!cv || reduced()) {
      setShowMarks(true);
      return;
    }
    let raf = 0;
    let live = true;
    (async () => {
      const W = Math.min(innerWidth * 0.7, 900);
      const step = Math.max(4, Math.round(W / 190));
      const [a, b, c] = await Promise.all([pointsOf(helloPicture(), W, step), pointsOf(imbueLogo, W * 0.85, step), pointsOf(cognitionLogo, W * 0.42, step)]);
      if (!live) return;
      const n = Math.max(a.length, b.length, c.length);
      const pick = (arr: Pt[], i: number) => arr[Math.floor((i / n) * arr.length)];
      const order = (arr: Pt[]) => [...arr].sort((p, q) => p.x - q.x || p.y - q.y);
      const [A, B, C] = [order(a), order(b), order(c)];
      const jitter = Array.from({ length: n }, () => ({ x: (Math.random() - 0.5) * 900, y: (Math.random() - 0.5) * 600, s: 0.6 + Math.random() * 0.8 }));
      const dpr = Math.min(2, devicePixelRatio || 1);
      cv.width = innerWidth * dpr;
      cv.height = innerHeight * dpr;
      const g = cv.getContext("2d")!;
      g.scale(dpr, dpr);
      const cx = innerWidth / 2;
      const cy = innerHeight / 2;
      const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
      // Stages (ms): words in, burst to Imbue, hold, burst to Cognition, hold, fade to the marks.
      const T = { inEnd: 450, toB: 650, toBEnd: 1800, toC: 2200, toCEnd: 3350, out: 3700, outEnd: 4000 };
      const t0 = performance.now();
      const lerp = (p: number, q: number, t: number) => p + (q - p) * t;
      const frame = (now: number) => {
        const t = now - t0;
        g.clearRect(0, 0, innerWidth, innerHeight);
        const size = Math.max(2, step * 0.82);
        for (let i = 0; i < n; i++) {
          const p = pick(A, i);
          const q = pick(B, i);
          const r = pick(C, i);
          const j = jitter[i];
          let x: number, y: number, col: string, alpha: number;
          if (t < T.toB) {
            const k = ease(Math.min(1, t / T.inEnd));
            x = p.x;
            y = p.y;
            col = p.c;
            alpha = k;
          } else if (t < T.toC) {
            const k = ease(Math.min(1, (t - T.toB) / (T.toBEnd - T.toB)));
            // Out through a burst, then into place.
            const m = Math.sin(k * Math.PI);
            x = lerp(p.x, q.x, k) + j.x * m * 0.6;
            y = lerp(p.y, q.y, k) + j.y * m * 0.6;
            col = k < 0.5 ? p.c : q.c;
            alpha = 1;
          } else if (t < T.out) {
            const k = ease(Math.min(1, (t - T.toC) / (T.toCEnd - T.toC)));
            const m = Math.sin(k * Math.PI);
            x = lerp(q.x, r.x, k) + j.x * m * 0.5;
            y = lerp(q.y, r.y, k) + j.y * m * 0.5 - m * 40 * j.s;
            col = k < 0.5 ? q.c : r.c;
            alpha = 1;
          } else {
            const k = Math.min(1, (t - T.out) / (T.outEnd - T.out));
            x = r.x;
            y = r.y;
            col = r.c;
            alpha = 1 - k;
          }
          g.globalAlpha = alpha;
          g.fillStyle = col;
          g.beginPath();
          g.arc(cx + x, cy + y, size / 2, 0, Math.PI * 2);
          g.fill();
        }
        if (t > T.outEnd - 60) setShowMarks(true);
        if (t < T.outEnd && live) raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    })();
    return () => {
      live = false;
      cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <div className={`hb ${showMarks ? "is-marks" : ""}`}>
      <canvas ref={canvas} className="hb-canvas" />
      <Marks />
    </div>
  );
}
