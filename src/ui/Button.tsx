import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Glass } from "../glass/Glass";
import { LAYER } from "../glass/materials";
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
 * Related actions in one glass capsule, separated by hairlines
 * (the macOS 26 Mail toolbar pattern). Single actions get a round capsule.
 */
export function GlassGroup({ items, layer = LAYER.chrome, className = "", material = "regular" }: { items: GroupItem[]; layer?: number; className?: string; material?: "regular" | "clear" | "control" }) {
  return (
    <Glass material={material} layer={layer} className={`glass-group ${items.length === 1 ? "is-single" : ""} ${className}`} radius="var(--r-capsule)">
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
              <Icon name={it.icon} size={19} />
            </button>
          </span>
        ))}
      </div>
    </Glass>
  );
}

interface GlassButtonProps {
  icon?: IconName;
  children?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  prominent?: boolean;
  size?: "compact" | "standard" | "large";
  layer?: number;
  className?: string;
  label?: string;
  selected?: boolean;
}

/** Important actions: a real glass control with the full state model. */
export function GlassButton({
  icon,
  children,
  onClick,
  disabled,
  prominent,
  size = "standard",
  layer = LAYER.floating,
  className = "",
  label,
  selected,
}: GlassButtonProps) {
  return (
    <Glass
      as="button"
      material={prominent ? "prominent" : "control"}
      layer={layer}
      interactive
      disabled={disabled}
      selected={selected}
      className={`glass-btn glass-btn-${size} ${children ? "" : "glass-btn-icon"} ${className}`}
      onClick={disabled ? undefined : onClick}
      aria-label={label}
      data-tip={!children ? label : undefined}
      radius={children ? "var(--r-capsule)" : "50%"}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => {
        if (!disabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick?.();
        }
      }}
    >
      <span className="glass-btn-inner">
        {icon && <Icon name={icon} size={size === "large" ? 20 : 18} />}
        {children && <span>{children}</span>}
      </span>
    </Glass>
  );
}
