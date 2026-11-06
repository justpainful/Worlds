import { afterEach, describe, expect, it, vi } from "vitest";
const open = vi.hoisted(() => vi.fn());
vi.mock("../state/store", () => ({ useStore: { getState: () => ({ openPage: open }) } }));
import { consumeDrawingComment, openDrawingComment, consumeDrawingLocation, openDrawingLocation } from "./navigation";
afterEach(() => { vi.unstubAllGlobals(); open.mockClear(); });
describe("drawing notification navigation", () => {
  it("retains an exact requested thread and region until the drawing finishes opening", () => {
    vi.stubGlobal("window", new EventTarget()); const commentEvent = vi.fn(), locationEvent = vi.fn(); window.addEventListener("worlds:drawing-comment", commentEvent); window.addEventListener("worlds:drawing-location", locationEvent);
    openDrawingComment("drawing", "thread"); expect(open).toHaveBeenCalledWith("drawing", "current"); expect(commentEvent).toHaveBeenCalledOnce();
    expect(consumeDrawingComment("other")).toBeUndefined(); expect(consumeDrawingComment("drawing")).toBe("thread"); expect(consumeDrawingComment("drawing")).toBeUndefined();
    const camera = { x: 120, y: 80, w: 300, h: 200 }; openDrawingLocation("drawing", "frame", camera); expect(locationEvent).toHaveBeenCalledOnce(); expect(consumeDrawingLocation("drawing")).toEqual({ frameId: "frame", camera });
  });
});
