import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  if (typeof globalThis.document === "undefined") {
    globalThis.document = {
      createElement: () => ({ getContext: () => null, width: 0, height: 0 }),
      fonts: { load: async () => {}, [Symbol.iterator]: function*() {} },
    } as any;
  }
  if (typeof globalThis.window === "undefined") {
    globalThis.window = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as any;
  }
  if (typeof globalThis.location === "undefined") {
    globalThis.location = { search: "" } as any;
  }
  if (typeof globalThis.devicePixelRatio === "undefined") {
    globalThis.devicePixelRatio = 1;
  }
});

import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { ScreenDrawing, type CapturedScreen } from "./ScreenDrawing";
import { DEFAULT_BRUSH } from "./model";

describe("ScreenDrawing mode (Survey §1.2)", () => {
  const dummyCapture: CapturedScreen = {
    dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    width: 1920,
    height: 1080,
    wasFullscreen: false,
  };

  it("renders overlay palette with tools and controls in English", () => {
    const html = renderToStaticMarkup(
      React.createElement(ScreenDrawing, {
        capture: dummyCapture,
        arabic: false,
        initialBrush: DEFAULT_BRUSH,
        laserLifetime: 1000,
        onClose: async () => {},
        isShared: async () => false,
        onSave: async () => {},
      })
    );

    expect(html).toContain("Screen drawing tools");
    expect(html).toContain("Move");
    expect(html).toContain("Brush");
    expect(html).toContain("Highlighter");
    expect(html).toContain("Eraser");
    expect(html).toContain("Laser");
    expect(html).toContain("Shape");
    expect(html).toContain("Text");
    expect(html).toContain("Save to drawing");
    expect(html).toContain("Exit");
  });

  it("renders localized tools in Arabic", () => {
    const html = renderToStaticMarkup(
      React.createElement(ScreenDrawing, {
        capture: dummyCapture,
        arabic: true,
        initialBrush: DEFAULT_BRUSH,
        laserLifetime: 1000,
        onClose: async () => {},
        isShared: async () => false,
        onSave: async () => {},
      })
    );

    expect(html).toContain("أدوات الرسم على الشاشة");
    expect(html).toContain("تحريك");
    expect(html).toContain("فرشاة");
    expect(html).toContain("تحديد");
    expect(html).toContain("ممحاة");
    expect(html).toContain("ليزر");
    expect(html).toContain("شكل");
    expect(html).toContain("نص");
    expect(html).toContain("حفظ في الرسم");
    expect(html).toContain("خروج");
  });
});
