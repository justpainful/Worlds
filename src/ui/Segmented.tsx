import { useLayoutEffect, useRef } from "react";
import { Glass } from "../glass/Glass";
import { LAYER } from "../glass/materials";
import { Spring, SPRING_SNAPPY, prefersReducedMotion } from "../motion/spring";
import { Icon, type IconName } from "./Icon";

export interface SegmentOption<T extends string> {
  value: T;
  label?: string;
  icon?: IconName;
}

/**
 * Segmented control. One continuous glass field holds every option; the
 * selection is a denser control-glass lens that travels between options on
 * a spring and stretches along its motion (velocity-driven), so the group
 * reads as one connected piece of material, not separate buttons.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "compact",
  layer = LAYER.floating,
  label,
}: {
  value: T;
  options: SegmentOption<T>[];
  onChange: (v: T) => void;
  size?: "compact" | "standard";
  layer?: number;
  label?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const lens = useRef<HTMLDivElement>(null);
  const springs = useRef<{ x: Spring; w: Spring } | null>(null);

  useLayoutEffect(() => {
    const t = track.current;
    const l = lens.current;
    if (!t || !l) return;
    const btn = t.querySelector<HTMLElement>(`[data-value="${CSS.escape(value)}"]`);
    if (!btn) return;
    const x = btn.offsetLeft;
    const w = btn.offsetWidth;
    const apply = () => {
      const s = springs.current!;
      const stretch = Math.min(0.14, Math.abs(s.x.velocity) / 9000);
      l.style.transform = `translateX(${s.x.value}px) scaleX(${1 + stretch}) scaleY(${1 - stretch * 0.5})`;
      l.style.width = `${s.w.value}px`;
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
  }, [value, options.length]);

  const idx = options.findIndex((o) => o.value === value);
  const onKey = (e: React.KeyboardEvent) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d || !options.length) return;
    e.preventDefault();
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    const next = options[(idx + (rtl ? -d : d) + options.length) % options.length];
    onChange(next.value);
    requestAnimationFrame(() => track.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(next.value)}"]`)?.focus());
  };

  // A quiet track; the selection is the only piece of glass, a soft raised lens.
  return (
    <div className={`segmented segmented-${size}`} role="radiogroup" aria-label={label} onKeyDown={onKey}>
      <div className="segmented-track" ref={track}>
        <div className="segmented-lens-wrap" aria-hidden>
          <Glass ref={lens} material="control" layer={layer + 0.5} selected className="segmented-lens" radius="var(--r-capsule)" responsive={false} />
        </div>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            tabIndex={o.value === value ? 0 : -1}
            aria-label={o.label ?? o.value}
            data-value={o.value}
            data-tip={!o.label ? o.value : undefined}
            className={`segmented-item ${o.value === value ? "is-selected" : ""}`}
            onClick={() => onChange(o.value)}
          >
            {o.icon && <Icon name={o.icon} size={15} />}
            {o.label && <span>{o.label}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
