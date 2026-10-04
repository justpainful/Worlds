import { forwardRef, type KeyboardEvent } from "react";
import { Icon } from "./Icon";

/**
 * The one search field. Native feel: a magnifier, a quiet placeholder, the
 * shortcut while empty, a round clear button once there is text, and a soft
 * focus (the field brightens a little; no browser outline).
 */
export const SearchField = forwardRef<
  HTMLInputElement,
  {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    shortcut?: string;
    autoFocus?: boolean;
    size?: "regular" | "compact";
    className?: string;
    onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
    onClear?: () => void;
  }
>(function SearchField({ value, onChange, placeholder = "Search", shortcut, autoFocus, size = "regular", className = "", onKeyDown, onClear }, ref) {
  return (
    <label className={`search-field sf-${size} ${className}`}>
      <Icon name="search" size={size === "compact" ? 13 : 14} className="sf-glass" />
      <input
        ref={ref}
        dir="auto"
        type="text"
        spellCheck={false}
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.preventDefault();
            e.stopPropagation();
            onChange("");
            onClear?.();
            return;
          }
          onKeyDown?.(e);
        }}
      />
      {value ? (
        <button
          type="button"
          className="sf-clear"
          aria-label="Clear"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onChange("");
            onClear?.();
          }}
        >
          <Icon name="close" size={9} weight={2.6} />
        </button>
      ) : shortcut ? (
        <kbd className="sf-kbd">{shortcut}</kbd>
      ) : null}
    </label>
  );
});
