/**
 * Liquid Glass material definitions.
 *
 * Each material is a full optical parameter set, not an opacity value.
 * Adaptive ranges bound what the backdrop sampler may change at runtime.
 */

export type MaterialName = "clear" | "regular" | "prominent" | "control" | "dense";

export interface Range {
  base: number;
  min: number;
  max: number;
}

export interface MaterialSpec {
  /** Body (tint) opacity. */
  opacity: Range;
  /** Effective backdrop softness, px. Split into center/edge σ by the filter. */
  blur: Range;
  /** σ multipliers: center pane stays clearer, lens rim thicker. */
  centerBlurK: number;
  edgeBlurK: number;
  saturation: Range;
  brightness: Range;
  /** Share of sampled environment colour mixed into the tint. */
  spill: Range;
  /** Tint contribution of the material's own body colour. */
  tint: number;
  tintSelected: number;
  /** Max refraction displacement at the bezel, px. */
  refraction: number;
  /** Width of the curved bezel (thickness ramp), px, clamped to the shape. */
  bezel: number;
  /** Directional edge lighting (white alpha by orientation). */
  rim: { top: number; side: number; bottom: number; inner: number; width: number };
  /** Fresnel glow toward edges. */
  fresnel: number;
  shadow: { y: number; blur: number; opacity: number };
  /** Micro-noise alpha (0 to 0.02). */
  noise: number;
  /** Extra dimming over dark scenes for foreground readability. */
  dimCompensation: number;
}

export const MATERIALS: Record<MaterialName, MaterialSpec> = {
  regular: {
    opacity: { base: 0.12, min: 0.08, max: 0.2 },
    blur: { base: 6, min: 4, max: 9 },
    centerBlurK: 0.3,
    edgeBlurK: 0.62,
    saturation: { base: 1.14, min: 1.06, max: 1.22 },
    brightness: { base: 1.0, min: 1.0, max: 1.04 },
    spill: { base: 0.1, min: 0.05, max: 0.15 },
    tint: 0.08,
    tintSelected: 0.12,
    refraction: 14,
    bezel: 19,
    rim: { top: 0.3, side: 0.13, bottom: 0.06, inner: 0.1, width: 0.75 },
    fresnel: 0.06,
    shadow: { y: 8, blur: 24, opacity: 0.3 },
    noise: 0.01,
    dimCompensation: 0,
  },
  clear: {
    opacity: { base: 0.05, min: 0.02, max: 0.1 },
    blur: { base: 5, min: 3.5, max: 8 },
    centerBlurK: 0.24,
    edgeBlurK: 0.6,
    saturation: { base: 1.08, min: 1.02, max: 1.14 },
    brightness: { base: 1.0, min: 1.0, max: 1.03 },
    spill: { base: 0.06, min: 0.0, max: 0.06 },
    tint: 0.0,
    tintSelected: 0.06,
    refraction: 9,
    bezel: 14,
    rim: { top: 0.12, side: 0.07, bottom: 0.035, inner: 0.05, width: 0.75 },
    fresnel: 0.04,
    shadow: { y: 3, blur: 12, opacity: 0.1 },
    noise: 0.008,
    dimCompensation: 0.3,
  },
  prominent: {
    opacity: { base: 0.2, min: 0.14, max: 0.3 },
    blur: { base: 10, min: 7, max: 14 },
    centerBlurK: 0.4,
    edgeBlurK: 0.66,
    saturation: { base: 1.18, min: 1.1, max: 1.28 },
    brightness: { base: 1.0, min: 1.0, max: 1.04 },
    spill: { base: 0.12, min: 0.06, max: 0.16 },
    tint: 0.12,
    tintSelected: 0.16,
    refraction: 14,
    bezel: 17,
    rim: { top: 0.34, side: 0.15, bottom: 0.07, inner: 0.12, width: 0.75 },
    fresnel: 0.06,
    shadow: { y: 4, blur: 14, opacity: 0.16 },
    noise: 0.01,
    dimCompensation: 0,
  },
  control: {
    opacity: { base: 0.12, min: 0.08, max: 0.2 },
    blur: { base: 5, min: 3.5, max: 8 },
    centerBlurK: 0.3,
    edgeBlurK: 0.6,
    saturation: { base: 1.14, min: 1.06, max: 1.22 },
    brightness: { base: 1.0, min: 1.0, max: 1.04 },
    spill: { base: 0.1, min: 0.05, max: 0.14 },
    tint: 0.1,
    tintSelected: 0.14,
    refraction: 10,
    bezel: 13,
    rim: { top: 0.32, side: 0.14, bottom: 0.06, inner: 0.11, width: 0.75 },
    fresnel: 0.05,
    shadow: { y: 2, blur: 8, opacity: 0.14 },
    noise: 0.008,
    dimCompensation: 0,
  },
  dense: {
    opacity: { base: 0.74, min: 0.68, max: 0.84 },
    blur: { base: 30, min: 26, max: 36 },
    centerBlurK: 0.45,
    edgeBlurK: 0.7,
    saturation: { base: 1.12, min: 1.05, max: 1.2 },
    brightness: { base: 1.0, min: 0.96, max: 1.04 },
    spill: { base: 0.08, min: 0.04, max: 0.12 },
    tint: 0.1,
    tintSelected: 0.14,
    refraction: 6,
    bezel: 18,
    rim: { top: 0.16, side: 0.08, bottom: 0.035, inner: 0.05, width: 0.75 },
    fresnel: 0.04,
    shadow: { y: 10, blur: 34, opacity: 0.32 },
    noise: 0.01,
    dimCompensation: 0,
  },
};

/** Stacking tiers. Higher tiers sample (and refract) the composited lower ones. */
export const LAYER = {
  chrome: 1,
  floating: 2,
  popover: 3,
  menu: 4,
  modal: 5,
} as const;

export type QualityTier = "full" | "reduced" | "solid";

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
