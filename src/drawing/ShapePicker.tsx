import { useEffect, useRef, useState } from "react";
import type { Shape } from "./model";
import { Icon } from "../ui/Icon";

const SHAPES: { value: Shape; en: string; ar: string; path: string }[] = [
  { value: "line", en: "Line", ar: "خط", path: "M4 20 20 4" },
  { value: "arrow", en: "Arrow", ar: "سهم", path: "M4 20 20 4M11 4h9v9" },
  { value: "rect", en: "Rectangle", ar: "مستطيل", path: "M4 6h16v12H4z" },
  { value: "ellipse", en: "Ellipse", ar: "دائرة", path: "M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7z" },
  { value: "triangle", en: "Triangle", ar: "مثلث", path: "M12 4 21 19H3z" },
  { value: "right-triangle", en: "Right triangle", ar: "مثلث قائم", path: "M5 4v15h15z" },
];

function ShapeGlyph({ path }: { path: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

/** Shape choice as the app's own menu: the native list ignores the theme and draws white on Windows. */
export function ShapePicker({ shape, arabic, onChange }: { shape: Shape; arabic: boolean; onChange: (shape: Shape) => void }) {
  const [open, setOpen] = useState(false),
    root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const current = SHAPES.find((item) => item.value === shape) ?? SHAPES[0];
  useEffect(() => {
    if (!open) return;
    const click = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", click, true);
    root.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]')?.focus();
    return () => document.removeEventListener("pointerdown", click, true);
  }, [open]);
  return (
    <div ref={root} className="drawing-brush-picker">
      <button
        ref={trigger}
        type="button"
        className="drawing-brush-trigger"
        aria-label={arabic ? "الشكل" : "Shape"}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ShapeGlyph path={current.path} />
        {arabic ? current.ar : current.en}
        <Icon name="chevronDown" size={12} />
      </button>
      {open && (
        <div
          className="drawing-brush-menu drawing-shape-menu"
          role="listbox"
          aria-label={arabic ? "الأشكال" : "Shapes"}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              trigger.current?.focus();
              e.stopPropagation();
            }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const choices = [...root.current!.querySelectorAll<HTMLButtonElement>('[role="option"]')],
                index = choices.indexOf(document.activeElement as HTMLButtonElement);
              choices[(index + (e.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length]?.focus();
            }
          }}
        >
          {SHAPES.map((item) => (
            <button
              type="button"
              role="option"
              aria-selected={item.value === shape}
              key={item.value}
              onClick={() => {
                onChange(item.value);
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              <ShapeGlyph path={item.path} />
              <span>{arabic ? item.ar : item.en}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
