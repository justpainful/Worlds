import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BRUSH } from "./model";
import { readDrawingPreferences, saveDrawingPreferences } from "./preferences";

afterEach(() => vi.unstubAllGlobals());
describe("owned drawing tool preferences", () => {
  it("keeps custom tip IDs in their owning drawing and preserves alpha colors", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) });
    expect(
      saveDrawingPreferences("owner", {
        brushes: {
          brush: { ...DEFAULT_BRUSH, kind: "texture", tipAssetId: "owned-tip", color: "#12345680", size: 2048 },
          highlighter: { ...DEFAULT_BRUSH, kind: "marker", pressureCurve: 0.65 },
        },
        recent: ["#12345680"],
        background: "#ffffff",
        autoShape: true,
        tipPageId: "drawing-a",
        laserLifetime: 2500,
      }),
    ).toBe(true);
    const own = readDrawingPreferences("owner", "drawing-a");
    expect(own.laserLifetime).toBe(2500);
    expect(own.brushes.brush?.tipAssetId).toBe("owned-tip");
    expect(own.brushes.brush?.size).toBe(2048);
    expect(own.brushes.brush?.color).toBe("#12345680");
    expect(own.recent).toEqual(["#12345680"]);
    expect(own.brushes.highlighter?.kind).toBe("marker");
    expect(own.brushes.highlighter?.pressureCurve).toBe(0.65);
    const otherDrawing = readDrawingPreferences("owner", "drawing-b");
    expect(otherDrawing.brushes.brush?.tipAssetId).toBeUndefined();
    expect(otherDrawing.brushes.brush?.kind).toBe("hard");
    expect(otherDrawing.brushes.brush?.size).toBe(2048);
    expect(readDrawingPreferences("other-owner", "drawing-a").brushes).toEqual({});
  });
  it("recovers bounded numeric settings and ignores unknown tool slots", () => {
    vi.stubGlobal("localStorage", {
      getItem: () =>
        JSON.stringify({
          brushes: {
            brush: { ...DEFAULT_BRUSH, size: 99999, pressureCurve: -1, pressureSize: "invalid", spacing: 0 },
            arbitrary: DEFAULT_BRUSH,
          },
          background: "bad",
        }),
    });
    const p = readDrawingPreferences("owner", "page");
    expect(p.brushes.brush).toMatchObject({ size: 2048, pressureCurve: 0.1, pressureSize: true, spacing: 0.01 });
    expect(Object.keys(p.brushes)).toEqual(["brush"]);
    expect(p.background).toBe("#ffffff");
  });
});
