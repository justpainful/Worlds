import type { ReactNode } from "react";
import { Icon, type IconName } from "../ui/Icon";
import { menuAt, type MenuItem } from "../ui/Menu";
import { useStore } from "../state/store";

/** Grouped inset list, the same look as Settings. */
export function Group({ title, children, note, action }: { title?: string; children: ReactNode; note?: ReactNode; action?: ReactNode }) {
  return (
    <section className="set-group">
      {(title || action) && (
        <div className="acct-group-head">
          {title && <h2 className="set-title">{title}</h2>}
          {action}
        </div>
      )}
      <div className="set-rows">{children}</div>
      {note && <p className="set-note">{note}</p>}
    </section>
  );
}

export function Row({ label, hint, children, lead }: { label: ReactNode; hint?: ReactNode; children?: ReactNode; lead?: ReactNode }) {
  return (
    <div className="set-row">
      {lead && <div className="acct-row-lead">{lead}</div>}
      <div className="set-row-text">
        <div className="set-row-label bidi">{label}</div>
        {hint && <div className="set-row-hint bidi">{hint}</div>}
      </div>
      {children && <div className="set-row-control">{children}</div>}
    </div>
  );
}

/** A quiet pop-up button: current value and a chevron, opening the app's glass menu. */
export function PopButton({ label, items, disabled, title }: { label: string; items: MenuItem[]; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      className="acct-pop"
      disabled={disabled}
      aria-label={title}
      aria-haspopup="menu"
      onClick={(e) => menuAt(e.currentTarget, items, "end")}
    >
      <span>{label}</span>
      {!disabled && <Icon name="chevronDown" size={13} />}
    </button>
  );
}

/** Rounded letter tile for a workspace (Personal uses the person glyph). */
export function WorkspaceTile({ name, personal, size = 22 }: { name?: string; personal?: boolean; size?: number }) {
  const letter = [...(name ?? "").trim()][0]?.toUpperCase() ?? "W";
  return (
    <span className={`acct-tile ${personal ? "is-personal" : ""}`} style={{ width: size, height: size, fontSize: size * 0.5 }} aria-hidden>
      {personal ? <Icon name="user" size={Math.round(size * 0.6)} /> : letter}
    </span>
  );
}

export function Notice({ icon, tone = "info", children }: { icon: IconName; tone?: "info" | "warning"; children: ReactNode }) {
  return (
    <div className={`acct-notice is-${tone}`} role="status">
      <Icon name={icon} size={16} />
      <div className="acct-notice-text">{children}</div>
    </div>
  );
}

export async function copyText(text: string, what = "Link") {
  try {
    await navigator.clipboard.writeText(text);
    useStore.getState().toast({ message: `${what} copied`, tone: "success" });
  } catch {
    useStore.getState().toast({ message: "Could not copy. Select the text and copy it instead.", tone: "error" });
  }
}

export function until(ms: number): string {
  const d = ms - Date.now();
  if (d <= 0) return "expired";
  const h = Math.round(d / 3_600_000);
  if (h < 1) return "expires within an hour";
  if (h < 48) return `expires in ${h} ${h === 1 ? "hour" : "hours"}`;
  return `expires in ${Math.round(h / 24)} days`;
}
