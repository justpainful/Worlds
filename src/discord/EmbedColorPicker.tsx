import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { Icon } from "../ui/Icon";

export interface EmbedColor {
  accentColor?: number;
  noAccent?: boolean;
}

/** Discord's own brand palette, so messages match the client. */
const DISCORD_COLORS: { name: string; hex: string }[] = [
  { name: "Blurple", hex: "#5865f2" },
  { name: "Green", hex: "#57f287" },
  { name: "Yellow", hex: "#fee75c" },
  { name: "Fuchsia", hex: "#eb459e" },
  { name: "Red", hex: "#ed4245" },
  { name: "White", hex: "#ffffff" },
  { name: "Dark", hex: "#23272a" },
];

export const hexToInt = (hex: string): number | undefined => {
  const m = hex.trim().replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(m) ? parseInt(m, 16) : undefined;
};
export const intToHex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

/** The colour of the accent bar on the Discord message (Components V2 container). */
export function EmbedColorPicker({ value, onChange }: { value: EmbedColor; onChange: (v: EmbedColor) => void }) {
  const profileAccent = useStore((s) => s.profile?.accent) ?? "#d2a46e";
  const effective = value.noAccent ? null : value.accentColor !== undefined ? intToHex(value.accentColor) : profileAccent.toLowerCase();
  const [hex, setHex] = useState(effective ?? "");
  useEffect(() => setHex(effective ?? ""), [effective]);

  const pick = (h: string) => {
    const n = hexToInt(h);
    if (n !== undefined) onChange({ accentColor: n, noAccent: false });
  };
  const isOn = (h: string) => effective === h.toLowerCase();
  const isPreset = effective !== null && (DISCORD_COLORS.some((c) => isOn(c.hex)) || effective === profileAccent.toLowerCase());

  return (
    <div className="embed-color">
      <div className="swatches embed-swatches">
        <button className={`swatch swatch-none ${value.noAccent ? "is-on" : ""}`} aria-label="No color" data-tip="No color" onClick={() => onChange({ noAccent: true })}>
          <span />
        </button>
        <button className={`swatch ${isOn(profileAccent) ? "is-on" : ""}`} style={{ background: profileAccent }} aria-label="Your accent" data-tip="Your accent" onClick={() => pick(profileAccent)} />
        {DISCORD_COLORS.map((c) => (
          <button key={c.hex} className={`swatch ${isOn(c.hex) ? "is-on" : ""}`} style={{ background: c.hex }} aria-label={c.name} data-tip={c.name} onClick={() => pick(c.hex)} />
        ))}
        <label className={`swatch swatch-custom ${effective && !isPreset ? "is-on" : ""}`} style={effective && !isPreset ? { background: effective } : undefined} data-tip="Any color">
          {!(effective && !isPreset) && <Icon name="add" size={13} />}
          <input type="color" value={effective ?? "#5865f2"} onChange={(e) => pick(e.target.value)} aria-label="Any color" />
        </label>
      </div>
      <div className="embed-hex">
        <span className="embed-hex-dot" style={{ background: effective ?? "transparent" }} />
        <input
          className="field field-narrow"
          dir="ltr"
          value={value.noAccent ? "" : hex}
          placeholder="none"
          maxLength={7}
          onChange={(e) => {
            const v = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
            setHex(v);
            if (hexToInt(v) !== undefined) pick(v);
          }}
        />
      </div>
    </div>
  );
}
