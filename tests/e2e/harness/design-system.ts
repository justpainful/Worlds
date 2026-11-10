/**
 * E2E Test Harness: Design System, Liquid Glass & Material 3 Tokens
 *
 * Implements authoritative visual tokens and accessibility rules from:
 * - PROJECT.md § Color Palettes
 * - docs/apple-native/DESIGN.md (Liquid Glass, Dynamic Type, Specular Rims)
 * - Android/DESIGN.md (48dp Touch Targets, Material 3, Contrast Ratios)
 */

export const PALETTE = {
  dark: {
    background: "#0C0C0E",
    pureBlack: "#000000",
    surface: "#18181B",
    border: "#27272A",
    textPrimary: "#FDFDFC",
    textMuted: "#A1A1AA",
  },
  light: {
    background: "#FDFDFC",
    warmPaper: "#F8F8F6",
    surface: "#FFFFFF",
    border: "#E4E4E7",
    textPrimary: "#0C0C0E",
    textMuted: "#71717A",
  },
  accent: {
    gold: "#D2A46E",
    goldHover: "#C4955F",
    goldPressed: "#B58650",
  },
};

export const LIQUID_GLASS_SPEC = {
  blurRadiusRange: { min: 20, max: 50 }, // px
  edgeRimWidth: { min: 1, max: 2 }, // px
  refractionLensingFactor: { min: 1.02, max: 1.20 },
  specularOpacity: { min: 0.15, max: 0.45 },
  dispersionSpread: { min: 0.5, max: 3.0 },
};

export const ANDROID_ACCESSIBILITY_SPEC = {
  minTouchTargetDp: 48, // Material 3 requirement
  minNormalTextContrast: 4.5, // WCAG AA
  minLargeTextContrast: 3.0, // WCAG AA
};

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  const num = parseInt(clean, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const srgb = [r, g, b].map((val) => {
    const v = val / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

export function calculateContrastRatio(fgHex: string, bgHex: string): number {
  const lum1 = relativeLuminance(fgHex);
  const lum2 = relativeLuminance(bgHex);
  const bright = Math.max(lum1, lum2);
  const dark = Math.min(lum1, lum2);
  return (bright + 0.05) / (dark + 0.05);
}

export function validateTouchTarget(
  widthDp: number,
  heightDp: number
): { valid: boolean; reason?: string } {
  if (
    widthDp < ANDROID_ACCESSIBILITY_SPEC.minTouchTargetDp ||
    heightDp < ANDROID_ACCESSIBILITY_SPEC.minTouchTargetDp
  ) {
    return {
      valid: false,
      reason: `Target ${widthDp}x${heightDp}dp is smaller than 48x48dp minimum required by Material 3`,
    };
  }
  return { valid: true };
}

export function validateLiquidGlassParameters(params: {
  blurRadius: number;
  edgeRimWidth: number;
  refractionFactor: number;
  specularOpacity: number;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (
    params.blurRadius < LIQUID_GLASS_SPEC.blurRadiusRange.min ||
    params.blurRadius > LIQUID_GLASS_SPEC.blurRadiusRange.max
  ) {
    errors.push(
      `blurRadius ${params.blurRadius} outside valid range [${LIQUID_GLASS_SPEC.blurRadiusRange.min}, ${LIQUID_GLASS_SPEC.blurRadiusRange.max}]`
    );
  }
  if (
    params.edgeRimWidth < LIQUID_GLASS_SPEC.edgeRimWidth.min ||
    params.edgeRimWidth > LIQUID_GLASS_SPEC.edgeRimWidth.max
  ) {
    errors.push(`edgeRimWidth ${params.edgeRimWidth} outside valid range`);
  }
  if (
    params.refractionFactor < LIQUID_GLASS_SPEC.refractionLensingFactor.min ||
    params.refractionFactor > LIQUID_GLASS_SPEC.refractionLensingFactor.max
  ) {
    errors.push(`refractionFactor ${params.refractionFactor} outside valid range`);
  }
  if (
    params.specularOpacity < LIQUID_GLASS_SPEC.specularOpacity.min ||
    params.specularOpacity > LIQUID_GLASS_SPEC.specularOpacity.max
  ) {
    errors.push(`specularOpacity ${params.specularOpacity} outside valid range`);
  }
  return { valid: errors.length === 0, errors };
}
