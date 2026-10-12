import { describe, expect, it, vi } from "vitest";

// The sampler reads the DOM; the tone itself is pure.
vi.mock("../../glass/sampler", () => ({ sample: () => null }));
const { toneFor } = await import("./scene");

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const lum = ([r, g, b]: number[]) => 0.2126 * lin(r / 255) + 0.7152 * lin(g / 255) + 0.0722 * lin(b / 255);
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

function hslToRgb(css: string): number[] {
  const [h, s, l] = css.match(/[\d.]+/g)!.map(Number);
  const S = s / 100;
  const L = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

const scene = (r: number, g: number, b: number) => ({ r, g, b, luminance: lum([r, g, b]), busy: 0, chroma: 0 });

describe("Tonal controls", () => {
  const scenes = [
    scene(28, 28, 31), // the canvas
    scene(0, 0, 0),
    scene(255, 255, 255),
    scene(236, 240, 246), // a bright cover
    scene(40, 200, 120), // green
    scene(40, 120, 255), // blue
    scene(250, 210, 40), // yellow
    scene(255, 70, 60), // red
    scene(128, 128, 128),
  ];

  it("always keeps ink readable on the control's own fill (WCAG AA, 4.5:1)", () => {
    for (const a of scenes) {
      for (const forced of ["auto", "light", "dark"] as const) {
        const t = toneFor(a, undefined, forced);
        const fill = lum(hslToRgb(t.fill));
        const ink = t.dark ? 1 : 0.0105; // white, or rgba(0,0,0,0.86) over a near-white fill
        expect(contrast(fill, ink), `${JSON.stringify(a)} ${forced}`).toBeGreaterThan(4.5);
      }
    }
  });

  it("picks dark controls on dark scenes and light ones on light scenes, with a band against flicker", () => {
    expect(toneFor(scene(28, 28, 31)).dark).toBe(true);
    expect(toneFor(scene(250, 250, 250)).dark).toBe(false);
    const edge = scene(165, 165, 165); // relative luminance about 0.38
    expect(toneFor(edge, true).dark).toBe(true);
    expect(toneFor(edge, false).dark).toBe(false);
  });

  it("follows Settings when the look is forced", () => {
    expect(toneFor(scene(250, 250, 250), undefined, "dark").dark).toBe(true);
    expect(toneFor(scene(10, 10, 10), undefined, "light").dark).toBe(false);
  });
});
