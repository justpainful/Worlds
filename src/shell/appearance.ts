import { useStore } from "../state/store";
import { glassScene } from "../glass/scene";
import type { QualityTier } from "../glass/materials";

export const ACCENTS: { name: string; hex: string }[] = [
  { name: "Sand", hex: "#d2a46e" },
  { name: "Sage", hex: "#8db39a" },
  { name: "Sky", hex: "#7fa7d9" },
  { name: "Rose", hex: "#d98c9a" },
  { name: "Copper", hex: "#d08560" },
  { name: "Graphite", hex: "#a1a1aa" },
];

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
  const accent = hexToRgb(profile?.accent ?? "") ?? hexToRgb(ACCENTS[0].hex)!;
  root.style.setProperty("--accent", `rgb(${accent.join(",")})`);
  root.style.setProperty("--accent-rgb", accent.join(", "));
  const quality = (settings["appearance.glass"] as QualityTier) ?? "full";
  glassScene.setQuality(quality);
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
