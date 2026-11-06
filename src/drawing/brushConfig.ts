import { DEFAULT_BRUSH, type Brush, type BrushKind } from "./model";
export const BRUSH_KINDS: BrushKind[] = ["pencil", "hard", "soft", "ink", "marker", "highlighter", "spray", "texture", "calligraphy", "oil", "crayon", "natural-pencil", "watercolor"];
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export function normalizeBrush(input: Partial<Brush>): Brush {
  const b = { ...DEFAULT_BRUSH, ...input };
  const num = (v: number, d: number, min: number, max: number) => Number.isFinite(v) ? clamp(v, min, max) : d;
  b.size = num(b.size, 12, 1, 2048); b.opacity = num(b.opacity, 1, 0, 1); b.flow = num(b.flow, 1, 0, 1);
  b.hardness = num(b.hardness, 1, 0, 1); b.spacing = num(b.spacing, 0.12, 0.01, 2);
  b.roundness = num(b.roundness, 1, 0.05, 1); b.angle = num(b.angle, 0, -360, 360);
  b.smoothing = num(b.smoothing, 0.15, 0, 0.95); b.stabilizer = num(b.stabilizer, 0, 0, 100);
  b.taperStart = num(b.taperStart, 0, 0, 0.5); b.taperEnd = num(b.taperEnd, 0, 0, 0.5);
  b.pressureCurve = num(b.pressureCurve, 1, 0.1, 4);
  if (!BRUSH_KINDS.includes(b.kind)) b.kind = DEFAULT_BRUSH.kind;
  for (const key of ["pressureSize", "pressureOpacity", "pressureFlow"] as const) if (typeof b[key] !== "boolean") b[key] = DEFAULT_BRUSH[key];
  if (typeof b.color !== "string" || !b.color || b.color.length > 128 || /[<>;{}]|url\s*\(/i.test(b.color)) b.color = DEFAULT_BRUSH.color;
  if (b.tipAssetId !== undefined && (typeof b.tipAssetId !== "string" || !b.tipAssetId || b.tipAssetId.length > 160)) delete b.tipAssetId;
  if(b.straightLine!==undefined&&typeof b.straightLine!=="boolean")delete b.straightLine;
  return b;
}
