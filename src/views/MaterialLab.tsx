import { useState } from "react";
import { Glass } from "../glass/Glass";
import { LAYER, type MaterialName } from "../glass/materials";
import { Segmented } from "../ui/Segmented";
import { GlassButton } from "../ui/Button";

const BACKDROPS: { id: string; label: string; style: React.CSSProperties }[] = [
  { id: "black", label: "Black", style: { background: "#000" } },
  { id: "bright", label: "Bright", style: { background: "linear-gradient(135deg, #f4efe6, #e2d6c3 50%, #fafafa)" } },
  { id: "dark", label: "Dark image", style: { background: "radial-gradient(circle at 30% 30%, #2a3b4c, #0b1015 70%)" } },
  { id: "saturated", label: "Saturated", style: { background: "linear-gradient(120deg, #ff5f3a, #ffb321 35%, #19c37d 65%, #2e7dff)" } },
  { id: "text", label: "Text", style: { background: "#1c1c1e" } },
];

const LOREM =
  "حدثنا Nova8 إلى v2.4.1. The quick brown fox jumps over the lazy dog. الاجتماع الإداري الساعة 8:00 PM. Glass must stay readable over text, images and other glass. ";

/** Internal tuning surface for the material system (developer mode only). */
export function MaterialLab() {
  const [bg, setBg] = useState("saturated");
  const [mat, setMat] = useState<MaterialName>("regular");
  const backdrop = BACKDROPS.find((b) => b.id === bg)!;
  return (
    <div className="view view-wide lab">
      <header className="view-head">
        <div>
          <h1 className="view-title">Material Lab</h1>
          <p className="view-sub">Glass QA: backdrops, overlap, states, scrolling.</p>
        </div>
      </header>
      <div className="lab-controls">
        <Segmented value={bg} onChange={setBg} options={BACKDROPS.map((b) => ({ value: b.id, label: b.label }))} label="Backdrop" />
        <Segmented
          value={mat}
          onChange={(v) => setMat(v as MaterialName)}
          options={(["clear", "regular", "prominent", "control", "dense"] as MaterialName[]).map((m) => ({ value: m, label: m[0].toUpperCase() + m.slice(1) }))}
          label="Material"
        />
      </div>
      <div className="lab-stage scroll" style={backdrop.style}>
        <div className="lab-scroll-content">
          {bg === "text" && <p className="lab-text">{LOREM.repeat(30)}</p>}
          {bg !== "text" && (
            <div className="lab-shapes">
              <span className="lab-orb a" />
              <span className="lab-orb b" />
              <span className="lab-orb c" />
              <p className="lab-text on-image">{LOREM.repeat(6)}</p>
            </div>
          )}
        </div>
        <div className="lab-overlay">
          <Glass material={mat} layer={LAYER.chrome} className="lab-panel-a" radius="var(--r-float)">
            <div className="lab-label">Glass A · {mat}</div>
            <p className="lab-label-sub bidi">حدثنا Nova8 إلى v2.4.1.</p>
          </Glass>
          <Glass material="regular" layer={LAYER.popover} className="lab-panel-b" radius="var(--r-float)">
            <div className="lab-label">Glass B overlaps A</div>
            <p className="lab-label-sub">The overlap must read thicker and refract A.</p>
          </Glass>
          <div className="lab-buttons">
            <GlassButton icon="add">Hover and press me</GlassButton>
            <GlassButton icon="send" prominent>Prominent</GlassButton>
            <GlassButton icon="close" label="Icon only" />
            <GlassButton icon="lock" disabled>Disabled</GlassButton>
          </div>
        </div>
      </div>
    </div>
  );
}
