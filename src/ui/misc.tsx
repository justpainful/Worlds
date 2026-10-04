import { useEffect, useState, type ReactNode } from "react";
import { ProductIcon, RefIcon } from "./ProductIcon";
import { cropStyle, parseCrop } from "../media/crop";
import { createPortal } from "react-dom";
import { fileUrl } from "../lib/api";
import { useStore } from "../state/store";
import { Glass } from "../glass/Glass";
import { LAYER } from "../glass/materials";
import { Icon, type IconName } from "./Icon";

/** Empty states show the matching product icon when one exists, like Apple apps. */
const EMPTY_PRODUCT: Partial<Record<IconName, string>> = {
  template: "templates",
  automation: "automations",
  page: "pages",
  pages: "pages",
  image: "image",
  activity: "activity",
  delete: "trash",
  pin: "bookmark",
  search: "search",
  assistant: "claude",
  discord: "discord",
  calendar: "calendar",
  schedule: "calendar",
  inbox: "inbox",
  history: "clock",
  folder: "folder",
  checklist: "checklist",
  layers: "integrations",
};

/** Elegant empty state: icon, short title, one sentence, one action. */
export function EmptyState({
  icon,
  title,
  text,
  action,
  compact,
}: {
  icon: IconName;
  title: string;
  text?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  const product = EMPTY_PRODUCT[icon];
  return (
    <div className={`empty ${compact ? "empty-compact" : ""}`}>
      {product ? (
        <ProductIcon name={product} size={compact ? 34 : 52} className="empty-product" />
      ) : (
        <div className="empty-icon">
          <Icon name={icon} size={compact ? 18 : 22} />
        </div>
      )}
      <div className="empty-title">{title}</div>
      {text && <div className="empty-text">{text}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function Avatar({ id, name, size = 28 }: { id?: string | null; name?: string; size?: number }) {
  const initials = (name ?? "")
    .trim()
    .split(/\s+/)
    .map((w) => [...w][0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const crop = useStore((s) => (id && s.profile?.avatar === id ? s.profile.avatarCrop : null));
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {id ? <img src={fileUrl(id)} alt="" crossOrigin="anonymous" draggable={false} style={crop ? cropStyle(parseCrop(crop)) : undefined} /> : <span className="bidi">{initials || "·"}</span>}
    </span>
  );
}

export function PageIcon({ icon, size = 16 }: { icon: string | null | undefined; size?: number }) {
  // Product icons and uploaded images render a touch larger than emoji to match their optical weight.
  if (icon && (icon.startsWith("pi:") || icon.startsWith("img:"))) return <RefIcon value={icon} size={Math.round(size * 1.12)} className="page-ref-icon" />;
  if (icon) return <span className="page-emoji" style={{ fontSize: size * 0.95, width: size, height: size }}>{icon}</span>;
  return <Icon name="page" size={size} className="page-glyph" />;
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return createPortal(
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <Glass key={t.id} material="dense" layer={LAYER.menu} className={`toast toast-${t.tone ?? "info"}`} radius="var(--r-capsule)">
          <div className="toast-row">
            {t.tone === "error" && <Icon name="warning" size={15} />}
            {t.tone === "success" && <Icon name="success" size={15} />}
            <span className="bidi">{t.message}</span>
            {t.action && (
              <button className="toast-action" onClick={() => { t.action!.run(); dismiss(t.id); }}>
                {t.action.label}
              </button>
            )}
          </div>
        </Glass>
      ))}
    </div>,
    document.body,
  );
}

/** Lightweight tooltip driven by data-tip attributes. */
export function TooltipHost() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  useEffect(() => {
    let timer = 0;
    let current: HTMLElement | null = null;
    const over = (e: PointerEvent) => {
      const el = (e.target as HTMLElement).closest?.("[data-tip]") as HTMLElement | null;
      if (el === current) return;
      current = el;
      clearTimeout(timer);
      setTip(null);
      if (!el) return;
      timer = window.setTimeout(() => {
        const r = el.getBoundingClientRect();
        const text = el.dataset.tip ?? "";
        if (text) setTip({ text, x: r.left + r.width / 2, y: r.bottom + 8 });
      }, 520);
    };
    const clear = () => {
      clearTimeout(timer);
      current = null;
      setTip(null);
    };
    window.addEventListener("pointerover", over);
    window.addEventListener("pointerdown", clear, true);
    window.addEventListener("wheel", clear, { passive: true });
    return () => {
      window.removeEventListener("pointerover", over);
      window.removeEventListener("pointerdown", clear, true);
      window.removeEventListener("wheel", clear);
    };
  }, []);
  if (!tip) return null;
  return createPortal(
    <div className="tooltip" style={{ left: tip.x, top: tip.y }} role="tooltip">
      {tip.text}
    </div>,
    document.body,
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <Icon name="loading" size={size} className="spin" />;
}

export function relTime(ms: number | null | undefined): string {
  if (!ms) return "";
  const d = Date.now() - ms;
  const abs = Math.abs(d);
  const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (abs < 45_000) return d >= 0 ? "just now" : "in a moment";
  if (abs < 3_600_000) return fmt.format(-Math.round(d / 60_000), "minute");
  if (abs < 86_400_000) return fmt.format(-Math.round(d / 3_600_000), "hour");
  if (abs < 7 * 86_400_000) return fmt.format(-Math.round(d / 86_400_000), "day");
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(ms).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function formatDateTime(ms: number | null | undefined): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
