import { useRef } from "react";
import { menuAt, useMenu } from "./Menu";
import { Icon } from "./Icon";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

export const LANGUAGE_OPTIONS: SelectOption<string>[] = [
  { value: "auto", label: "Automatic" },
  { value: "en", label: "English" },
  { value: "ar", label: "العربية" },
];

export const DIRECTION_OPTIONS: SelectOption<string>[] = [
  { value: "auto", label: "Direction follows the text" },
  { value: "rtl", label: "Right to left" },
  { value: "ltr", label: "Left to right" },
];

/**
 * Dropdown that opens the app's own glass menu instead of the native
 * Windows list (which ignores the theme and renders white).
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  disabled,
  label,
  className = "",
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (v: T) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const isOpen = useMenu((s) => s.open !== null);
  const current = options.find((o) => o.value === value);

  const open = () => {
    if (disabled || !ref.current) return;
    menuAt(
      ref.current,
      options.map((o) => ({
        label: o.label,
        checked: o.value === value,
        shortcut: o.hint,
        onSelect: () => o.value !== value && onChange(o.value),
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
      aria-haspopup="menu"
      aria-expanded={isOpen}
      aria-label={label}
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
