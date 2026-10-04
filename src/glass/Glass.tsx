import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type HTMLAttributes,
  type PointerEvent as RPointerEvent,
} from "react";
import { glassScene, type Surface } from "./scene";
import { LAYER, type MaterialName } from "./materials";
import type { GlassShape } from "./maps";

export interface GlassProps extends HTMLAttributes<HTMLDivElement> {
  material?: MaterialName;
  layer?: number;
  /** Interactive controls get hover / press / release / drag states. */
  interactive?: boolean;
  selected?: boolean;
  disabled?: boolean;
  /** Track pointer for directional lighting even when not interactive. */
  responsive?: boolean;
  sample?: boolean;
  radius?: number | string;
  as?: "div" | "button" | "nav" | "header" | "section";
  contentClassName?: string;
  /** Merged glass: several shapes melted into one body (local px). */
  shapes?: GlassShape[];
  merge?: number;
}

/**
 * A Liquid Glass surface. Layer order inside the element:
 *   optics (backdrop pipeline) → tint/spill/fresnel → clip(intersection) → rim → content
 * Content never passes through the optics, so text on glass is never distorted.
 */
export const Glass = forwardRef<HTMLDivElement, GlassProps>(function Glass(
  {
    material = "regular",
    layer = LAYER.chrome,
    interactive = false,
    selected = false,
    disabled = false,
    responsive = true,
    sample,
    radius,
    as = "div",
    shapes,
    merge,
    className = "",
    contentClassName = "",
    style,
    children,
    onPointerEnter,
    onPointerLeave,
    onPointerDown,
    onPointerMove,
    ...rest
  },
  ref,
) {
  const el = useRef<HTMLDivElement>(null);
  const optics = useRef<HTMLSpanElement>(null);
  const inter = useRef<HTMLSpanElement>(null);
  const surface = useRef<Surface | null>(null);
  const hover = useRef(false);
  const press = useRef(false);
  useImperativeHandle(ref, () => el.current!, []);

  useLayoutEffect(() => {
    if (!el.current || !optics.current || !inter.current) return;
    surface.current = glassScene.register(el.current, optics.current, inter.current, { material, layer, selected, sample, shapes, merge });
    return () => {
      if (surface.current) glassScene.unregister(surface.current);
      surface.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shapesKey = shapes ? JSON.stringify(shapes) : "";
  useEffect(() => {
    if (surface.current) glassScene.update(surface.current, { material, layer, selected, sample, shapes, merge });
    if (shapes) glassScene.invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [material, layer, selected, sample, shapesKey, merge]);

  const setState = useCallback(() => {
    const node = el.current;
    if (!node) return;
    const state = disabled ? "disabled" : press.current ? "press" : hover.current ? "hover" : "idle";
    node.dataset.state = state;
    if (surface.current) glassScene.setInteraction(surface.current, hover.current && !disabled, press.current && !disabled);
  }, [disabled]);

  useEffect(() => {
    setState();
  }, [disabled, setState]);

  const track = (e: RPointerEvent<HTMLDivElement>) => {
    const node = el.current;
    if (!node) return;
    const r = node.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    node.style.setProperty("--px", `${(x * 100).toFixed(1)}%`);
    node.style.setProperty("--py", `${(y * 100).toFixed(1)}%`);
    // Bias the light direction slightly toward the pointer.
    const angle = 180 + Math.max(-1, Math.min(1, (x - 0.5) * 2)) * -22;
    node.style.setProperty("--light-angle", `${angle.toFixed(1)}deg`);
    if (surface.current) glassScene.lightAt(surface.current, x, y);
  };

  const handlers = {
    onPointerEnter: (e: RPointerEvent<HTMLDivElement>) => {
      if (responsive || interactive) track(e);
      if (interactive) {
        hover.current = true;
        setState();
      }
      el.current?.style.setProperty("--spot", "1");
      onPointerEnter?.(e);
    },
    onPointerMove: (e: RPointerEvent<HTMLDivElement>) => {
      if (responsive || interactive) track(e);
      onPointerMove?.(e);
    },
    onPointerLeave: (e: RPointerEvent<HTMLDivElement>) => {
      hover.current = false;
      press.current = false;
      el.current?.style.setProperty("--spot", "0");
      el.current?.style.removeProperty("--light-angle");
      if (surface.current) glassScene.lightAt(surface.current, null, null);
      setState();
      onPointerLeave?.(e);
    },
    onPointerDown: (e: RPointerEvent<HTMLDivElement>) => {
      if (interactive && !disabled && e.button === 0) {
        press.current = true;
        setState();
        const up = () => {
          press.current = false;
          setState();
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", up);
        };
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
      }
      onPointerDown?.(e);
    },
  };

  const Tag = as as "div";
  const st: CSSProperties = { ...style };
  if (radius !== undefined) st.borderRadius = typeof radius === "number" ? `${radius}px` : radius;

  return (
    <Tag
      ref={el}
      className={`glass ${interactive ? "glass-interactive" : ""} ${className}`}
      data-layer={layer}
      data-material={material}
      data-selected={selected || undefined}
      aria-disabled={disabled || undefined}
      style={st}
      {...handlers}
      {...rest}
    >
      {shapes && <span className="g-shadow" aria-hidden />}
      <span ref={optics} className="g-optics" aria-hidden />
      <span className="g-tint" aria-hidden />
      <span className="g-clip" aria-hidden>
        <span ref={inter} className="g-intersect" style={{ display: "none" }} />
      </span>
      <span className="g-rim" aria-hidden />
      <div className={`g-content ${contentClassName}`}>{children}</div>
    </Tag>
  );
});
