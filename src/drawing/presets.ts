import { DEFAULT_BRUSH, type Brush } from "./model";
export interface BrushPreset { id: string; label: string; ar: string; brush: Brush }
const preset = (id: string, label: string, ar: string, brush: Partial<Brush>): BrushPreset => ({ id, label, ar, brush: { ...DEFAULT_BRUSH, ...brush } });
export const BRUSH_PRESETS: BrushPreset[] = [
  preset("brush", "Brush", "فرشاة", { kind: "hard", size: 12 }),
  preset("calligraphy", "Calligraphy brush", "فرشاة خط", { kind: "calligraphy", size: 22, angle: -38, roundness: 0.2, spacing: 0.035, pressureSize: false }),
  preset("handwriting", "Handwriting pen", "قلم الكتابة اليدوية", { kind: "ink", size: 7, spacing: 0.07, taperStart: 0.08, taperEnd: 0.16, pressureSize: true, pressureCurve: 0.65 }),
  preset("airbrush", "Airbrush", "البخاخة", { kind: "spray", size: 34, opacity: 0.65, flow: 0.3, spacing: 0.12, hardness: 0.1 }),
  preset("oil", "Oil brush", "فرشاة ألوان زيتية", { kind: "oil", size: 23, flow: 0.7, spacing: 0.2, roundness: 0.65, angle: -18 }),
  preset("crayon", "Crayon", "قلم تلوين", { kind: "crayon", size: 18, flow: 0.65, spacing: 0.14, opacity: 0.9 }),
  preset("highlighter", "Highlighter", "قلم تمييز", { kind: "highlighter", size: 28, opacity: 0.35, pressureSize: false }),
  preset("natural-pencil", "Natural pencil", "قلم رصاص", { kind: "natural-pencil", size: 4, flow: 0.65, opacity: 0.85, spacing: 0.18, pressureOpacity: true }),
  preset("watercolor", "Watercolor brush", "فرشاة ألوان مائية", { kind: "watercolor", size: 36, opacity: 0.24, flow: 0.25, hardness: 0.12, spacing: 0.18 }),
];
