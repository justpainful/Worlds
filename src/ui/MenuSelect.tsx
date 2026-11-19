import { Children, Fragment, isValidElement, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { menuAt, useMenu } from "./Menu";
import { Icon } from "./Icon";

type OptionProps = { value?: string | number; disabled?: boolean; children?: ReactNode };

/** Plain text of an option label, for the menu row. */
function text(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return text(node.props.children);
  return "";
}

/** The <option> elements under a select, through fragments, maps and conditionals. */
function options(children: ReactNode): { value: string; label: string; disabled: boolean }[] {
  const out: { value: string; label: string; disabled: boolean }[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === Fragment) {
      out.push(...options((child as ReactElement<{ children?: ReactNode }>).props.children));
      return;
    }
    if (child.type !== "option") return;
    const props = (child as ReactElement<OptionProps>).props;
    const label = text(props.children);
    out.push({ value: props.value === undefined ? label : String(props.value), label, disabled: !!props.disabled });
  });
  return out;
}

/**
 * Drop-in for <select> with <option> children: same value, onChange and
 * disabled, but it opens the app's own menu. The native list ignores the
 * theme and draws a white box on Windows.
 */
export function MenuSelect({
  value,
  onChange,
  disabled,
  children,
  className = "",
  "aria-label": ariaLabel,
  title,
}: {
  value?: string | number;
  onChange?: (e: { target: { value: string }; currentTarget: { value: string } }) => void;
  disabled?: boolean;
  children?: ReactNode;
  className?: string;
  "aria-label"?: string;
  title?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  // The menu store is shared: only the control that opened the open menu shows itself expanded.
  const anyOpen = useMenu((s) => s.open !== null);
  const [mine, setMine] = useState(false);
  useEffect(() => {
    if (!anyOpen) setMine(false);
  }, [anyOpen]);
  const isOpen = mine && anyOpen;
  const list = options(children);
  const current = list.find((o) => o.value === String(value ?? ""));
  const open = () => {
    if (disabled || !ref.current) return;
    setMine(true);
    menuAt(
      ref.current,
      list.map((o) => ({
        label: o.label,
        checked: o.value === current?.value,
        disabled: o.disabled,
        onSelect: () => {
          if (o.value === current?.value) return;
          const target = { value: o.value };
          onChange?.({ target, currentTarget: target });
        },
      })),
      "start",
      true,
    );
  };
  return (
    <button
      ref={ref}
      type="button"
      className={`field select-trigger ${className}`}
      disabled={disabled}
      title={title}
      aria-haspopup="menu"
      aria-expanded={isOpen}
      aria-label={ariaLabel}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          open();
        }
      }}
    >
      <span className="select-value bidi">{current?.label ?? ""}</span>
      <Icon name="chevronDown" size={14} className="select-chevron" />
    </button>
  );
}
