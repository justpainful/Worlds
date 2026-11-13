/**
 * Asked once on Home: what the person uses Worlds for. They pick a family and
 * turn on the packs that fit; nothing is forced, and Settings lists every pack
 * afterwards (docs/PACKS.md, Choosing packs).
 */
import { useState } from "react";
import { useStore } from "../../state/store";
import { ProductIcon } from "../../ui/ProductIcon";
import { FAMILIES, type FamilyId } from "../definition";
import { setPackEnabled } from "../packs";
import { PACK_DEFS, PACKS_KEY } from "../registry";

export function PackChooser({ onDone }: { onDone: () => void }) {
  const [family, setFamily] = useState<FamilyId | null>(null);
  const enabled = useStore((s) => s.settings[PACKS_KEY]);
  const on = new Set(Array.isArray(enabled) ? (enabled as string[]) : []);
  const families = FAMILIES.filter((f) => PACK_DEFS.some((p) => p.family === f.id));
  const packs = family ? PACK_DEFS.filter((p) => p.family === family) : [];

  return (
    <div className="res-card pack-chooser">
      <div className="pack-prompt-text">
        <strong>What do you use Worlds for?</strong>
        <span>Pick what fits and turn on the packs you want. Each adds its own tools; the rest stay out of the way. You can change this anytime in Settings → Packs.</span>
      </div>
      <div className="pack-families" role="group" aria-label="What you use Worlds for">
        {families.map((f) => (
          <button key={f.id} type="button" className={`pack-family ${family === f.id ? "is-on" : ""}`} aria-pressed={family === f.id} onClick={() => setFamily(family === f.id ? null : f.id)}>
            <ProductIcon name={f.icon} size={18} />
            {f.label}
          </button>
        ))}
      </div>
      {packs.length > 0 && (
        <div className="pack-choices">
          {packs.map((p) => {
            const isOn = on.has(p.id);
            return (
              <button key={p.id} type="button" className={`pack-choice ${isOn ? "is-on" : ""}`} aria-pressed={isOn} onClick={() => setPackEnabled(p.id, !isOn)}>
                <ProductIcon name={p.icon} size={28} />
                <span className="pack-choice-text">
                  <span className="pack-choice-name">{p.label}</span>
                  <span className="pack-choice-blurb">{p.blurb}</span>
                </span>
                <span className="pack-choice-state">{isOn ? "On" : "Turn on"}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="pack-prompt-actions">
        <button className="btn btn-quiet btn-compact" onClick={onDone}>
          {on.size ? "Done" : "Not now"}
        </button>
      </div>
    </div>
  );
}
