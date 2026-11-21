/**
 * The first thing Worlds shows: "Hello, Worlds!" written by hand in the
 * site's two colours, a shine across it, then the words take on Imbue's
 * style and Cognition's, and the three marks arrive together.
 *
 * The letters are outlines from the site's start page (web/content/hello.svg,
 * made from the owner's font by web/hello), so no font file ships.
 */
import { useEffect, useRef, useState } from "react";
import helloSvg from "../../web/content/hello.svg?raw";
import worldsLogo from "../assets/onboarding/worlds-logo.png";
import imbueLogo from "../assets/onboarding/imbue-logo.png";
import cognitionLogo from "../assets/onboarding/cognition-logo.png";
import { tr } from "../i18n/ui";

export type IntroPhase = "write" | "shine" | "imbue" | "cognition" | "marks";

const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** When each phase starts, after the writing (which takes the SVG's own length). */
const AFTER_WRITE = { shine: 250, imbue: 1250, cognition: 2650, marks: 4050, done: 5100 };

export function HelloIntro({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<IntroPhase>(reduced() ? "marks" : "write");

  useEffect(() => {
    const el = box.current;
    const svg = el?.querySelector("svg.hw") as SVGSVGElement | null;
    if (!el || !svg) return;
    if (reduced()) {
      svg.classList.add("is-done");
      const t = setTimeout(onDone, 1200);
      return () => clearTimeout(t);
    }
    // A shine band inside each line, clipped to the letters.
    svg.querySelectorAll("g.hw-line").forEach((g, i) => {
      const shine = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      shine.setAttribute("class", "hw-shine");
      shine.setAttribute("x", "-3000");
      shine.setAttribute("y", "0");
      shine.setAttribute("width", "2400");
      shine.setAttribute("height", "4000");
      shine.setAttribute("clip-path", `url(#hw${i})`);
      shine.setAttribute("fill", "url(#hw-shine-grad)");
      g.appendChild(shine);
    });
    const defs = svg.querySelector("defs");
    if (defs && !defs.querySelector("#hw-shine-grad")) {
      defs.insertAdjacentHTML(
        "beforeend",
        '<linearGradient id="hw-shine-grad" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>',
      );
    }
    const lead = 0.35;
    svg.querySelectorAll<SVGPathElement>("path[data-t]").forEach((p) => {
      p.style.setProperty("--t", `${Number(p.dataset.t) + lead}s`);
      p.style.setProperty("--d", `${p.dataset.d}s`);
    });
    void svg.getBoundingClientRect();
    svg.classList.add("is-writing");
    const total = (Number(svg.dataset.total || 4) + lead) * 1000;
    const timers = [
      setTimeout(() => {
        svg.classList.add("is-done");
        svg.classList.remove("is-writing");
      }, total + 60),
      setTimeout(() => setPhase("shine"), total + AFTER_WRITE.shine),
      setTimeout(() => setPhase("imbue"), total + AFTER_WRITE.imbue),
      setTimeout(() => setPhase("cognition"), total + AFTER_WRITE.cognition),
      setTimeout(() => setPhase("marks"), total + AFTER_WRITE.marks),
      setTimeout(onDone, total + AFTER_WRITE.done),
    ];
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`hi is-${phase}`} ref={box} dir="ltr">
      <div className="hi-sparks" aria-hidden="true">
        {Array.from({ length: 7 }, (_, i) => (
          <svg key={i} className={`hi-spark hi-spark-${i}`} viewBox="-10 -10 20 20" width="34" height="34">
            <path d="M0 -8 L2 -2 L8 0 L2 2 L0 8 L-2 2 L-8 0 L-2 -2Z" fill="#FFD63D" stroke="#171820" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
        ))}
      </div>
      <div className="hi-word" dangerouslySetInnerHTML={{ __html: helloSvg }} />
      <div className="hi-marks" aria-hidden={phase !== "marks"}>
        <figure className="hi-mark hi-mark-worlds">
          <img src={worldsLogo} alt="" height={70} />
          <figcaption>Worlds</figcaption>
        </figure>
        <span className="hi-amp">&amp;</span>
        <figure className="hi-mark hi-mark-imbue">
          <img src={imbueLogo} alt="" height={64} />
          <figcaption>Imbue</figcaption>
        </figure>
        <span className="hi-amp">&amp;</span>
        <figure className="hi-mark hi-mark-cognition">
          <img src={cognitionLogo} alt="" height={96} />
          <figcaption>Cognition</figcaption>
        </figure>
      </div>
      <button className="hi-skip" onClick={onSkip}>
        {tr("Skip")}
      </button>
    </div>
  );
}
