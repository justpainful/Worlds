import { useStore } from "../state/store";
import { glassEngine } from "../glass/engine";
import type { QualityTier } from "../glass/profiles";
import { setAdaptiveQuality } from "../perf/monitor";
import { setTonalLook } from "../ui/tonal/scene";

export const ACCENTS: { name: string; hex: string }[] = [
  { name: "Blue", hex: "#2e92ff" },
  { name: "White", hex: "#ffffff" },
  { name: "Sage", hex: "#8db39a" },
  { name: "Sky", hex: "#7fa7d9" },
  { name: "Rose", hex: "#d98c9a" },
  { name: "Copper", hex: "#d08560" },
  { name: "Graphite", hex: "#a1a1aa" },
];

/** The old gold default. Profiles that still carry it move to the current default. */
const RETIRED_ACCENT = "#d2a46e";

/** The accent in effect for a profile value, with the retired default mapped forward. */
export function effectiveAccent(accent: string | null | undefined): string {
  return !accent || accent.toLowerCase() === RETIRED_ACCENT ? ACCENTS[0].hex : accent;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.trim().replace("#", "").match(/^([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Apply accent, glass quality, motion and density from profile + settings. */
export function applyAppearance() {
  const { profile, settings } = useStore.getState();
  const root = document.documentElement;
  const accent = hexToRgb(effectiveAccent(profile?.accent)) ?? hexToRgb(ACCENTS[0].hex)!;
  // Text on the accent follows its brightness, so blue takes white and white takes near black.
  const [r, g, b] = accent.map((c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  root.style.setProperty("--on-accent", 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.33 ? "#141416" : "#ffffff");
  root.style.setProperty("--accent", `rgb(${accent.join(",")})`);
  root.style.setProperty("--accent-rgb", accent.join(", "));
  const quality = (settings["appearance.glass"] as QualityTier) ?? "full";
  glassEngine.setQuality(quality);
  const tone = (settings["appearance.glassTone"] as "auto" | "light" | "dark") ?? "auto";
  const frost = typeof settings["appearance.glassFrost"] === "number" ? (settings["appearance.glassFrost"] as number) : 1;
  glassEngine.setLook(tone, frost);
  setTonalLook(tone);
  setAdaptiveQuality(settings["appearance.glassAdaptive"] !== false);
  const motion = (settings["appearance.motion"] as string) ?? "system";
  if (motion === "reduced") root.dataset.motion = "reduced";
  else delete root.dataset.motion;
  root.dataset.density = (settings["appearance.density"] as string) ?? "comfortable";
  root.dataset.transparency = (settings["appearance.transparency"] as string) ?? "off";
  const lang = profile?.language && profile.language !== "auto" ? profile.language : undefined;
  if (lang) root.lang = lang;
}

useStore.subscribe((s, prev) => {
  if (s.profile !== prev.profile || s.settings !== prev.settings) applyAppearance();
});
