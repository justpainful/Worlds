/**
 * The dashboard's controls, after Symbolic's design system
 * (C:\Users\kuroi\OneDrive\Desktop\Symbolic\docs\design-system): glass capsules,
 * a track with a sliding glass lens for choices, pop-up buttons with a round
 * stepper, grouped sections with inset hairlines, one accent button per view.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SYMBOLS, type SymbolName } from "./symbols";

// ---------------------------------------------------------------------------
// SF Symbols, each with a hover motion that matches what it shows
// ---------------------------------------------------------------------------

const MOTION: Partial<Record<SymbolName, string>> = {
  magnifyingglass: "wiggle",
  "arrow.clockwise": "spin",
  "rectangle.portrait.and.arrow.right": "slide",
  pencil: "wiggle",
  trash: "wiggle",
  plus: "turn",
  "chevron.right": "nudge",
  "chevron.left": "nudge-back",
  key: "turn-small",
  "pause.circle": "pop",
  "play.circle": "pop",
  nosign: "pop",
  "person.2": "pop",
  "chart.bar.xaxis": "grow",
  "list.bullet.rectangle": "pop",
  "person.badge.key": "pop",
  "document.on.document": "lift",
  "arrow.up.right.square": "lift",
  touchid: "pop",
  envelope: "lift",
  "sun.max": "spin-slow",
  moon: "wiggle",
  "circle.lefthalf.filled": "spin-slow",
  "character.bubble": "pop",
  "ellipsis.circle": "pop",
  "line.3.horizontal.decrease.circle": "pop",
  "text.page": "lift",
  xmark: "turn",
};

export function Icon({ name, size = 17, label }: { name: SymbolName; size?: number; label?: string }) {
  const s = SYMBOLS[name];
  const [x, y, w, h] = s.vb;
  return (
    <svg
      className="sym"
      data-m={MOTION[name]}
      viewBox={`${x} ${y} ${w} ${h}`}
      height={size}
      width={(size * w) / h}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d={s.d} fill="currentColor" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type Variant = "quiet" | "accent" | "danger" | "plain";

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: SymbolName;
  variant?: Variant;
  busy?: boolean;
}

export function Button({ icon, variant = "quiet", busy, children, className = "", disabled, ...rest }: BtnProps) {
  return (
    <button type="button" className={`btn btn-${variant} ${busy ? "is-busy" : ""} ${className}`} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {icon && <Icon name={icon} />}
      {children && <span>{children}</span>}
    </button>
  );
}

/** A round icon-only button (close, refresh). */
export function IconButton({ icon, label, ...rest }: { icon: SymbolName; label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className="btn btn-icon" aria-label={label} title={label} {...rest}>
      <Icon name={icon} />
    </button>
  );
}

/** Related buttons in one glass capsule with thin separators. */
export function Capsule({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="capsule glass" role="group" aria-label={label}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A track with a sliding glass lens
// ---------------------------------------------------------------------------

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; icon?: SymbolName }[];
  onChange: (v: T) => void;
  label: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [lens, setLens] = useState<{ x: number; w: number } | null>(null);
  const [moving, setMoving] = useState(false);

  useLayoutEffect(() => {
    const el = track.current?.querySelector<HTMLElement>(`[data-v="${CSS.escape(value)}"]`);
    if (!el || !track.current) return;
    const place = () => {
      const tr = track.current!.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      setLens((old) => {
        const next = { x: r.left - tr.left, w: r.width };
        if (old && (old.x !== next.x || old.w !== next.w)) setMoving(true);
        return next;
      });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(track.current);
    return () => ro.disconnect();
  }, [value, options.length]);

  const keys = (e: React.KeyboardEvent) => {
    const i = options.findIndex((o) => o.value === value);
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    const fwd = rtl ? "ArrowLeft" : "ArrowRight";
    const back = rtl ? "ArrowRight" : "ArrowLeft";
    let n = i;
    if (e.key === fwd) n = Math.min(options.length - 1, i + 1);
    else if (e.key === back) n = Math.max(0, i - 1);
    else return;
    e.preventDefault();
    onChange(options[n].value);
    track.current?.querySelectorAll<HTMLElement>("[role=radio]")[n]?.focus();
  };

  return (
    <div className="seg" role="radiogroup" aria-label={label} ref={track} onKeyDown={keys}>
      {lens && (
        <span
          className={`seg-lens ${moving ? "is-moving" : ""}`}
          style={{ transform: `translateX(${lens.x}px)`, width: lens.w }}
          onTransitionEnd={() => setMoving(false)}
          aria-hidden
        />
      )}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          data-v={o.value}
          className={`seg-item ${o.value === value ? "is-on" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <Icon name={o.icon} size={15} />}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Menus: a pop-up button, and a menu of actions
// ---------------------------------------------------------------------------

interface MenuItem {
  key: string;
  label: string;
  icon?: SymbolName;
  danger?: boolean;
  checked?: boolean;
  onSelect: () => void;
}

function MenuList({ anchor, items, onClose }: { anchor: HTMLElement; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [active, setActive] = useState(Math.max(0, items.findIndex((i) => i.checked)));

  useLayoutEffect(() => {
    const a = anchor.getBoundingClientRect();
    const m = ref.current!.getBoundingClientRect();
    const rtl = document.documentElement.dir === "rtl";
    let left = rtl ? a.right - m.width : a.left;
    left = Math.min(Math.max(8, left), window.innerWidth - m.width - 8);
    let top = a.bottom + 6;
    if (top + m.height > window.innerHeight - 8) top = Math.max(8, a.top - m.height - 6);
    setPos({ top, left });
    ref.current!.focus();
  }, [anchor]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", down);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("resize", onClose);
    };
  }, [anchor, onClose]);

  const keys = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      anchor.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      items[active]?.onSelect();
      onClose();
      anchor.focus();
    } else if (e.key === "Tab") onClose();
  };

  return createPortal(
    <div
      ref={ref}
      className="menu glass-menu"
      role="menu"
      tabIndex={-1}
      onKeyDown={keys}
      style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden", top: 0, left: 0 }}
    >
      {items.map((it, i) => (
        <button
          key={it.key}
          type="button"
          role={it.checked === undefined ? "menuitem" : "menuitemradio"}
          aria-checked={it.checked}
          className={`menu-row ${i === active ? "is-active" : ""} ${it.danger ? "is-danger" : ""}`}
          onPointerEnter={() => setActive(i)}
          onClick={() => {
            it.onSelect();
            onClose();
          }}
          tabIndex={-1}
        >
          <span className="menu-icon">{it.checked ? <Icon name="checkmark" size={14} /> : it.icon ? <Icon name={it.icon} size={16} /> : null}</span>
          <span>{it.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}

/** A capsule with the current value and a round up/down stepper. */
export function Popup<T extends string>({ value, options, onChange, label, icon }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; icon?: SymbolName }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <button
        ref={btn}
        type="button"
        className="popup glass"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${current?.label ?? ""}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {icon && <Icon name={icon} size={16} />}
        <span>{current?.label}</span>
        <span className="stepper" aria-hidden>
          <Icon name="chevron.up.chevron.down" size={10} />
        </span>
      </button>
      {open && btn.current && (
        <MenuList anchor={btn.current} onClose={() => setOpen(false)} items={options.map((o) => ({ key: o.value, label: o.label, checked: o.value === value, onSelect: () => onChange(o.value) }))} />
      )}
    </>
  );
}

/** A button that opens a menu of actions. */
export function MenuButton({ icon, label, items, showLabel = false }: { icon: SymbolName; label: string; items: (MenuItem | false | null | undefined)[]; showLabel?: boolean }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const list = items.filter(Boolean) as MenuItem[];
  if (!list.length) return null;
  return (
    <>
      <button ref={btn} type="button" className={`btn ${showLabel ? "btn-quiet" : "btn-icon"}`} aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} onClick={() => setOpen((o) => !o)}>
        <Icon name={icon} />
        {showLabel && <span>{label}</span>}
      </button>
      {open && btn.current && <MenuList anchor={btn.current} items={list} onClose={() => setOpen(false)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Grouped sections and rows
// ---------------------------------------------------------------------------

export function Section({ title, note, children, trailing }: { title: string; note?: string; children: ReactNode; trailing?: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2>{title}</h2>
        {trailing}
      </div>
      <div className="group">{children}</div>
      {note && <p className="section-note">{note}</p>}
    </section>
  );
}

export function Row({ icon, label, sub, value, trailing, onClick, mono }: { icon?: SymbolName; label: ReactNode; sub?: ReactNode; value?: ReactNode; trailing?: ReactNode; onClick?: () => void; mono?: boolean }) {
  const body = (
    <>
      {icon && (
        <span className="row-icon">
          <Icon name={icon} />
        </span>
      )}
      <span className="row-main">
        <span className="row-label">{label}</span>
        {sub && <span className="row-sub">{sub}</span>}
      </span>
      {value !== undefined && <span className={`row-value ${mono ? "mono" : ""}`}>{value}</span>}
      {trailing && <span className="row-trailing">{trailing}</span>}
    </>
  );
  return onClick ? (
    <button type="button" className={`row row-button ${icon ? "has-icon" : ""}`} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={`row ${icon ? "has-icon" : ""}`}>{body}</div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="row row-empty">{children}</div>;
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

export function Avatar({ name, url, size = 32 }: { name: string; url?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const letter = [...(name || "?").trim()][0]?.toUpperCase() ?? "?";
  // A stable soft hue per name, so a list is easy to scan.
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return url && !broken ? (
    <img className="avatar" src={url} alt="" width={size} height={size} onError={() => setBroken(true)} referrerPolicy="no-referrer" />
  ) : (
    <span className="avatar avatar-letter" style={{ width: size, height: size, fontSize: size * 0.42, ["--h" as string]: h }} aria-hidden>
      {letter}
    </span>
  );
}

export function Chip({ tone = "plain", children }: { tone?: "plain" | "accent" | "danger" | "warning" | "success"; children: ReactNode }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

export function Spinner() {
  return <span className="spinner" role="progressbar" aria-busy="true" />;
}

// ---------------------------------------------------------------------------
// Dialogs and alerts
// ---------------------------------------------------------------------------

export function Dialog({ title, lead, children, onClose, footer, alert }: { title: string; lead?: ReactNode; children?: ReactNode; onClose: () => void; footer: ReactNode; alert?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    // The first field to type in, else the dialog's own action, else anything.
    const first = ["input:not([type=checkbox]), textarea", ".dialog-foot .btn-accent, .dialog-foot .btn-danger", "button"]
      .map((sel) => ref.current?.querySelector<HTMLElement>(sel))
      .find(Boolean);
    first?.focus();
    return () => prev?.focus?.();
  }, []);
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
    if (e.key === "Tab") {
      const f = [...(ref.current?.querySelectorAll<HTMLElement>("button, input, textarea, [tabindex='0']") ?? [])].filter((x) => !x.hasAttribute("disabled"));
      if (!f.length) return;
      const i = f.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && i === f.length - 1) {
        e.preventDefault();
        f[0].focus();
      }
    }
  };
  return createPortal(
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`dialog glass-menu ${alert ? "is-alert" : ""}`} role="dialog" aria-modal="true" aria-label={title} onKeyDown={keys}>
        <h2 className="dialog-title">{title}</h2>
        {lead && <p className="dialog-lead">{lead}</p>}
        {children && <div className="dialog-body">{children}</div>}
        <div className="dialog-foot">{footer}</div>
      </div>
    </div>,
    document.body,
  );
}

/** A labelled field. Use as="div" when it holds buttons rather than one input. */
export function Field({ label, hint, children, as = "label" }: { label: string; hint?: string; children: ReactNode; as?: "label" | "div" }) {
  const Tag = as;
  return (
    <Tag className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </Tag>
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

type Toast = { id: number; text: string; kind: "ok" | "error" };
let toasts: Toast[] = [];
const toastSubs = new Set<(t: Toast[]) => void>();
let toastId = 0;

export function toast(text: string, kind: Toast["kind"] = "ok") {
  const id = ++toastId;
  toasts = [...toasts, { id, text, kind }];
  for (const s of toastSubs) s(toasts);
  setTimeout(
    () => {
      toasts = toasts.filter((x) => x.id !== id);
      for (const s of toastSubs) s(toasts);
    },
    kind === "error" ? 9000 : 4000,
  );
}

export function Toasts() {
  const [list, setList] = useState<Toast[]>(toasts);
  useEffect(() => {
    toastSubs.add(setList);
    return () => void toastSubs.delete(setList);
  }, []);
  return createPortal(
    <div className="toasts" role="status" aria-live="polite">
      {list.map((x) => (
        <div key={x.id} className={`toast glass-menu toast-${x.kind}`}>
          <Icon name={x.kind === "error" ? "exclamationmark.triangle" : "checkmark"} size={16} />
          <span>{x.text}</span>
        </div>
      ))}
    </div>,
    document.body,
  );
}
