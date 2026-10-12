import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type CSSProperties, type HTMLAttributes, type KeyboardEvent } from "react";
import { track } from "./scene";

export interface TonalProps extends HTMLAttributes<HTMLDivElement> {
  /** The whole control answers hover and press (single-action controls). */
  interactive?: boolean;
  selected?: boolean;
  disabled?: boolean;
  radius?: number | string;
  as?: "div" | "button" | "nav";
  contentClassName?: string;
}

/**
 * A Tonal control: an opaque capsule coloured by what is behind it (see
 * scene.ts), with depth from its shadow alone. It replaces Liquid Glass for
 * buttons, groups, tabs and segmented controls; menus, sheets and panels stay
 * glass. Nothing here reads the backdrop optically, so transforms, scrolling
 * and transparent windows cost nothing and never break it.
 */
export const Tonal = forwardRef<HTMLDivElement, TonalProps>(function Tonal(
  { interactive = false, selected = false, disabled = false, radius, as = "div", contentClassName = "", className = "", style, children, onKeyDown, ...rest },
  ref,
) {
  const el = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => el.current!, []);
  useLayoutEffect(() => (el.current ? track(el.current) : undefined), []);

  const button = as === "button";
  const st: CSSProperties = { ...style };
  if (radius !== undefined) st.borderRadius = typeof radius === "number" ? `${radius}px` : radius;
  const Tag = (button ? "div" : as) as "div";
  return (
    <Tag
      ref={el}
      className={`tonal ${interactive ? "tonal-interactive" : ""} ${className}`}
      data-selected={selected || undefined}
      aria-disabled={disabled || undefined}
      role={button ? "button" : undefined}
      tabIndex={button ? (disabled ? -1 : 0) : undefined}
      style={st}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        onKeyDown?.(e);
        if (button && !e.defaultPrevented && !disabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          e.currentTarget.click();
        }
      }}
      {...rest}
    >
      <div className={`tn-content g-content ${contentClassName}`}>{children}</div>
    </Tag>
  );
});
