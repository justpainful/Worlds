import { useLayoutEffect, useRef, type RefObject } from "react";
import { Spring, SPRING_SNAPPY, prefersReducedMotion } from "./spring";

/**
 * Drives a selection "lens" element toward the selected child of a
 * container on interruptible springs (x + width), stretching slightly
 * along the direction of travel so the selection moves like material.
 */
export function useLens(container: RefObject<HTMLElement | null>, lens: RefObject<HTMLElement | null>, selector: string, deps: unknown[]) {
  const springs = useRef<{ x: Spring; w: Spring } | null>(null);
  useLayoutEffect(() => {
    const c = container.current;
    const l = lens.current;
    if (!c || !l) return;
    const target = c.querySelector<HTMLElement>(selector);
    if (!target) {
      l.style.visibility = "hidden";
      return;
    }
    l.style.visibility = "visible";
    const x = target.offsetLeft;
    const w = target.offsetWidth;
    const apply = () => {
      const s = springs.current!;
      const stretch = Math.min(0.12, Math.abs(s.x.velocity) / 10000);
      l.style.transform = `translateX(${s.x.value.toFixed(2)}px) scaleX(${(1 + stretch).toFixed(4)}) scaleY(${(1 - stretch * 0.45).toFixed(4)})`;
      l.style.width = `${s.w.value.toFixed(2)}px`;
    };
    if (!springs.current) {
      springs.current = {
        x: new Spring(x, SPRING_SNAPPY, apply, prefersReducedMotion),
        w: new Spring(w, SPRING_SNAPPY, apply, prefersReducedMotion),
      };
      apply();
    } else {
      springs.current.x.set(x);
      springs.current.w.set(w);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
