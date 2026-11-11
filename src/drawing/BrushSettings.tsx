import { useId, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { BRUSH_KINDS, normalizeBrush } from "./brushConfig";
import { DEFAULT_BRUSH, type Brush, type BrushKind } from "./model";
import { BRUSH_PRESETS } from "./presets";
import type { Tool } from "./Stage";
import { PenDiagnostics } from "./PenDiagnostics";

const NAMES: Record<BrushKind, [string, string]> = {
  hard: ["Hard brush", "فرشاة صلبة"],
  soft: ["Soft brush", "فرشاة ناعمة"],
  pencil: ["Pencil", "قلم"],
  ink: ["Ink", "حبر"],
  marker: ["Round marker", "قلم تمييز دائري"],
  highlighter: ["Chisel highlighter", "قلم تمييز مسطح"],
  spray: ["Airbrush", "بخاخة"],
  texture: ["Image tip", "رأس من صورة"],
  calligraphy: ["Calligraphy", "خط"],
  oil: ["Oil", "ألوان زيتية"],
  crayon: ["Crayon", "قلم تلوين"],
  "natural-pencil": ["Natural pencil", "قلم رصاص"],
  watercolor: ["Watercolor", "ألوان مائية"],
};

export function resetToolBrush(brush: Brush, tool: Tool): Brush {
  const preset = BRUSH_PRESETS.find((p) => p.brush.kind === brush.kind)?.brush;
  if (tool === "laser") return { ...DEFAULT_BRUSH, color: brush.color, size: 6 };
  if (tool === "highlighter")
    return {
      ...DEFAULT_BRUSH,
      kind: brush.kind === "marker" ? "marker" : "highlighter",
      color: brush.color,
      size: 28,
      opacity: 0.35,
      pressureSize: false,
    };
  const next = normalizeBrush({
    ...(preset ?? DEFAULT_BRUSH),
    kind: brush.kind,
    color: brush.color,
    ...(brush.kind === "soft" ? { hardness: 0.2 } : {}),
  });
  // A tip is an owned document asset, not a setting that reset should discard.
  if (brush.kind === "texture" && brush.tipAssetId) next.tipAssetId = brush.tipAssetId;
  return next;
}

export function BrushNumber({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  percent = max === 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  percent?: boolean;
}) {
  const base = useId(),
    scale = percent ? 100 : 1;
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft.trim() && Number.isFinite(Number(draft))) onChange(Math.max(min, Math.min(max, Number(draft) / scale)));
    setDraft(null);
  };
  return (
    <div className="drawing-brush-number">
      <label htmlFor={`${base}-range`}>{label}</label>
      <div>
        <input
          id={`${base}-range`}
          aria-label={label}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            setDraft(null);
            onChange(Number(e.target.value));
          }}
        />
        <input
          aria-label={`${label}${percent ? " (%)" : ""}`}
          type="number"
          inputMode="decimal"
          min={min * scale}
          max={max * scale}
          step={step * scale}
          value={draft ?? Number((value * scale).toFixed(3))}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              e.stopPropagation();
              setDraft(null);
            }
          }}
        />
        {percent && <span aria-hidden="true">%</span>}
      </div>
    </div>
  );
}

interface Props {
  tool: Tool;
  brush: Brush;
  arabic: boolean;
  disabled: boolean;
  tipName?: string;
  patch: (patch: Partial<Brush>) => void;
  reset: () => void;
  save: () => void;
  importTip: (file: File) => Promise<void>;
  laserLifetime: number;
  onLaserLifetime: (ms: number) => void;
}
export function BrushSettings({
  tool,
  brush,
  arabic,
  disabled,
  tipName,
  patch,
  reset,
  save,
  importTip,
  laserLifetime,
  onLaserLifetime,
}: Props) {
  const input = useRef<HTMLInputElement>(null),
    [importing, setImporting] = useState(false),
    [error, setError] = useState<string | null>(null);
  const t = (en: string, ar: string) => (arabic ? ar : en),
    laser = tool === "laser",
    dedicated = tool === "highlighter";
  if (!["brush", "eraser", "highlighter", "laser"].includes(tool)) return null;
  const uniform = !laser && (dedicated || brush.kind === "marker" || brush.kind === "highlighter");
  const number = (key: keyof Brush, en: string, ar: string, min = 0, max = 1, step = 0.01, percent = max === 1) => (
    <BrushNumber
      label={t(en, ar)}
      value={brush[key] as number}
      min={min}
      max={max}
      step={step}
      percent={percent}
      onChange={(value) => patch({ [key]: value })}
    />
  );
  const check = (key: "pressureSize" | "pressureOpacity" | "pressureFlow" | "straightLine", en: string, ar: string) => (
    <label className="drawing-check">
      <input type="checkbox" checked={!!brush[key]} onChange={(e) => patch({ [key]: e.target.checked })} />
      {t(en, ar)}
    </label>
  );
  return (
    <fieldset className="drawing-brush-settings" disabled={disabled || importing}>
      <legend>{t(laser ? "Laser settings" : "Brush settings", laser ? "إعدادات الليزر" : "إعدادات الفرشاة")}</legend>
      {!laser && (
        <label className="drawing-field">
          <span>{t(dedicated ? "Tip shape" : "Brush type", dedicated ? "شكل الرأس" : "نوع الفرشاة")}</span>
          <select
            value={brush.kind}
            onChange={(e) =>
              patch({ kind: e.target.value as BrushKind, ...(e.target.value === "soft" && brush.hardness === 1 ? { hardness: 0.2 } : {}) })
            }
          >
            {(dedicated ? (["marker", "highlighter"] as const) : BRUSH_KINDS).map((kind) => (
              <option value={kind} key={kind} disabled={kind === "texture" && !brush.tipAssetId}>
                {NAMES[kind][arabic ? 1 : 0]}
              </option>
            ))}
          </select>
        </label>
      )}
      {number("size", "Size in pixels", "الحجم بالبكسل", 1, 2048, 1, false)}
      {number("opacity", "Opacity", "الشفافية")}
      {laser ? (
        <BrushNumber
          label={t("Fade duration (seconds)", "مدة اختفاء الليزر بالثواني")}
          value={laserLifetime / 1000}
          min={0.2}
          max={4}
          step={0.1}
          percent={false}
          onChange={(seconds) => onLaserLifetime(Math.round(seconds * 1000))}
        />
      ) : (
        <>
          {number("flow", "Flow", "التدفق")}
          {!uniform && (
            <>
              {!["texture", "oil", "crayon", "natural-pencil", "watercolor"].includes(brush.kind) &&
                number("hardness", "Hardness", "الصلابة")}
              {number("spacing", "Tip spacing relative to size", "تباعد البصمات نسبةً للحجم", 0.01, 2, 0.01, true)}
              {brush.kind !== "spray" && (
                <>
                  {number("angle", "Tip angle", "زاوية الرأس", -360, 360, 1, false)}
                  {number("roundness", "Tip roundness", "استدارة الرأس", 0.05, 1)}
                </>
              )}
            </>
          )}
          {number("smoothing", "Smoothing", "التنعيم", 0, 0.95, 0.01, true)}
          {number("stabilizer", "Stabilizer distance in pixels", "مسافة التثبيت بالبكسل", 0, 100, 1, false)}
          {number("taperStart", "Start taper", "تدرّج بداية الخط", 0, 0.5, 0.01, true)}
          {number("taperEnd", "End taper", "تدرّج نهاية الخط", 0, 0.5, 0.01, true)}
          {check("pressureSize", "Pressure controls size", "الضغط يغيّر الحجم")}
          {!uniform && (
            <>
              {check("pressureOpacity", "Pressure controls opacity", "الضغط يغيّر الشفافية")}
              {check("pressureFlow", "Pressure controls flow", "الضغط يغيّر التدفق")}
            </>
          )}
          {dedicated && check("straightLine", "Straight-line highlight", "تظليل بخط مستقيم")}
          {number("pressureCurve", "Pressure curve", "منحنى الضغط", 0.1, 4, 0.05, false)}
          <p className="drawing-brush-note">
            {uniform
              ? t(
                  "A stroke keeps one opacity across crossings. Pressure changes width; flow is constant for that stroke.",
                  "يحافظ الخط على شفافية واحدة عند التقاطع. الضغط يغيّر العرض، والتدفق ثابت للضربة.",
                )
              : t("Pressure settings use a pen. A mouse uses full pressure.", "إعدادات الضغط تعمل مع القلم. الماوس يستخدم ضغطًا كاملًا.")}
          </p>
          <PenDiagnostics brush={brush} arabic={arabic} />
          {!dedicated && (
            <>
              {brush.kind === "texture" && (
                <p className="drawing-brush-note">
                  {tipName
                    ? t(`${tipName}. The tip uses the image's original colors.`, `${tipName}. يستخدم الرأس ألوان الصورة الأصلية.`)
                    : t("No image tip selected; a round fallback is used.", "لم يُحدد رأس من صورة، يُستخدم رأس دائري مؤقتًا.")}
                </p>
              )}
              <input
                hidden
                type="file"
                accept="image/png,image/jpeg,image/webp,image/bmp"
                ref={input}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) {
                    setImporting(true);
                    setError(null);
                    void importTip(file)
                      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
                      .finally(() => setImporting(false));
                  }
                }}
              />
              <Button size="compact" loading={importing} icon="upload" onClick={() => input.current?.click()}>
                {t("Import image tip", "استيراد رأس من صورة")}
              </Button>
              {brush.tipAssetId && (
                <Button
                  size="compact"
                  onClick={() => patch({ tipAssetId: undefined, kind: brush.kind === "texture" ? "hard" : brush.kind })}
                >
                  {t("Remove image tip", "إزالة رأس الصورة")}
                </Button>
              )}
            </>
          )}
          <Button size="compact" icon="add" onClick={save}>
            {t("Save brush to library", "حفظ الفرشاة في المكتبة")}
          </Button>
        </>
      )}
      <Button size="compact" icon="refresh" onClick={reset}>
        {t("Reset settings", "إعادة الإعدادات")}
      </Button>
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
