import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { useStore } from "../state/store";

/**
 * Worlds' own names for Claude's models and effort levels.
 * The underlying ids (haiku / sonnet / opus, low / medium / high) are what the
 * Claude Code bridge receives; people only ever see these names.
 */
export const MODELS = [
  { id: "haiku", name: "Spark", note: "Fastest. Everyday edits and quick answers." },
  { id: "sonnet", name: "Orbit", note: "Balanced. Writing, planning and longer pages." },
  { id: "opus", name: "Nova", note: "Deepest. Hard problems and long tasks." },
] as const;

export const EFFORTS = [
  { id: "low", name: "Glance", note: "Answers right away." },
  { id: "medium", name: "Focus", note: "Thinks a little before acting." },
  { id: "high", name: "Deep", note: "Thinks it through. Slower." },
] as const;

export function useModelSetting() {
  const settings = useStore((s) => s.settings);
  const set = useStore((s) => s.setSetting);
  const model = (settings["ai.model"] as string) ?? "haiku";
  const effort = (settings["ai.effort"] as string) ?? "low";
  const mi = Math.max(0, MODELS.findIndex((m) => m.id === model));
  const ei = Math.max(0, EFFORTS.findIndex((e) => e.id === effort));
  return {
    model: MODELS[mi],
    effort: EFFORTS[ei],
    modelIndex: mi,
    effortIndex: ei,
    setModel: (i: number) => set("ai.model", MODELS[i].id),
    setEffort: (i: number) => set("ai.effort", EFFORTS[i].id),
  };
}

/** A stepped slider: a track, a glassy thumb that snaps to stops, and the stop names underneath. */
export function StepSlider({
  label,
  stops,
  value,
  onChange,
  hue = "var(--accent)",
}: {
  label: string;
  stops: readonly { name: string }[];
  value: number;
  onChange: (i: number) => void;
  hue?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const last = stops.length - 1;
  const pick = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r) return;
    let t = (clientX - r.left) / r.width;
    if (getComputedStyle(track.current!).direction === "rtl") t = 1 - t;
    const i = Math.round(Math.max(0, Math.min(1, t)) * last);
    if (i !== value) onChange(i);
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pick(e.clientX);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) pick(e.clientX);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowUp") onChange(Math.min(last, value + 1));
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") onChange(Math.max(0, value - 1));
    else if (e.key === "Home") onChange(0);
    else if (e.key === "End") onChange(last);
    else return;
    e.preventDefault();
  };
  const pct = last ? (value / last) * 100 : 0;
  return (
    <div className="step-slider" style={{ ["--ss-hue" as string]: hue, ["--ss-pct" as string]: `${pct}%` }}>
      <div
        ref={track}
        className="ss-track"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={value}
        aria-valuetext={stops[value]?.name}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onKeyDown={onKey}
      >
        <span className="ss-rail" />
        <span className="ss-fill" />
        {stops.map((_, i) => (
          <span key={i} className={`ss-stop ${i <= value ? "is-on" : ""}`} style={{ left: `${last ? (i / last) * 100 : 0}%` }} />
        ))}
        <span className="ss-thumb" />
      </div>
      <div className="ss-labels">
        {stops.map((s, i) => (
          <button key={s.name} type="button" className={`ss-label ${i === value ? "is-on" : ""}`} onClick={() => onChange(i)} tabIndex={-1}>
            {s.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Both sliders with a live description: used in the composer popover and in Settings. */
export function IntelligenceControls() {
  const m = useModelSetting();
  return (
    <div className="intel">
      <div className="intel-block">
        <div className="intel-head">
          <span className="intel-title">Model</span>
          <span className="intel-value">{m.model.name}</span>
        </div>
        <StepSlider label="Model" stops={MODELS} value={m.modelIndex} onChange={m.setModel} hue="rgba(255, 255, 255, 0.9)" />
        <p className="intel-note">{m.model.note}</p>
      </div>
      <div className="intel-block">
        <div className="intel-head">
          <span className="intel-title">Effort</span>
          <span className="intel-value">{m.effort.name}</span>
        </div>
        <StepSlider label="Effort" stops={EFFORTS} value={m.effortIndex} onChange={m.setEffort} hue="rgba(255, 255, 255, 0.9)" />
        <p className="intel-note">{m.effort.note}</p>
      </div>
    </div>
  );
}
