/**
 * A short guided tour: a few steps that light up one part of the window each
 * and say what it is for. Made for first looks and for exhibition visitors who
 * explore on their own. Start it from the command palette (Take the Tour), or
 * it starts once after the sample workspace loads.
 *
 * The text is English; the Arabic interface translates it like any other
 * label. A step whose part is not on screen shows its card in the middle.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../state/store";
import { Glass } from "../glass/Glass";
import { LAYER } from "../glass/profiles";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { CARD_W, placeCard, TOUR_STEPS, type Box } from "./tourModel";

export { TOUR_STEPS } from "./tourModel";

/** Settings key set once the tour has been seen or skipped. */
export const TOUR_SEEN_KEY = "tour.seen";

const START_EVENT = "worlds:tour";

/** Open the tour from anywhere. */
export function startTour(): void {
  window.dispatchEvent(new Event(START_EVENT));
}

const PAD = 6;

/** The lit part's box with a little room around it, or null when it is not on screen. */
function measure(selector: string | undefined): Box | null {
  if (!selector) return null;
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > innerHeight) return null;
  return { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
}

export function TourHost() {
  const [step, setStep] = useState<number | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const finish = useCallback(() => {
    setStep(null);
    useStore.getState().setSetting(TOUR_SEEN_KEY, true);
  }, []);

  useEffect(() => {
    const onStart = () => setStep(0);
    window.addEventListener(START_EVENT, onStart);
    return () => window.removeEventListener(START_EVENT, onStart);
  }, []);

  // Follow the lit part while the window or the layout settles.
  useLayoutEffect(() => {
    if (step === null) return;
    let frame = 0;
    let until = performance.now() + 600;
    const update = () => {
      const b = measure(TOUR_STEPS[step].target);
      setBox(b);
      const card = cardRef.current?.getBoundingClientRect();
      setPos(placeCard(b, { width: card?.width || CARD_W, height: card?.height || 180 }, { width: innerWidth, height: innerHeight }));
      if (performance.now() < until) frame = requestAnimationFrame(update);
    };
    update();
    const onResize = () => {
      until = performance.now() + 200;
      cancelAnimationFrame(frame);
      update();
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, [step]);

  useEffect(() => {
    if (step === null) return;
    nextRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      const rtl = document.documentElement.dir === "rtl";
      const forward = rtl ? "ArrowLeft" : "ArrowRight";
      const backward = rtl ? "ArrowRight" : "ArrowLeft";
      if (e.key === "Escape") finish();
      else if (e.key === forward) setStep((s) => (s === null ? s : Math.min(s + 1, TOUR_STEPS.length - 1)));
      else if (e.key === backward) setStep((s) => (s === null ? s : Math.max(s - 1, 0)));
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [step, finish]);

  if (step === null) return null;
  const s = TOUR_STEPS[step];
  const last = step === TOUR_STEPS.length - 1;

  return createPortal(
    <div className="tour-root" role="dialog" aria-modal="true" aria-label="Tour">
      {box ? (
        <div className="tour-hole" style={{ top: box.top, left: box.left, width: box.width, height: box.height }} />
      ) : (
        <div className="tour-dim" />
      )}
      <div className="tour-catch" onPointerDown={(e) => e.preventDefault()} />
      <Glass
        ref={cardRef}
        material="menu"
        layer={LAYER.modal}
        className="tour-card"
        radius="var(--r-float)"
        style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}
      >
        <div className="tour-card-head">
          <span className="tour-card-icon"><Icon name={s.icon} size={18} /></span>
          <span className="tour-count">{`Step ${step + 1} of ${TOUR_STEPS.length}`}</span>
          <button className="tour-close" aria-label="Close the tour" onClick={finish}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <h2 className="tour-title">{s.title}</h2>
        <p className="tour-body">{s.body}</p>
        <div className="tour-dots" aria-hidden="true">
          {TOUR_STEPS.map((_, i) => (
            <span key={i} className={i === step ? "is-on" : ""} />
          ))}
        </div>
        <div className="tour-actions">
          {step > 0 && (
            <Button variant="quiet" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          <span className="grow" />
          <Button ref={nextRef} variant="tinted" onClick={() => (last ? finish() : setStep(step + 1))}>
            {last ? "Done" : "Next"}
          </Button>
        </div>
      </Glass>
    </div>,
    document.body,
  );
}
