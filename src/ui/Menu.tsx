import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { Glass } from "../glass/Glass";
import { LAYER } from "../glass/profiles";
import { Icon, type IconName } from "./Icon";

export type MenuItem =
  | {
      kind?: "item";
      label: string;
      icon?: IconName;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      checked?: boolean;
      onSelect?: () => void;
      submenu?: MenuItem[];
    }
  | { kind: "separator" }
  | { kind: "label"; label: string };

interface MenuState {
  open: { x: number; y: number; items: MenuItem[]; origin?: string; minWidth?: number; from?: DOMRect; key: number } | null;
  show: (x: number, y: number, items: MenuItem[], origin?: string, minWidth?: number, from?: DOMRect) => void;
  hide: () => void;
}

export const useMenu = create<MenuState>((set) => ({
  open: null,
  show: (x, y, items, origin, minWidth, from) => set({ open: { x, y, items, origin, minWidth, from, key: Date.now() } }),
  hide: () => set({ open: null }),
}));

/** Open a menu below an anchor element. */
export function menuAt(el: HTMLElement, items: MenuItem[], align: "start" | "end" = "start", matchWidth = false) {
  const r = el.getBoundingClientRect();
  // The menu grows out of the control that opened it. Start and end are the
  // control's own sides: in a right to left layout its start is the right edge.
  const atRight = (align === "end") !== (getComputedStyle(el).direction === "rtl");
  useMenu.getState().show(atRight ? r.right : r.left, r.bottom + 6, items, atRight ? "top right" : "top left", matchWidth ? r.width : undefined, r);
}

export function MenuHost() {
  const open = useMenu((s) => s.open);
  const hide = useMenu((s) => s.hide);
  if (!open) return null;
  return createPortal(<MenuPanel key={open.key} x={open.x} y={open.y} items={open.items} onClose={hide} origin={open.origin} minWidth={open.minWidth} from={open.from} />, document.body);
}

function MenuPanel({ x, y, items, onClose, origin, minWidth, from: _from, depth = 0 }: { x: number; y: number; items: MenuItem[]; onClose: () => void; origin?: string; minWidth?: number; from?: DOMRect; depth?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y, ready: false });
  const [active, setActive] = useState(-1);
  const [sub, setSub] = useState<{ index: number; x: number; y: number } | null>(null);
  const actionable = items.map((it, i) => ((it.kind ?? "item") === "item" && !(it as { disabled?: boolean }).disabled ? i : -1)).filter((i) => i >= 0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const r = el.getBoundingClientRect();
      // A menu at the pointer grows towards the reading side: leftwards in Arabic, as Windows draws it.
      const fromRight = origin === "top right" || (origin === undefined && document.documentElement.dir === "rtl");
      let nx = fromRight ? x - r.width : x;
      let ny = y;
      if (nx + r.width > window.innerWidth - 8) nx = window.innerWidth - r.width - 8;
      if (ny + r.height > window.innerHeight - 8) ny = Math.max(8, y - r.height - 4);
      const next = { x: Math.max(8, nx), y: ny };
      setPos((p) => (p.ready && p.x === next.x && p.y === next.y ? p : { ...next, ready: true }));
    };
    place();
    // Labels can change width after opening (the Arabic interface replaces them).
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [x, y, origin]);

  useEffect(() => {
    if (depth > 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const cur = actionable.indexOf(active);
        const next = e.key === "ArrowDown" ? actionable[(cur + 1) % actionable.length] : actionable[(cur - 1 + actionable.length) % actionable.length];
        setActive(next ?? -1);
      } else if (e.key === "Enter" && active >= 0) {
        e.preventDefault();
        const it = items[active] as Extract<MenuItem, { label: string }>;
        if ("onSelect" in it && it.onSelect) {
          onClose();
          it.onSelect();
        }
      }
    };
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element && e.target.closest(".menu-panel"))) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("blur", onClose);
    };
  }, [active, actionable, items, onClose, depth]);

  return (
    <>
      <Glass
        ref={ref}
        material="menu"
        layer={LAYER.menu + depth}
        // Morphing out of the anchor is off until the static material is right (Liquid Glass V2, phase 7).
        className={`menu-panel ${pos.ready ? "is-in" : ""}`}
        style={{ left: pos.x, top: pos.y, transformOrigin: origin ?? "top left", minWidth }}
        role="menu"
        radius="var(--r-lg)"
      >
        <div className="menu-items">
          {items.map((it, i) => {
            if (it.kind === "separator") return <div key={i} className="menu-sep" role="separator" />;
            if (it.kind === "label") return <div key={i} className="menu-label">{it.label}</div>;
            return (
              <button
                key={i}
                type="button"
                role="menuitem"
                className={`menu-item ${it.danger ? "is-danger" : ""} ${active === i ? "is-active" : ""}`}
                disabled={it.disabled}
                onPointerEnter={(e) => {
                  setActive(i);
                  if (it.submenu) {
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    // A submenu opens on the side its arrow points to: the left in Arabic.
                    const rtl = getComputedStyle(e.currentTarget as HTMLElement).direction === "rtl";
                    setSub({ index: i, x: rtl ? r.left - 4 : r.right + 4, y: r.top - 6 });
                  } else setSub(null);
                }}
                onClick={() => {
                  if (it.submenu) return;
                  onClose();
                  it.onSelect?.();
                }}
              >
                <span className="menu-icon">{it.checked ? <Icon name="check" size={17} /> : it.icon ? <Icon name={it.icon} size={17} /> : null}</span>
                <span className="menu-text isolate">{it.label}</span>
                {it.shortcut && <span className="menu-shortcut">{it.shortcut}</span>}
                {it.submenu && <Icon name="forward" size={14} className="menu-chevron" />}
              </button>
            );
          })}
        </div>
      </Glass>
      {sub && (items[sub.index] as { submenu?: MenuItem[] }).submenu && (
        <MenuPanel x={sub.x} y={sub.y} items={(items[sub.index] as { submenu: MenuItem[] }).submenu} onClose={onClose} depth={depth + 1} />
      )}
    </>
  );
}

/** Anchored popover with arbitrary content. */
export function Popover({
  anchor,
  onClose,
  children,
  align = "start",
  width,
  className = "",
}: {
  anchor: DOMRect;
  onClose: () => void;
  children: ReactNode;
  align?: "start" | "end" | "center";
  width?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; ready: boolean }>({ x: anchor.left, y: anchor.bottom + 8, ready: false });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const r = el.getBoundingClientRect();
      // Start and end follow the reading direction, as for menus.
      const rtl = document.documentElement.dir === "rtl";
      const toRight = align === "end" ? !rtl : align === "start" ? rtl : false;
      let x = align === "center" ? anchor.left + anchor.width / 2 - r.width / 2 : toRight ? anchor.right - r.width : anchor.left;
      let y = anchor.bottom + 8;
      // Below when it fits, else above when that fits, else wherever it shows the most.
      if (y + r.height > window.innerHeight - 10) {
        const above = anchor.top - r.height - 8;
        y = above >= 10 ? above : Math.max(10, window.innerHeight - r.height - 10);
      }
      x = Math.min(Math.max(10, x), window.innerWidth - r.width - 10);
      setPos((p) => (p.ready && p.x === x && p.y === y ? p : { x, y, ready: true }));
    };
    place();
    // Content that loads after opening (model lists, providers) changes the height.
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [anchor, align]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target instanceof Element && e.target.closest(".menu-panel"))) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [onClose]);
  return createPortal(
    <Glass
      ref={ref}
      material="menu"
      layer={LAYER.popover}
      className={`popover ${pos.ready ? "is-in" : ""} ${className}`}
      style={{ left: pos.x, top: pos.y, width }}
      radius="var(--r-popover)"
    >
      {children}
    </Glass>,
    document.body,
  );
}
