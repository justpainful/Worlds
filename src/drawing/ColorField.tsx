import { useEffect, useState } from "react";
export function colorParts(value: string) {
  const match = /^#([\da-f]{6})([\da-f]{2})?$/i.exec(value);
  return { rgb: match ? `#${match[1]}` : "#202023", alpha: value === "transparent" ? 0 : match?.[2] ? parseInt(match[2], 16) / 255 : 1 };
}
export const colorAlpha = (rgb: string, alpha: number) =>
  `${rgb.slice(0, 7)}${
    alpha >= 1
      ? ""
      : Math.round(Math.max(0, alpha) * 255)
          .toString(16)
          .padStart(2, "0")
  }`;
export function ColorField({
  label,
  value,
  onChange,
  arabic,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  arabic: boolean;
}) {
  const [hex, setHex] = useState(value),
    parts = colorParts(value);
  useEffect(() => setHex(value), [value]);
  const save = () => {
    if (/^#[\da-f]{6}([\da-f]{2})?$/i.test(hex)) onChange(hex.toLowerCase());
    else setHex(value);
  };
  return (
    <div className="drawing-color-field">
      <label className="drawing-field">
        <span>{label}</span>
        <input type="color" value={parts.rgb} onChange={(e) => onChange(colorAlpha(e.target.value, parts.alpha))} />
      </label>
      <label className="drawing-field">
        <span>{label} HEX</span>
        <input
          dir="ltr"
          value={hex}
          maxLength={9}
          aria-invalid={hex.length > 0 && !/^#[\da-f]{6}([\da-f]{2})?$/i.test(hex)}
          onChange={(e) => setHex(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            } else if (e.key === "Escape") {
              e.stopPropagation();
              setHex(value);
            }
          }}
        />
      </label>
      <label className="drawing-field">
        <span>
          {label} {arabic ? "شفافية اللون" : "alpha"}
        </span>
        <input
          type="range"
          min={0}
          max={100}
          aria-valuetext={arabic ? `${Math.round(parts.alpha * 100)} بالمئة` : `${Math.round(parts.alpha * 100)} percent`}
          value={Math.round(parts.alpha * 100)}
          onChange={(e) => onChange(colorAlpha(parts.rgb, Number(e.target.value) / 100))}
        />
        <output>{Math.round(parts.alpha * 100)}%</output>
      </label>
    </div>
  );
}
