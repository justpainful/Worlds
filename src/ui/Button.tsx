import { forwardRef, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { Tonal } from "./tonal/Tonal";
import { Icon, type IconName } from "./Icon";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  size?: "compact" | "standard";
  active?: boolean;
  iconSize?: number;
  shortcut?: string;
}

/** Quiet control for use on glass toolbars and surfaces. Hit area ≥ 32px, fill on hover. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, size = "compact", active, iconSize, className = "", shortcut, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      data-tip={shortcut ? `${label}  ${shortcut}` : label}
      className={`icon-btn icon-btn-${size} ${active ? "is-active" : ""} ${className}`}
      {...rest}
    >
      <Icon name={icon} size={iconSize ?? (size === "compact" ? 18 : 20)} />
    </button>
  );
});

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: IconName;
  variant?: "plain" | "tinted" | "danger" | "quiet";
  size?: "compact" | "standard" | "large";
  loading?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { icon, variant = "plain", size = "standard", loading, className = "", children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      className={`btn btn-${variant} btn-${size} ${loading ? "is-loading" : ""} ${className}`}
      {...rest}
    >
      {loading ? <Icon name="loading" size={16} className="spin" /> : icon ? <Icon name={icon} size={16} /> : null}
      {children && <span className="btn-label">{children}</span>}
    </button>
  );
});

export interface GroupItem {
  icon: IconName;
  label: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  active?: boolean;
  shortcut?: string;
}

/**
 * Related actions in one Tonal capsule, separated by hairlines
 * (the macOS 26 Mail toolbar grouping). Single actions get a round capsule.
 * `layer` and `material` are accepted from the glass era and ignored.
 */
export function GlassGroup({ items, className = "" }: { items: GroupItem[]; layer?: number; className?: string; material?: "bar" | "clear" | "control" }) {
  return (
    <Tonal className={`glass-group ${items.length === 1 ? "is-single" : ""} ${className}`} radius="var(--r-capsule)">
      <div className="glass-group-row">
        {items.map((it, i) => (
          <span key={it.label} style={{ display: "contents" }}>
            {i > 0 && <span className="gg-sep" aria-hidden />}
            <button
              type="button"
              className={`gg-btn ${it.active ? "is-active" : ""}`}
              aria-label={it.label}
              data-tip={it.shortcut ? `${it.label}  ${it.shortcut}` : it.label}
              disabled={it.disabled}
              onClick={it.onClick}
            >
              <Icon name={it.icon} size={21} />
            </button>
          </span>
        ))}
      </div>
    </Tonal>
  );
}

interface GlassButtonProps {
  icon?: IconName;
  children?: ReactNode;
  onClick?: (e: MouseEvent<HTMLElement>) => void;
  disabled?: boolean;
  prominent?: boolean;
  size?: "compact" | "standard" | "large";
  layer?: number;
  className?: string;
  label?: string;
  selected?: boolean;
}

/** Important actions: a Tonal control that answers hover and press as a whole. */
export function GlassButton({
  icon,
  children,
  onClick,
  disabled,
  prominent,
  size = "standard",
  className = "",
  label,
  selected,
}: GlassButtonProps) {
  return (
    <Tonal
      as="button"
      interactive
      disabled={disabled}
      selected={selected}
      className={`glass-btn glass-btn-${size} ${children ? "" : "glass-btn-icon"} ${prominent ? "is-prominent" : ""} ${className}`}
      onClick={disabled ? undefined : onClick}
      aria-label={label}
      data-tip={!children ? label : undefined}
      radius={children ? "var(--r-capsule)" : "50%"}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => {
        if (!disabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          (e.currentTarget as HTMLElement).click();
        }
      }}
    >
      <span className="glass-btn-inner">
        {icon && <Icon name={icon} size={size === "large" ? 20 : 18} />}
        {children && <span>{children}</span>}
      </span>
    </Tonal>
  );
}
