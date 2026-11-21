/**
 * The first thing Worlds shows. Three phrases, each written by hand in the
 * owner's font (outlines made by web/hello, so no font file ships):
 *
 *   "Hello, Worlds!"     the site's two inks on paper
 *   "Bring it to life!"  Imbue: its five colours, then the letters swell
 *   "Aha!"               Cognition: a thick pink ribbon, then sparks
 *
 * Each phrase is erased the way it was written before the next one starts,
 * and the three marks close the intro.
 */
import { useEffect, useRef, useState } from "react";
import helloSvg from "../../web/content/hello.svg?raw";
import imbueSvg from "./phrase-imbue.svg?raw";
import cognitionSvg from "./phrase-cognition.svg?raw";
import worldsLogo from "../assets/onboarding/worlds-logo.png";
import imbueLogo from "../assets/onboarding/imbue-logo.png";
import cognitionLogo from "../assets/onboarding/cognition-logo.png";
import { tr } from "../i18n/ui";

export type IntroPhase = "worlds" | "imbue" | "cognition" | "marks";

/** Imbue's letters, in the order of its logo. */
const IMBUE = ["#003EFB", "#FA378B", "#FC5A00", "#02AC56", "#8330D5"];

const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Write a phrase stroke by stroke; returns how long it takes. */
function write(svg: SVGSVGElement, speed = 1): number {
  const lead = 0.15;
  svg.classList.remove("is-erasing", "is-done");
  svg.querySelectorAll<SVGPathElement>("path[data-t]").forEach((p) => {
    p.style.setProperty("--t", `${Number(p.dataset.t) / speed + lead}s`);
    p.style.setProperty("--d", `${Number(p.dataset.d) / speed}s`);
  });
  void svg.getBoundingClientRect();
  svg.classList.add("is-writing");
  return (Number(svg.dataset.total || 2) / speed + lead) * 1000;
}

/** Erase a phrase in the reverse order it was written, quickly. */
function erase(svg: SVGSVGElement): number {
  const total = Number(svg.dataset.total || 2);
  const k = 0.16;
  svg.querySelectorAll<SVGPathElement>("path[data-t]").forEach((p) => {
    const t = Number(p.dataset.t);
    const d = Number(p.dataset.d);
    p.style.setProperty("--e", `${(total - t - d) * k}s`);
    p.style.setProperty("--ed", `${d * k}s`);
  });
  svg.classList.remove("is-done", "is-writing");
  void svg.getBoundingClientRect();
  svg.classList.add("is-erasing");
  return total * k * 1000 + 120;
}

export function HelloIntro({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<IntroPhase>(reduced() ? "marks" : "worlds");

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (reduced()) {
      const t = setTimeout(onDone, 1400);
      return () => clearTimeout(t);
    }
    const hello = el.querySelector(".hi-p-worlds svg") as SVGSVGElement;
    const imbue = el.querySelector(".hi-p-imbue svg") as SVGSVGElement;
    const cognition = el.querySelector(".hi-p-cognition svg") as SVGSVGElement;
    // Imbue's strokes take its five colours in turn; its fill is the five bands of the logo.
    imbue.querySelectorAll<SVGPathElement>("path[data-t]").forEach((p, i) => p.style.setProperty("--c", IMBUE[i % IMBUE.length]));
    imbue.querySelector("defs")?.insertAdjacentHTML(
      "beforeend",
      `<linearGradient id="hi-imbue-bands" x1="0" x2="1" y1="0" y2="0">${IMBUE.map((c, i) => `<stop offset="${i / 5}" stop-color="${c}"/><stop offset="${(i + 1) / 5}" stop-color="${c}"/>`).join("")}</linearGradient>`,
    );
    let live = true;
    (async () => {
      await wait(write(hello, 1.6) + 60);
      if (!live) return;
      hello.classList.add("is-done");
      await wait(550);
      if (!live) return;
      await wait(erase(hello));
      if (!live) return;
      setPhase("imbue");
      await wait(120);
      await wait(write(imbue, 2.2) + 60);
      if (!live) return;
      imbue.classList.add("is-done");
      await wait(950);
      if (!live) return;
      await wait(erase(imbue));
      if (!live) return;
      setPhase("cognition");
      await wait(120);
      await wait(write(cognition, 1.3) + 60);
      if (!live) return;
      cognition.classList.add("is-done");
      await wait(900);
      if (!live) return;
      setPhase("marks");
      await wait(2000);
      if (live) onDone();
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`hi is-${phase}`} ref={box} dir="ltr">
      <div className="hi-sparks" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <svg key={i} className={`hi-spark hi-spark-${i}`} viewBox="-10 -10 20 20">
            <path d="M0 -9 Q1.2 -1.2 9 0 Q1.2 1.2 0 9 Q-1.2 1.2 -9 0 Q-1.2 -1.2 0 -9Z" />
          </svg>
        ))}
      </div>
      <div className="hi-stage">
        <div className="hi-p hi-p-worlds" dangerouslySetInnerHTML={{ __html: helloSvg }} />
        <div className="hi-p hi-p-imbue" dangerouslySetInnerHTML={{ __html: imbueSvg }} />
        <div className="hi-p hi-p-cognition" dangerouslySetInnerHTML={{ __html: cognitionSvg }} />
      </div>
      <div className="hi-marks" aria-hidden={phase !== "marks"}>
        <figure className="hi-mark hi-mark-worlds">
          <img src={worldsLogo} alt="" />
          <figcaption>Worlds</figcaption>
        </figure>
        <figure className="hi-mark hi-mark-imbue">
          <img src={imbueLogo} alt="" />
          <figcaption>Imbue</figcaption>
        </figure>
        <figure className="hi-mark hi-mark-cognition">
          <img src={cognitionLogo} alt="" />
          <figcaption>Cognition</figcaption>
        </figure>
      </div>
      <button className="hi-skip" onClick={onSkip}>
        {tr("Skip")}
      </button>
    </div>
  );
}
