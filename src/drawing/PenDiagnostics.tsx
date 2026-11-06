import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "../ui/Button";
import { samplePointer } from "./brush";
import { DEFAULT_BRUSH, newNode, newScene, type Brush, type Sample } from "./model";
import { DrawingRenderer } from "./renderer";
import { strokeBounds } from "./brushBounds";

/** Local input probe. Its samples never enter the document, history or presence. */
export function PenDiagnostics({ brush, arabic }: { brush: Brush; arabic: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null), renderer = useRef<DrawingRenderer | null>(null), samples = useRef<Sample[]>([]), pointer = useRef<number | null>(null);
  const [reading, setReading] = useState<{ type: string; pressure: number; tiltX: number; tiltY: number; max: number } | null>(null);
  const latest = useRef(brush); latest.current = brush;
  const t = (en: string, ar: string) => arabic ? ar : en;
  const render = () => {
    const c = canvas.current, r = renderer.current; if (!c || !r) return;
    const scene = newScene(), f = scene.frames[scene.defaultFrameId]; f.w = 240; f.h = 120; f.background = "transparent";
    if (samples.current.length) {
      const b: Brush = { ...DEFAULT_BRUSH, kind: "marker", size: 24, color: latest.current.color, pressureSize: true, pressureCurve: latest.current.pressureCurve };
      const box = strokeBounds(samples.current, b), n = newNode("stroke", scene.layerOrder[0], f.id, box); n.brush = b; n.seed = 1;
      n.samples = samples.current.map((p) => ({ ...p, x: p.x - box.x, y: p.y - box.y })); scene.nodes[n.id] = n; scene.nodeOrder = [n.id];
    }
    c.width = 480; c.height = 240; r.render(c, scene, { x: 0, y: 0, w: 240, h: 120, scale: 2 }, { background: false });
  };
  useEffect(() => { renderer.current = new DrawingRenderer(); render(); return () => { renderer.current?.dispose(); renderer.current = null; }; }, []);
  useEffect(render, [brush.pressureCurve, brush.color]);
  const probe = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const e = event.nativeEvent;
    setReading((old) => ({ type: e.pointerType, pressure: e.pressure, tiltX: e.tiltX || 0, tiltY: e.tiltY || 0, max: Math.max(old?.max ?? 0, e.pressure) }));
    if (pointer.current !== e.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    for (const p of e.getCoalescedEvents?.().length ? e.getCoalescedEvents() : [e]) {
      if (samples.current.length >= 4096) break;
      samples.current.push(samplePointer(p, (p.clientX - rect.left) * 240 / rect.width, (p.clientY - rect.top) * 120 / rect.height));
    }
    render();
  };
  return <details className="drawing-pen-diagnostics"><summary>{t("Test pen and pressure curve", "اختبار القلم ومنحنى الضغط")}</summary>
    <p className="drawing-brush-note">{t("Draw here with light then firm pressure. This 24 px round pen tests the selected curve. Adjust the pressure curve above and compare the same samples.", "ارسم هنا بضغط خفيف ثم قوي. قلم الاختبار دائري بحجم 24 بكسل ويستخدم المنحنى المحدد. غيّر منحنى الضغط أعلاه لمقارنة نفس العينات.")}</p>
    <canvas ref={canvas} aria-label={t("Pen pressure test area", "مساحة اختبار ضغط القلم")} tabIndex={0} onPointerDown={(e) => { if (e.button !== 0) return; e.preventDefault(); pointer.current = e.pointerId; samples.current = []; setReading(null); e.currentTarget.setPointerCapture(e.pointerId); probe(e); }} onPointerMove={probe} onPointerUp={(e) => { if (pointer.current === e.pointerId) { pointer.current = null; e.currentTarget.releasePointerCapture(e.pointerId); } }} onPointerCancel={() => { pointer.current = null; }} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); pointer.current = null; samples.current = []; render(); } }} />
    {reading ? <dl>
      <div><dt>{t("Input", "الإدخال")}</dt><dd>{reading.type === "pen" ? t("Pen", "قلم") : reading.type === "touch" ? t("Touch", "لمس") : t("Mouse", "ماوس")}</dd></div>
      <div><dt>{t("Raw pressure", "الضغط الخام")}</dt><dd>{Math.round(reading.pressure * 100)}%</dd></div>
      <div><dt>{t("Peak pressure", "أعلى ضغط")}</dt><dd>{Math.round(reading.max * 100)}%</dd></div>
      <div><dt>{t("Mapped pressure", "الضغط بعد المنحنى")}</dt><dd>{Math.round(Math.pow(reading.type === "pen" ? Math.max(0.01, reading.pressure) : 1, brush.pressureCurve) * 100)}%</dd></div>
      <div><dt>{t("Tilt X / Y", "الميل الأفقي والرأسي")}</dt><dd>{reading.tiltX}° / {reading.tiltY}°</dd></div>
    </dl> : <p className="drawing-brush-note">{t("No pointer samples yet", "لم تصل عينات من القلم بعد")}</p>}
    <p className="drawing-brush-note">{t("A mouse uses full drawing pressure. Tilt is diagnostic and does not change the tip angle. Hardware calibration stays in your pen driver.", "الماوس يرسم بضغط كامل. قياس الميل للتشخيص ولا يغيّر زاوية الرأس. معايرة الجهاز تبقى في تعريف القلم.")}</p>
    <Button size="compact" onClick={() => { samples.current = []; setReading(null); render(); }}>{t("Clear test", "مسح الاختبار")}</Button>
  </details>;
}
