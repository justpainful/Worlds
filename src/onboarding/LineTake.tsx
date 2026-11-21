/**
 * The earlier "line" take of the intro, kept for review at ?intro=line:
 * a pen writes "Hello, Worlds!", the letters swell in Imbue's colours, a pink
 * ribbon scribbles over them, and the three marks close it. Five seconds.
 */
import { useEffect, useRef, useState } from "react";
import helloSvg from "../../web/content/hello.svg?raw";
import worldsLogo from "../assets/onboarding/worlds-logo.png";
import imbueLogo from "../assets/onboarding/imbue-logo.png";
import cognitionLogo from "../assets/onboarding/cognition-logo.png";
import { tr } from "../i18n/ui";

const IMBUE = ["#003EFB", "#FA378B", "#FC5A00", "#02AC56", "#8330D5"];

export function LineTake({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<"write" | "swell" | "scribble" | "marks">("write");
  useEffect(() => {
    const svg = box.current?.querySelector("svg.hw") as SVGSVGElement | null;
    const end = setTimeout(onDone, 5000);
    if (!svg) return () => clearTimeout(end);
    svg.querySelector("defs")?.insertAdjacentHTML(
      "beforeend",
      `<linearGradient id="lt-bands" x1="0" x2="1" y1="0" y2="0">${IMBUE.map((c, i) => `<stop offset="${i / 5}" stop-color="${c}"/><stop offset="${(i + 1) / 5}" stop-color="${c}"/>`).join("")}</linearGradient>`,
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
    return () => {
      clearTimeout(end);
      timers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className={`lt is-${step}`} ref={box} dir="ltr">
      <div className="lt-word" dangerouslySetInnerHTML={{ __html: helloSvg }} />
      <svg className="lt-scribble" viewBox="0 0 1000 560" aria-hidden="true">
        <path pathLength="1" d="M90 330 C 170 120, 360 90, 330 260 S 150 470, 290 450 S 520 110, 560 250 S 420 500, 560 470 S 800 120, 820 260 S 700 480, 820 430 S 950 250, 930 200" />
      </svg>
      <div className="lt-row">
        <figure className="lt-m lt-m-worlds">
          <img src={worldsLogo} alt="" className="lt-worlds" />
          <figcaption>Worlds</figcaption>
        </figure>
        <figure className="lt-m lt-m-imbue">
          <img src={imbueLogo} alt="" className="lt-imbue" />
          <figcaption>Imbue</figcaption>
        </figure>
        <figure className="lt-m lt-m-cognition">
          <img src={cognitionLogo} alt="" className="lt-cog" />
          <figcaption>Cognition</figcaption>
        </figure>
      </div>
      <button className="lt-skip" onClick={onSkip}>
        {tr("Skip")}
      </button>
    </div>
  );
}
