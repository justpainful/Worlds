import { describe, expect, it } from "vitest";
import { fitWindow } from "./windowFit";

describe("restoring the window on another screen", () => {
  it("keeps a window that already fits", () => {
    expect(fitWindow({ x: 100, y: 80, w: 1380, h: 880 }, { x: 0, y: 0, w: 1920, h: 1032 })).toEqual({ x: 100, y: 80, w: 1380, h: 880 });
  });

  it("shrinks a window saved on a larger screen and keeps it above the taskbar", () => {
    // Saved at 100 % on a 2560 by 1440 monitor, now on a 1080p laptop at 150 %.
    expect(fitWindow({ x: 400, y: 200, w: 2070, h: 1320 }, { x: 0, y: 0, w: 1920, h: 1032 })).toEqual({ x: 0, y: 0, w: 1920, h: 1032 });
  });

  it("slides a window back inside a second monitor's work area", () => {
    expect(fitWindow({ x: 3000, y: 500, w: 1200, h: 800 }, { x: 1920, y: 0, w: 1280, h: 680 })).toEqual({ x: 2000, y: 0, w: 1200, h: 680 });
  });
});
