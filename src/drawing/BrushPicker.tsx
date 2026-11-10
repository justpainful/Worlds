import { useEffect, useRef, useState } from "react";
import { BRUSH_PRESETS, type BrushPreset } from "./presets";
import { newNode, newScene, type Brush } from "./model";
import { DrawingRenderer } from "./renderer";

function StrokePreview({ preset }: { preset: BrushPreset }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current; if (!c) return;
    const renderer = new DrawingRenderer(), scene = newScene(), frame = scene.frames[scene.defaultFrameId];
    frame.w = 120; frame.h = 34; frame.background = "transparent";
    const node = newNode("stroke", scene.layerOrder[0], frame.id, { x: 0, y: 0, w: 120, h: 34 });
    node.brush = { ...preset.brush, size: Math.min(14, preset.brush.size), color: getComputedStyle(c).color };
    node.samples = Array.from({ length: 60 }, (_, i) => ({ x: 9 + i / 59 * 102, y: 17 - Math.sin(i / 59 * Math.PI * 2) * 6, pressure: 0.35 + Math.sin(i / 59 * Math.PI) * 0.65, tiltX: 0, tiltY: 0, time: i * 8 })); node.seed = 12345;
    scene.nodes[node.id] = node; scene.nodeOrder = [node.id];
    const dpr = devicePixelRatio || 1; c.width = 120 * dpr; c.height = 34 * dpr;
    renderer.render(c, scene, { x: 0, y: 0, w: 120, h: 34, scale: dpr }, { background: false });
    return () => renderer.dispose();
  }, [preset]);
  return <canvas ref={canvas} className="drawing-stroke-preview" aria-hidden="true" />;
}
export function BrushStylePicker({ brush, arabic, onChange }: { brush: Brush; arabic: boolean; onChange: (brush: Brush) => void }) {
  const [open, setOpen] = useState(false), root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const current = BRUSH_PRESETS.find((preset) => preset.brush.kind === brush.kind);
  useEffect(() => {
    if (!open) return;
    const click = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", click, true); return () => document.removeEventListener("pointerdown", click, true);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const choices = root.current?.querySelectorAll<HTMLButtonElement>('[role="option"]');
    const selected = root.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]');
    (selected ?? choices?.[0])?.focus();
  }, [open]);
  return <div ref={root} className="drawing-brush-picker">
    <button ref={trigger} className="drawing-brush-trigger" aria-label={arabic ? "نوع الفرشاة" : "Brush style"} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>{current ? arabic ? current.ar : current.label : arabic ? "فرشاة مخصصة" : "Custom brush"}<span aria-hidden="true">⌄</span></button>
    {open && <div className="drawing-brush-menu" role="listbox" aria-label={arabic ? "أنواع الفرش" : "Brush styles"} onKeyDown={(e) => {
      if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); e.stopPropagation(); }
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
        e.preventDefault(); const choices = [...root.current!.querySelectorAll<HTMLButtonElement>('[role="option"]')], index = choices.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === "Home" ? 0 : e.key === "End" ? choices.length - 1 : (index + (e.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length;
        choices[next]?.focus();
      }
    }}>
      {BRUSH_PRESETS.map((preset) => <button role="option" aria-selected={preset.brush.kind === brush.kind} key={preset.id} onClick={() => { onChange({ ...preset.brush, color: brush.color }); setOpen(false); trigger.current?.focus(); }}><StrokePreview preset={preset} /><span>{arabic ? preset.ar : preset.label}</span></button>)}
    </div>}
  </div>;
}
