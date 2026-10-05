/**
 * Liquid Glass V2: material profiles.
 *
 * Every field here is read by the V2 pipeline; surface.test.ts fails if one
 * is not. Lengths are CSS px; blur values are SVG Gaussian sigma, not CSS
 * blur radii.
 */

export interface SceneTriple {
  /** bright backdrops (perceptual lightness above ~0.75) */
  light: number;
  /** mid backdrops */
  mid: number;
  /** dark backdrops (below ~0.2) */
  dark: number;
}

export interface ProfileV2 {
  /** Scales the lens band, bevel height and displacements. */
  opticalThickness: number;

  /** Frost branch (low frequency) and the near-sharp refracted branch. */
  bodyFrostSigma: number;
  edgeFrostSigma: number;
  /** Light diffusing inside the body, mixed into the refracted branch. */
  scatterSigma: number;
  scatterMix: number;
  /** Share of the body that is frost vs the refracted branch. */
  transmissionMix: number;
  frostMix: number;

  /** Macro surface: the bevel that bends the backdrop. */
  lensWidth: number;
  surfaceCurvePower: number;
  edgeDisplacement: number;
  midDisplacement: number;
  centerDisplacement: number;
  /** Tilt of the macro bevel's normal at the edge, degrees. */
  edgeTiltDeg: number;
  /** +1 samples inward (convex magnifier, Snell), -1 samples outward. */
  refractionSign: 1 | -1;

  /** Micro edge: the rounded lip of the glass, a sub-2px band of the same height field.
   * It shapes the light (the inner optical rim) but is too thin to bend the backdrop visibly,
   * so refraction uses the macro surface only. 0 width turns it off. */
  rimWidth: number;
  rimTiltDeg: number;
  /** Outer interface: the darker sliver where the glass meets the scene (alpha on bright scenes). */
  outerEdgeWidth: number;
  outerEdgeAlpha: number;

  /** Schlick Fresnel, and its output exposure by scene lightness (the equation never changes). */
  fresnelF0: number;
  fresnelPower: number;
  fresnelGain: number;
  fresnelExposure: SceneTriple;

  /** Synthetic environment: key lobe sharpness, top strip strength, and the bright horizon that
   * grazing reflections see (what lights the inner rim), with its strength on the side away from the key. */
  keyPower: number;
  stripStrength: number;
  horizonStrength: number;
  horizonCounter: number;
  specularGain: number;
  specularExponent: number;
  secondarySpecular: number;
  innerHighlight: number;
  innerShade: number;

  /** Body tonal shaping: compress chroma and contrast toward the local scene tone. */
  bodySaturation: number;
  bodyContrast: number;
  neutralization: SceneTriple;
  /** Lightness offset of the neutral target away from the scene's own tone (0 = pure compression). */
  neutralOffset: number;
  environmentColorSpill: number;

  /** Shadows (y, blur in px; opacity). */
  contactShadow: [number, number, number];
  bodyShadow: [number, number, number];
  ambientShadow: [number, number, number];
}

/** Phase 1.1: optical boundary, body presence, gentler refraction. */
export const regularToolbarV2: ProfileV2 = {
  opticalThickness: 1,

  bodyFrostSigma: 2.2,
  edgeFrostSigma: 0.55,
  scatterSigma: 0.9,
  scatterMix: 0.055,
  transmissionMix: 0.72,
  frostMix: 0.28,

  lensWidth: 13,
  surfaceCurvePower: 2.9,
  edgeDisplacement: 2.6,
  midDisplacement: 0.95,
  centerDisplacement: 0.14,
  edgeTiltDeg: 55,
  refractionSign: 1,

  rimWidth: 1.0,
  rimTiltDeg: 78,
  outerEdgeWidth: 0.5,
  outerEdgeAlpha: 0.06,

  fresnelF0: 0.045,
  fresnelPower: 5,
  fresnelGain: 0.95,
  fresnelExposure: { light: 1.25, mid: 1, dark: 0.5 },

  keyPower: 5,
  stripStrength: 0.12,
  horizonStrength: 3,
  horizonCounter: 0.6,
  specularGain: 0.13,
  specularExponent: 40,
  secondarySpecular: 0.035,
  innerHighlight: 1.4,
  innerShade: 0.04,

  bodySaturation: 0.94,
  bodyContrast: 0.935,
  neutralization: { light: 0.045, mid: 0.058, dark: 0.038 },
  neutralOffset: 0.02,
  environmentColorSpill: 0.04,

  contactShadow: [1, 1.5, 0.04],
  bodyShadow: [2, 6, 0.04],
  ambientShadow: [5, 14, 0.02],
};

/** Phase 1 as reviewed (kept to show before/after with the same code). */
export const regularToolbarV2Phase1: ProfileV2 = {
  ...regularToolbarV2,
  lensWidth: 10,
  surfaceCurvePower: 2.25,
  edgeDisplacement: 3.4,
  midDisplacement: 1.35,
  centerDisplacement: 0.2,
  edgeTiltDeg: 65,
  rimWidth: 0,
  outerEdgeAlpha: 0,
  fresnelExposure: { light: 1, mid: 1, dark: 1 },
  keyPower: 3,
  stripStrength: 0.25,
  horizonStrength: 0,
  specularExponent: 24,
  innerHighlight: 0.06,
  bodySaturation: 1.04,
  bodyContrast: 0.98,
  neutralization: { light: 0.025, mid: 0.035, dark: 0.045 },
  neutralOffset: 0.1,
  contactShadow: [1, 2, 0.04],
  bodyShadow: [3, 10, 0.045],
  ambientShadow: [8, 24, 0.025],
};
