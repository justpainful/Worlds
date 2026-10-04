import { fileUrl } from "../lib/api";
import { useStore } from "../state/store";
import { Glass } from "../glass/Glass";
import { useBannerTone } from "./bannerColor";
import { useThumb } from "../media/thumbs";

/**
 * The optional Liquid Glass background (Settings, Appearance). Off by default.
 * The profile banner's light sits behind the view and the content rests on one
 * large glass sheet that refracts it. Rendered as the first child of a view,
 * positioned against the pane's scroll area.
 */
export function GlassBackdrop() {
  const on = useStore((s) => s.settings["appearance.glassBackground"] === true);
  // With window transparency on, the desktop itself is the background: never stack a second one.
  const transparent = useStore((s) => ((s.settings["appearance.transparency"] as string) ?? "off") !== "off");
  const banner = useStore((s) => s.profile?.banner ?? null);
  const src = banner ? fileUrl(banner) : null;
  const tone = useBannerTone(src);
  const still = useThumb(src, 96);
  if (!on || transparent) return null;
  return (
    <div className="glass-backdrop" aria-hidden style={{ ["--banner-rgb" as string]: tone.rgb, ["--banner-deep" as string]: tone.deep }}>
      <div className="glass-backdrop-light">{still && <img src={still} alt="" />}</div>
      <Glass material="regular" layer={0.5} className="glass-backdrop-sheet" responsive={false} />
    </div>
  );
}
