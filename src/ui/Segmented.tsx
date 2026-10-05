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

  // One piece of glass carved into segments: the capsule is the glass, thin
  // inset separators divide it, and the selection is a soft inner lens of the
  // same material (no second bezel, no capsule in a capsule).
  return (
    <Glass
      material="control"
      layer={layer}
      radius="var(--r-capsule)"
      className={`segmented segmented-${size}`}
      contentClassName="segmented-body"
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKey}
    >
      <div className="segmented-track" ref={track}>
        <div className="segmented-lens-wrap" aria-hidden>
          <div ref={lens} className="segmented-lens" />
        </div>
        {options.map((o, i) => (
          <span key={o.value} className="segmented-cell">
            {i > 0 && <span className={`segmented-sep ${i === idx || i - 1 === idx ? "is-hidden" : ""}`} aria-hidden />}
            <button
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
              {o.icon && <Icon name={o.icon} size={16} />}
              {o.label && <span>{o.label}</span>}
            </button>
          </span>
        ))}
      </div>
    </Glass>
  );
}
