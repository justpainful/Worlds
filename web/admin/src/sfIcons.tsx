/** SF Symbols for the dashboard (owner's Symbolic library). Not used by public pages. */
import { SYMBOLS, type SymbolName } from "./symbols";
import type { IconProps } from "./ui";

export function sfIcon(name: SymbolName, p: IconProps) {
  const s = SYMBOLS[name];
  if (!s) return null;
  const [x, y, w, h] = s.vb;
  return (
    <svg
      className={p.className}
      data-m={p["data-m"]}
      viewBox={`${x} ${y} ${w} ${h}`}
      height={p.size}
      width={(p.size * w) / h}
      role={p.label ? "img" : undefined}
      aria-label={p.label}
      aria-hidden={p.label ? undefined : true}
      focusable="false"
    >
      <path d={s.d} fill="currentColor" />
    </svg>
  );
}
