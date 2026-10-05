import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { STAGE_H, STAGE_W, type Slide } from "./model";
import { SlideRender } from "./SlideRender";

/**
 * Full-screen presenting. Arrows, Space, Page Up/Down or a click move between
 * slides; N shows the speaker notes; Escape ends.
 */
export function Present({ slides, start, onClose }: { slides: Slide[]; start: number; onClose: (at: number) => void }) {
  const [i, setI] = useState(start);
  const [notes, setNotes] = useState(false);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const root = useRef<HTMLDivElement>(null);
  const at = useRef(start);
  at.current = i;

  useEffect(() => {
    root.current?.requestFullscreen?.().catch(() => {});
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    const onFs = () => !document.fullscreenElement && onClose(at.current);
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) setI((n) => Math.min(slides.length - 1, n + 1));
      else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) setI((n) => Math.max(0, n - 1));
      else if (e.key === "Home") setI(0);
      else if (e.key === "End") setI(slides.length - 1);
      else if (e.key.toLowerCase() === "n") setNotes((v) => !v);
      else if (e.key === "Escape") {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        onClose(at.current);
      }
    };
    window.addEventListener("resize", onResize);
    document.addEventListener("fullscreenchange", onFs);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("fullscreenchange", onFs);
      window.removeEventListener("keydown", onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scale = Math.min(size.w / STAGE_W, size.h / STAGE_H);
  const slide = slides[i];
  return createPortal(
    <div className="dk-present" ref={root} onClick={() => setI((n) => Math.min(slides.length - 1, n + 1))}>
      {slide && <SlideRender slide={slide} scale={scale} />}
      <div className="dk-present-count">{i + 1} / {slides.length}</div>
      {notes && slide?.notes && <div className="dk-present-notes bidi" dir="auto">{slide.notes}</div>}
    </div>,
    document.body,
  );
}
