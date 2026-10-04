import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { Glass } from "../glass/Glass";
import { LAYER } from "../glass/materials";
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
  open: { x: number; y: number; items: MenuItem[]; origin?: string; minWidth?: number; key: number } | null;
  show: (x: number, y: number, items: MenuItem[], origin?: string, minWidth?: number) => void;
  hide: () => void;
}

export const useMenu = create<MenuState>((set) => ({
  open: null,
  show: (x, y, items, origin, minWidth) => set({ open: { x, y, items, origin, minWidth, key: Date.now() } }),
  hide: () => set({ open: null }),
}));

/** Open a menu below an anchor element. */
export function menuAt(el: HTMLElement, items: MenuItem[], align: "start" | "end" = "start", matchWidth = false) {
  const r = el.getBoundingClientRect();
  useMenu.getState().show(align === "start" ? r.left : r.right, r.bottom + 6, items, align === "end" ? "top right" : "top left", matchWidth ? r.width : undefined);
}

export function MenuHost() {
  const open = useMenu((s) => s.open);
  const hide = useMenu((s) => s.hide);
  if (!open) return null;
  return createPortal(<MenuPanel key={open.key} x={open.x} y={open.y} items={open.items} onClose={hide} origin={open.origin} minWidth={open.minWidth} />, document.body);
}

function MenuPanel({ x, y, items, onClose, origin, minWidth, depth = 0 }: { x: number; y: number; items: MenuItem[]; onClose: () => void; origin?: string; minWidth?: number; depth?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y, ready: false });
  const [active, setActive] = useState(-1);
  const [sub, setSub] = useState<{ index: number; x: number; y: number } | null>(null);
  const actionable = items.map((it, i) => ((it.kind ?? "item") === "item" && !(it as { disabled?: boolean }).disabled ? i : -1)).filter((i) => i >= 0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let nx = origin === "top right" ? x - r.width : x;
    let ny = y;
    if (nx + r.width > window.innerWidth - 8) nx = window.innerWidth - r.width - 8;
    if (ny + r.height > window.innerHeight - 8) ny = Math.max(8, y - r.height - 4);
    setPos({ x: Math.max(8, nx), y: ny, ready: true });
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
      if (!(e.target as HTMLElement).closest(".menu-panel")) onClose();
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
        material="dense"
        layer={LAYER.menu + depth}
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
                    setSub({ index: i, x: r.right + 4, y: r.top - 6 });
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
    const r = el.getBoundingClientRect();
    let x = align === "end" ? anchor.right - r.width : align === "center" ? anchor.left + anchor.width / 2 - r.width / 2 : anchor.left;
    let y = anchor.bottom + 8;
    if (y + r.height > window.innerHeight - 10) y = Math.max(10, anchor.top - r.height - 8);
    x = Math.min(Math.max(10, x), window.innerWidth - r.width - 10);
    setPos({ x, y, ready: true });
  }, [anchor, align]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest(".menu-panel")) onClose();
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
      material="dense"
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
