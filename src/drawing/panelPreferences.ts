export type DrawingPanelTab = "layers" | "frames" | "properties" | "history" | "steps" | "experiments" | "library" | "links" | "comments";
export interface DrawingPanelPreferences {
  open: boolean;
  width: number;
  tab: DrawingPanelTab;
}
const tabs: DrawingPanelTab[] = ["layers", "frames", "properties", "history", "steps", "experiments", "library", "links", "comments"];
export function readPanelPreferences(owner: string): DrawingPanelPreferences {
  const defaults: DrawingPanelPreferences = { open: innerWidth > 1000, width: 280, tab: "layers" };
  try {
    const p = JSON.parse(localStorage.getItem(`worlds.drawing.panel.${owner}`) ?? "null");
    if (!p || typeof p !== "object") return defaults;
    return {
      open: typeof p.open === "boolean" ? p.open : defaults.open,
      width: typeof p.width === "number" && Number.isFinite(p.width) ? Math.max(240, Math.min(420, p.width)) : 280,
      tab: tabs.includes(p.tab) ? p.tab : "layers",
    };
  } catch {
    return defaults;
  }
}
export function savePanelPreferences(owner: string, value: DrawingPanelPreferences) {
  try {
    localStorage.setItem(`worlds.drawing.panel.${owner}`, JSON.stringify(value));
  } catch {
    /* Layout remains usable when local storage is unavailable. */
  }
}
