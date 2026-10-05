/**
 * Liquid Glass V2: material profile (phase 1: the small toolbar control).
 *
 * Every field here is read by the V2 pipeline; profile.test.ts fails if one
 * is not. Lengths are CSS px; blur values are SVG Gaussian sigma, not CSS
 * blur radii.
 */

export interface ProfileV2 {
  /** Scales the lens band, bevel height and displacements. */
  opticalThickness: number;

  /** Frost branch (low frequency) and the near-sharp refracted branch. */
  bodyFrostSigma: number;
  edgeFrostSigma: number;
  /** Light diffusing inside the body, mixed into the refracted branch. */
  scatterSigma: number;
  scatterMix: number;
  /** Share of the body that is frost; the rest is the refracted branch. transmissionMix = 1 - frostMix. */
  transmissionMix: number;
  frostMix: number;

  /** Pseudo-height surface: bevel width, curve, displacements it produces. */
  lensWidth: number;
  surfaceCurvePower: number;
  edgeDisplacement: number;
  midDisplacement: number;
  centerDisplacement: number;
  /** Edge tilt of the surface normal, degrees (sets the bevel height). */
  edgeTiltDeg: number;
  /** +1 samples inward (convex magnifier, Snell), -1 samples outward. */
  refractionSign: 1 | -1;

  /** Schlick Fresnel. */
  fresnelF0: number;
  fresnelPower: number;
  fresnelGain: number;

  specularGain: number;
  specularExponent: number;
  secondarySpecular: number;
  innerHighlight: number;
  innerShade: number;

  /** Colour response. */
  saturation: number;
  contrast: number;
  lightTintLightScene: number;
  lightTintMidScene: number;
  darkSceneTint: number;
  environmentColorSpill: number;

  contactShadowOpacity: number;
  bodyShadowOpacity: number;
  ambientShadowOpacity: number;
}

export const regularToolbarV2: ProfileV2 = {
  opticalThickness: 1,

  bodyFrostSigma: 2.2,
  edgeFrostSigma: 0.55,
  scatterSigma: 0.9,
  scatterMix: 0.055,
  transmissionMix: 0.72,
  frostMix: 0.28,

  lensWidth: 10,
  surfaceCurvePower: 2.25,
  edgeDisplacement: 3.4,
  midDisplacement: 1.35,
  centerDisplacement: 0.2,
  edgeTiltDeg: 65,
  refractionSign: 1,

  fresnelF0: 0.045,
  fresnelPower: 5,
  fresnelGain: 0.95,

  specularGain: 0.13,
  specularExponent: 24,
  secondarySpecular: 0.035,
  innerHighlight: 0.06,
  innerShade: 0.04,

  saturation: 1.04,
  contrast: 0.98,
  lightTintLightScene: 0.025,
  lightTintMidScene: 0.035,
  darkSceneTint: 0.045,
  environmentColorSpill: 0.04,

  contactShadowOpacity: 0.04,
  bodyShadowOpacity: 0.045,
  ambientShadowOpacity: 0.025,
};
