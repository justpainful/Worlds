/**
 * Liquid Glass material profiles.
 *
 * A profile is the full optical description of one kind of glass: how much
 * of the scene passes through, how it is frosted and compressed, how the
 * edge bends it (lensing), how the surface catches light, and how it sits
 * above the content. Values are in CSS pixels at optical thickness 1; the
 * engine scales them by `thickness` (bigger glass reads thicker: stronger
 * lensing, deeper shadow, softer scatter), never by blur alone.
 *
 * Starting point: Apple's Regular glass as it appears in the macOS 26 Mail
 * toolbar, matched by measurement in the ?glasslab harness.
 */

export type Material = "control" | "bar" | "menu" | "sheet" | "clear";
export type QualityTier = "full" | "reduced" | "solid";

export interface Shadow {
  y: number;
  blur: number;
  opacity: number;
}

export interface Profile {
  /** Optical thickness: control 1, toolbar 1.15, menu 1.4, sheet 1.7. */
  thickness: number;
  /** Share of the backdrop that passes through untouched by tint. */
  transmission: number;
  /** Backdrop frost, Gaussian sigma in px. */
  blur: number;
  /** Light diffusing inside the body near the edge. */
  scatter: { radius: number; strength: number };
  saturation: number;
  /** Dynamic range: contrast around mid grey, highlight compression, shadow lift. */
  contrast: number;
  brightness: number;
  highlightCompression: number;
  shadowLift: number;
  /** Neutral tint opacity by backdrop lightness, and the black response over bright scenes. */
  tint: { light: number; mid: number; dark: number };
  blackResponse: number;
  /** Refraction displacement (px): near the centre, across the body, and at the edge lens. */
  refraction: { center: number; body: number; edge: number; lensWidth: number };
  fresnel: { strength: number; power: number };
  /** Rim: width (px) and opacity facing the light, on the flanks, and the counter-reflection. */
  rim: { width: number; light: number; side: number; counter: number; dark: number };
  specular: { strength: number; roughness: number; spread: number; secondary: number };
  environment: { reflection: number; spill: number };
  inner: { highlight: number; shadow: number };
  shadow: { contact: Shadow; body: Shadow; ambient: Shadow };
  noise: number;
  /** Small glass flips light/dark with its backdrop; large glass keeps its tone. */
  flips: boolean;
}

const regular: Profile = {
  thickness: 1,
  transmission: 0.82,
  blur: 13,
  scatter: { radius: 3, strength: 0.08 },
  saturation: 1.1,
  // Calibrated on the reference: these, with the tint, give its body over white and over grey.
  contrast: 0.97,
  brightness: 1,
  highlightCompression: 0.02,
  shadowLift: 0.03,
  tint: { light: 0.1, mid: 0.115, dark: 0.14 },
  blackResponse: 0,
  refraction: { center: 0.4, body: 1.2, edge: 3.6, lensWidth: 9 },
  fresnel: { strength: 0.14, power: 4 },
  rim: { width: 0.75, light: 0.22, side: 0.1, counter: 0.14, dark: 0.025 },
  specular: { strength: 0.16, roughness: 0.32, spread: 18, secondary: 0.05 },
  environment: { reflection: 0.06, spill: 0.05 },
  inner: { highlight: 0.11, shadow: 0.05 },
  // Measured on the reference: about half the usual toolbar lift.
  shadow: {
    contact: { y: 1, blur: 2, opacity: 0.025 },
    body: { y: 3, blur: 10, opacity: 0.04 },
    ambient: { y: 7, blur: 22, opacity: 0.025 },
  },
  noise: 0.002,
  flips: true,
};

export const PROFILES: Record<Material, Profile> = {
  /** Small controls: buttons, segmented controls, fields. */
  control: regular,
  /** Toolbar capsules and grouped controls. */
  bar: { ...regular, thickness: 1.15 },
  /** Popovers, menus, the palette: thicker, more frosted, deeper lift; never flips. */
  menu: {
    ...regular,
    thickness: 1.4,
    blur: 20,
    transmission: 0.7,
    tint: { light: 0.5, mid: 0.56, dark: 0.62 },
    scatter: { radius: 4, strength: 0.14 },
    environment: { reflection: 0.07, spill: 0.09 },
    shadow: {
      contact: { y: 1, blur: 3, opacity: 0.12 },
      body: { y: 8, blur: 24, opacity: 0.22 },
      ambient: { y: 22, blur: 56, opacity: 0.2 },
    },
    flips: false,
  },
  /** Sheets and panels: the thickest glass. */
  sheet: {
    ...regular,
    thickness: 1.7,
    blur: 24,
    transmission: 0.62,
    tint: { light: 0.58, mid: 0.64, dark: 0.7 },
    scatter: { radius: 5, strength: 0.16 },
    environment: { reflection: 0.07, spill: 0.1 },
    shadow: {
      contact: { y: 1, blur: 3, opacity: 0.14 },
      body: { y: 12, blur: 32, opacity: 0.26 },
      ambient: { y: 30, blur: 72, opacity: 0.24 },
    },
    flips: false,
  },
  /** Clear: far more transparent, no adaptive tint; content behind is dimmed instead. */
  clear: {
    ...regular,
    transmission: 0.94,
    blur: 4,
    tint: { light: 0.03, mid: 0.04, dark: 0.05 },
    blackResponse: 0,
    refraction: { center: 0.3, body: 1, edge: 3, lensWidth: 8 },
    specular: { ...regular.specular, strength: 0.18 },
  },
};

/** Interaction, as deltas on the resting state. */
export const INTERACTION = {
  hover: { scale: 1.01, brightness: 0.03, rim: 0.08, refraction: 0.08, shadow: 0.08, ms: 120 },
  press: { scale: 0.982, lensing: 0.13, glow: 0.15, shadow: -0.18, ms: 90 },
  releaseMs: 180,
  /** Light that starts where the pointer acts and spreads inside the body. */
  glow: { radius: 40, opacity: 0.08, inMs: 110, outMs: 260 },
  morphMs: 240,
};

/** The window lost focus: the glass steps back. */
export const INACTIVE = { specular: 0.65, refraction: 0.82, shadow: 0.72, saturation: 0.9 };

/** Stacking tiers. Higher tiers see (and refract) the lower ones. */
export const LAYER = {
  chrome: 1,
  floating: 2,
  popover: 3,
  menu: 4,
  modal: 5,
} as const;

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
