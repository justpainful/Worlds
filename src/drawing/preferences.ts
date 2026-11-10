import { DEFAULT_BRUSH, type Brush } from "./model";
import { normalizeBrush } from "./brush";
import type { Tool } from "./Stage";
export interface DrawingPreferences { brushes: Partial<Record<Tool, Brush>>; recent: string[]; background: string; autoShape: boolean; palette?: string[]; tipPageId?: string; laserLifetime?: number }
const key = (owner: string) => `worlds.drawing.tools.${owner}`;
export function readDrawingPreferences(owner: string, pageId?: string): DrawingPreferences {
  const defaults: DrawingPreferences = { brushes: {}, recent: [], background: "#ffffff", autoShape: true };
  try {
    const raw = JSON.parse(localStorage.getItem(key(owner)) ?? "null") as DrawingPreferences | null;
    if (!raw || typeof raw !== "object") return defaults;
    const brushes: DrawingPreferences["brushes"] = {};
    for (const [tool, brush] of Object.entries(raw.brushes ?? {})) {
      if (!["select", "brush", "eraser", "highlighter", "laser", "shape", "text", "eyedropper", "fill", "selection"].includes(tool)) continue;
      if (brush && typeof brush === "object" && /^#[\da-f]{6}([\da-f]{2})?$/i.test(brush.color)) {
        const normalized = normalizeBrush({ ...DEFAULT_BRUSH, ...brush });
        if (normalized.tipAssetId && (!pageId || raw.tipPageId !== pageId)) { delete normalized.tipAssetId; if (normalized.kind === "texture") normalized.kind = "hard"; }
        brushes[tool as Tool] = normalized;
      }
    }
    return { brushes, recent: Array.isArray(raw.recent) ? raw.recent.filter((c) => typeof c === "string" && /^#[\da-f]{6}([\da-f]{2})?$/i.test(c)).slice(0, 12) : [], palette: Array.isArray(raw.palette) ? raw.palette.filter((c) => typeof c === "string" && /^#[\da-f]{6}([\da-f]{2})?$/i.test(c)).slice(0, 256) : [], background: typeof raw.background === "string" && /^#[\da-f]{6}([\da-f]{2})?$/i.test(raw.background) ? raw.background : defaults.background, autoShape: typeof raw.autoShape === "boolean" ? raw.autoShape : true, tipPageId: pageId, laserLifetime: typeof raw.laserLifetime === "number" && Number.isFinite(raw.laserLifetime) ? Math.max(200, Math.min(4000, raw.laserLifetime)) : 1200 };
  } catch { return defaults; }
}
export function saveDrawingPreferences(owner: string, preferences: DrawingPreferences): boolean {
  try { localStorage.setItem(key(owner), JSON.stringify(preferences)); return true; } catch { return false; }
}
