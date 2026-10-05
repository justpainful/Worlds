import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type PointerEvent as RPointerEvent,
} from "react";
import { glassEngine, type Surface } from "./engine";
import type { GlassShape } from "./optics";
import { INTERACTION, LAYER, type Material } from "./profiles";
import { GLASS_V2 } from "./v2/flag";
import { GlassV2 } from "./v2/GlassV2";
import { regularToolbarV2 } from "./v2/profile";
import type { Shape } from "./v2/surface";

export interface GlassProps extends HTMLAttributes<HTMLDivElement> {
  material?: Material;
  layer?: number;
  /** Controls respond to hover and press with the material itself. */
  interactive?: boolean;
  selected?: boolean;
  disabled?: boolean;
  /** Measure the scene behind (default true). */
  sample?: boolean;
  radius?: number | string;
  as?: "div" | "button" | "nav" | "header" | "section";
  contentClassName?: string;
  /** Several shapes melted into one body (local px). */
  shapes?: GlassShape[];
  merge?: number;
  /** Grow out of this rect (viewport px) when it appears: a menu out of its button. */
  morphFrom?: DOMRect | null;
  /** A small toolbar control of the material V2 is calibrated for: drawn by V2 when its development flag is on. */
  v2?: boolean;
}

/**
 * A piece of Liquid Glass. Layers, bottom to top:
 *   optics   the backdrop pass (lens, frost, scatter, colour), clipped to the shape
 *   env      the scene's colour, reflected faintly along the edge
 *   shade    inner shadow away from the light
 *   light    rim, Fresnel and specular
 *   glow     light spreading from a press
 *   content  never passes through the optics, so text on glass stays sharp
 * Nothing animates the surface element itself: a transform there would cut
 * the optics off from the scene, so motion moves the layers together.
 *
 * Glass never sits on glass. A Glass whose element ends up inside another
 * surface (decided from the real DOM, so portals are judged correctly)
 * becomes a fill of that surface: no optics, no rim, no shadow.
 */
export const Glass = forwardRef<HTMLDivElement, GlassProps>(function Glass({ v2, ...props }, ref) {
  return v2 && GLASS_V2 ? <GlassBridgeV2 ref={ref} {...props} /> : <GlassV1 ref={ref} {...props} />;
});

/**
 * Phase 2 validation: the same props drawn by V2 at rest. It keeps the .glass
 * class (ink, grouping and nesting rules still apply: a Glass inside it becomes
 * a fill) but has no hover, press or morph of its own yet.
 */
const GlassBridgeV2 = forwardRef<HTMLDivElement, Omit<GlassProps, "v2">>(function GlassBridgeV2(
  { material = "bar", layer = LAYER.chrome, interactive: _interactive, selected, disabled, sample: _sample, radius, as = "div", shapes, merge, morphFrom: _morphFrom, className = "", contentClassName = "", onKeyDown, children, ...rest },
  ref,
) {
  const button = as === "button";
  return (
    <GlassV2
      ref={ref}
      profile={regularToolbarV2}
      radius={radius}
      shapes={shapes as Shape[] | undefined}
      merge={merge}
      className={`glass glass-v2 ${className}`}
      contentClassName={`g-content ${contentClassName}`}
      data-layer={layer}
      data-material={material}
      data-selected={selected || undefined}
      aria-disabled={disabled || undefined}
      role={button ? "button" : undefined}
      tabIndex={button ? (disabled ? -1 : 0) : undefined}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (button && !e.defaultPrevented && !disabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          e.currentTarget.click();
        }
      }}
      {...rest}
    >
      {children}
    </GlassV2>
  );
});

const GlassV1 = forwardRef<HTMLDivElement, Omit<GlassProps, "v2">>(function GlassV1(
  {
    material = "bar",
    layer = LAYER.chrome,
    interactive = false,
    selected = false,
    disabled = false,
    sample = true,
    radius,
    as = "div",
    shapes,
    merge,
    morphFrom,
    className = "",
    contentClassName = "",
    style,
    children,
    onPointerEnter,
    onPointerLeave,
    onPointerDown,
    ...rest
  },
  ref,
) {
  const root = useRef<HTMLDivElement>(null);
  const optics = useRef<HTMLSpanElement>(null);
  const light = useRef<HTMLSpanElement>(null);
  const shade = useRef<HTMLSpanElement>(null);
  const env = useRef<HTMLSpanElement>(null);
  const glow = useRef<HTMLSpanElement>(null);
  const surface = useRef<Surface | null>(null);
  const [fill, setFill] = useState(false);
  const hover = useRef(false);
  const press = useRef(false);
  useImperativeHandle(ref, () => root.current!, []);

  const opts = { material, layer, selected, shapes, merge, sample };
  useLayoutEffect(() => {
    if (!root.current || !optics.current || !light.current || !shade.current || !env.current) return;
    if (root.current.parentElement?.closest(".glass:not(.glass-fill)")) {
      setFill(true);
      return;
    }
    surface.current = glassEngine.register(
      { root: root.current, optics: optics.current, light: light.current, shade: shade.current, env: env.current },
      opts,
    );
    return () => {
      if (surface.current) glassEngine.unregister(surface.current);
      surface.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shapesKey = shapes ? JSON.stringify(shapes) : "";
  useEffect(() => {
    if (surface.current) glassEngine.update(surface.current, opts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [material, layer, selected, sample, shapesKey, merge]);

  // Morph: the layers start as the source's outline and grow into this shape (once).
  const morphed = useRef(false);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || !morphFrom || morphed.current || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    morphed.current = true;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const top = Math.max(0, morphFrom.top - r.top);
    const left = Math.max(0, morphFrom.left - r.left);
    const bottom = Math.max(0, r.bottom - morphFrom.bottom);
    const right = Math.max(0, r.right - morphFrom.right);
    const rad = Math.min(morphFrom.width, morphFrom.height) / 2;
    el.style.setProperty("--g-morph", `inset(${top}px ${right}px ${bottom}px ${left}px round ${rad}px)`);
    // The optics are cut by the shape's mask: start that mask shrunk onto the source.
    const pad = parseFloat(el.style.getPropertyValue("--g-pad")) || 0;
    const sx = morphFrom.width / r.width;
    const sy = morphFrom.height / r.height;
    el.style.setProperty("--g-mpos", `${(morphFrom.left - r.left + pad - pad * sx).toFixed(1)}px ${(morphFrom.top - r.top + pad - pad * sy).toFixed(1)}px`);
    el.style.setProperty("--g-msize", `${((r.width + 2 * pad) * sx).toFixed(1)}px ${((r.height + 2 * pad) * sy).toFixed(1)}px`);
    el.dataset.morph = "from";
    // Commit the start outline, then let the transitions carry it to the shape.
    void el.offsetWidth;
    el.dataset.morph = "to";
    const done = window.setTimeout(() => {
      delete el.dataset.morph;
      el.style.removeProperty("--g-morph");
      el.style.removeProperty("--g-mpos");
      el.style.removeProperty("--g-msize");
    }, INTERACTION.morphMs + 40);
    return () => {
      // (Effects can run twice in development: let the second run start again.)
      window.clearTimeout(done);
      morphed.current = false;
    };
  }, [morphFrom]);

  const setState = useCallback(() => {
    const el = root.current;
    if (!el) return;
    el.dataset.state = disabled ? "disabled" : press.current ? "press" : hover.current ? "hover" : "idle";
    if (surface.current) glassEngine.setInteraction(surface.current, hover.current && !disabled, press.current && !disabled);
  }, [disabled]);

  useEffect(() => {
    setState();
  }, [disabled, setState]);

  /** Light starts where the pointer acts and spreads inside the body, then settles. */
  const bloom = (e: RPointerEvent<HTMLDivElement>, strong: boolean) => {
    const el = root.current;
    const g = glow.current;
    if (!el || !g) return;
    const r = el.getBoundingClientRect();
    g.style.setProperty("--gx", `${(e.clientX - r.left).toFixed(1)}px`);
    g.style.setProperty("--gy", `${(e.clientY - r.top).toFixed(1)}px`);
    g.dataset.bloom = strong ? "press" : "hover";
    g.getAnimations().forEach((a) => a.cancel());
    g.animate(
      [
        { opacity: 0, transform: "scale(0.6)" },
        { opacity: strong ? 1 : 0.45, transform: "scale(1)", offset: 0.3 },
        { opacity: 0, transform: "scale(1.15)" },
      ],
      { duration: INTERACTION.glow.inMs + INTERACTION.glow.outMs, easing: "cubic-bezier(.2,.7,.3,1)" },
    );
  };

  const handlers = interactive
    ? {
        onPointerEnter: (e: RPointerEvent<HTMLDivElement>) => {
          hover.current = true;
          setState();
          if (!disabled) bloom(e, false);
          onPointerEnter?.(e);
        },
        onPointerLeave: (e: RPointerEvent<HTMLDivElement>) => {
          hover.current = false;
          press.current = false;
          setState();
          onPointerLeave?.(e);
        },
        onPointerDown: (e: RPointerEvent<HTMLDivElement>) => {
          if (!disabled && e.button === 0) {
            press.current = true;
            setState();
            bloom(e, true);
            const up = () => {
              press.current = false;
              setState();
              removeEventListener("pointerup", up);
              removeEventListener("pointercancel", up);
            };
            addEventListener("pointerup", up);
            addEventListener("pointercancel", up);
          }
          onPointerDown?.(e);
        },
      }
    : { onPointerEnter, onPointerLeave, onPointerDown };

  const Tag = as as "div";
  const st: CSSProperties = { ...style };
  if (radius !== undefined) st.borderRadius = typeof radius === "number" ? `${radius}px` : radius;

  return (
    <Tag
      ref={root}
      className={`${fill ? "glass-fill" : "glass"} ${interactive ? "glass-interactive" : ""} ${className}`}
      data-layer={layer}
      data-material={material}
      data-selected={selected || undefined}
      aria-disabled={disabled || undefined}
      style={st}
      {...handlers}
      {...rest}
    >
      {shapes && <span className="g-layer g-cast" aria-hidden />}
      <span ref={optics} className="g-layer g-optics" aria-hidden />
      <span ref={env} className="g-layer g-env" aria-hidden />
      <span ref={shade} className="g-layer g-shade" aria-hidden />
      <span ref={light} className="g-layer g-light" aria-hidden />
      <span ref={glow} className="g-layer g-glow" aria-hidden />
      <div className={`g-layer g-content ${contentClassName}`}>{children}</div>
    </Tag>
  );
});
