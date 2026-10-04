import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openExternal } from "../../lib/links";
import { api, errorMessage, fileUrl } from "../../lib/api";
import type { Profile } from "../../lib/types";
import { useStore } from "../../state/store";
import { Glass } from "../../glass/Glass";
import { LAYER } from "../../glass/materials";
import { GlassButton, IconButton } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { menuAt } from "../../ui/Menu";
import { Avatar } from "../../ui/misc";
import { SmartImage } from "../../ui/SmartImage";
import { Segmented } from "../../ui/Segmented";
import { Verified } from "../../ui/Verified";
import { type LiveData, type ProfileStats } from "../../profile/BlockView";
import { dynamicSource, sanitize } from "../../profile/blocks";
import { useBannerTone } from "../../profile/bannerColor";
import { renderShareCard } from "../../profile/shareCard";
import { useThumb } from "../../media/thumbs";
import { bannerHeight, cropStyle, effectiveCrop, formatCrop, parseCrop, useImageInfo } from "../../media/crop";
import { CropEditor } from "../../media/CropEditor";
import { type Tab, SESSION_START, toast, hostOf, fmt } from "./shared";
import { BlocksSection } from "./BlocksSection";
import { PagesTab, MediaTab, AboutTab } from "./tabs";
import { EditProfile } from "./EditProfile";

export function ProfileView() {
  const profile = useStore((s) => s.profile)!;
  const settings = useStore((s) => s.settings);
  const setProfile = useStore((s) => s.setProfile);
  const openRoute = useStore((s) => s.open);
  const [editing, setEditing] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [bridge, setBridge] = useState<LiveData["bridge"]>(null);
  const [compact, setCompact] = useState(false);
  const [tab, setTab] = useState<Tab>("pages");
  const [adjust, setAdjust] = useState<"banner" | "avatar" | null>(null);
  const [bannerW, setBannerW] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const bannerEl = useRef<HTMLDivElement>(null);

  const bannerSrc = profile.banner ? fileUrl(profile.banner) : null;
  const tone = useBannerTone(bannerSrc);
  // The ambient light is a tiny still copy: blurring the animated original every frame is very expensive.
  const ambient = useThumb(bannerSrc, 96);
  const bannerInfo = useImageInfo(bannerSrc);
  const bannerCrop = effectiveCrop(profile.bannerFocus, bannerInfo);
  const avatarSrc = profile.avatar ? fileUrl(profile.avatar) : null;

  // The banner's height follows the picture's own proportions (see bannerHeight).
  useLayoutEffect(() => {
    const el = bannerEl.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBannerW(el.offsetWidth));
    ro.observe(el);
    setBannerW(el.offsetWidth);
    return () => ro.disconnect();
  }, []);
  const bannerH = bannerSrc ? bannerHeight(bannerW || 900, window.innerHeight, bannerInfo) : 240;
  const glassBg = settings["appearance.glassBackground"] === true;
  const blocks = useMemo(() => sanitize(profile.blocks), [profile.blocks]);

  useEffect(() => {
    api.profileStats().then(setStats).catch(() => setStats(null));
  }, [profile.updatedAt]);

  useEffect(() => {
    if (!blocks.some((b) => b.type === "dynamic" && dynamicSource(b.source) === "bridge")) return;
    api
      .discordStatus(false)
      .then((s) => setBridge({ state: s.state, bot: s.bot?.tag }))
      .catch(() => setBridge({ state: "error" }));
  }, [blocks]);

  // Scroll choreography: the banner parallaxes, the avatar shrinks and the name rises
  // into a glass toolbar. Driven by CSS variables, so scrolling never re-renders React.
  useLayoutEffect(() => {
    const el = root.current;
    const scroller = el?.closest(".pane-scroll") as HTMLElement | null;
    if (!el || !scroller) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const y = scroller.scrollTop;
      const banner = el.querySelector(".pf-banner") as HTMLElement | null;
      const limit = (banner?.offsetHeight ?? 300) - 40;
      const p = Math.max(0, Math.min(1, y / Math.max(1, limit)));
      el.style.setProperty("--pf-y", `${y}px`);
      el.style.setProperty("--pf-p", p.toFixed(3));
      setCompact(y > limit + 70);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  const save = useCallback(
    async (patch: Partial<Profile>) => {
      try {
        const p = await api.updateProfile(patch);
        setProfile(p);
        return p;
      } catch (e) {
        toast(errorMessage(e), "error");
        return null;
      }
    },
    [setProfile],
  );

  const pick = async (field: "avatar" | "banner") => {
    const path = await open({
      multiple: false,
      title: field === "banner" ? "Choose a banner (GIF, image)" : "Choose an avatar",
      filters: [{ name: "Images", extensions: ["gif", "png", "jpg", "jpeg", "webp", "avif"] }],
    });
    if (!path || Array.isArray(path)) return;
    try {
      const a = await api.importFile(null, path);
      await save({ [field]: a.id });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const share = async () => {
    try {
      const blob = await renderShareCard(profile, stats, tone, bannerSrc, profile.avatar ? fileUrl(profile.avatar) : null);
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        toast("Profile card copied. Paste it anywhere.", "success");
      } catch {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${profile.displayName || "profile"}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const moreMenu = (el: HTMLElement) =>
    menuAt(
      el,
      [
        { label: "Customize Blocks", icon: "grid", onSelect: () => setCustomizing(true) },
        { label: profile.banner ? "Change banner" : "Add banner", icon: "image", onSelect: () => pick("banner") },
        ...(profile.banner ? [{ label: "Remove banner", icon: "close" as const, onSelect: () => save({ banner: null }) }] : []),
        ...(profile.banner ? [{ label: "Adjust banner area", icon: "image" as const, onSelect: () => setAdjust("banner") }] : []),
        { label: "Change avatar", icon: "profile", onSelect: () => pick("avatar") },
        ...(profile.avatar ? [{ label: "Adjust avatar", icon: "profile" as const, onSelect: () => setAdjust("avatar") }] : []),
        { kind: "separator" },
        { label: glassBg ? "Solid background" : "Liquid Glass background", icon: "layers", onSelect: () => useStore.getState().setSetting("appearance.glassBackground", !glassBg) },
        { label: "Appearance and language", icon: "sliders", onSelect: () => openRoute({ kind: "settings", section: "appearance" }) },
      ],
      "end",
    );

  const live: LiveData = { stats, bridge, sessionStart: SESSION_START };
  const lightBanner = tone.luma > 0.62;
  const memberSince = new Date(profile.createdAt).toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const vars = {
    "--banner-rgb": tone.rgb,
    "--banner-deep": tone.deep,
    "--banner-accent": `rgb(${tone.rgb})`,
    "--ring": lightBanner ? "rgba(0, 0, 0, 0.32)" : "rgba(255, 255, 255, 0.3)",
  } as CSSProperties;

  return (
    <div ref={root} className={`pf ${glassBg ? "is-glass-bg" : ""} ${lightBanner ? "is-light-banner" : ""} ${customizing ? "is-customizing" : ""}`} style={vars}>
      {/* The canvas: banner light entering the page material. */}
      <div className="pf-canvas" aria-hidden>
        {ambient && <img className="pf-ambient" src={ambient} alt="" />}
      </div>

      {/* Compact glass toolbar after scrolling past the banner */}
      <div className={`pf-compact ${compact ? "is-on" : ""}`}>
        <Glass material="dense" layer={LAYER.chrome + 0.2} className="pf-compact-bar" radius="var(--r-capsule)">
          <button className="pf-compact-id" onClick={() => root.current?.closest(".pane-scroll")?.scrollTo({ top: 0, behavior: "smooth" })}>
            <Avatar id={profile.avatar} name={profile.displayName} size={28} />
            <span className="bidi">{profile.displayName || "Your profile"}</span>
          </button>
          <span className="gg-sep" />
          <IconButton icon="share" label="Copy profile card" onClick={share} />
          <IconButton icon="more" label="More" onClick={(e) => moreMenu(e.currentTarget)} />
        </Glass>
      </div>

      <div className="pf-banner" ref={bannerEl} style={{ height: bannerH }}>
        {bannerSrc ? (
          <div className="pf-banner-inner">
            <SmartImage src={bannerSrc} animated alt="" className="pf-banner-img" style={cropStyle(bannerCrop)} />
          </div>
        ) : (
          <button className="pf-banner-empty" onClick={() => pick("banner")}>
            <Icon name="image" size={22} />
            <span>Add a banner. Animated GIFs play here.</span>
          </button>
        )}
      </div>

      <div className="pf-body">
        {glassBg && <Glass material="regular" layer={0.5} className="pf-sheet" radius="34px 34px 0 0" responsive={false} />}
        <div className="pf-column">
          <header className="pf-id">
            <button className="pf-avatar" onClick={() => pick("avatar")} aria-label="Change avatar">
              <Avatar id={profile.avatar} name={profile.displayName} size={132} />
              <span className="pf-avatar-edit">
                <Icon name="edit" size={14} />
              </span>
            </button>
            <div className="pf-actions">
              <button className="pf-primary" onClick={() => setEditing(true)}>
                Edit Profile
              </button>
              <GlassButton icon="share" label="Copy profile card" layer={LAYER.chrome} onClick={share} />
              <GlassButton icon="more" label="More" layer={LAYER.chrome} onClick={(e) => moreMenu(e.currentTarget)} />
            </div>
          </header>

          <div className="pf-names">
            <h1 className="pf-name bidi">
              {profile.displayName || "Your name"}
              <Verified size={26} />
            </h1>
            {profile.handle && (
              <div className="pf-handle">
                <bdi>@{profile.handle}</bdi>
              </div>
            )}
            {profile.status && (
              <div className="pf-presence bidi" dir="auto">
                <span className="pf-presence-dot" />
                {profile.status}
              </div>
            )}
          </div>

          {profile.bio ? (
            <p className="pf-bio bidi" dir="auto">
              {profile.bio}
            </p>
          ) : (
            <button className="pf-bio is-empty" onClick={() => setEditing(true)}>
              Add a short bio
            </button>
          )}

          {(profile.links?.length || profile.location) && (
            <div className="pf-links">
              {profile.location && (
                <span className="pf-link is-plain">
                  <Icon name="globe" size={13} />
                  <span className="bidi">{profile.location}</span>
                </span>
              )}
              {(profile.links ?? []).map((l, i) => (
                <button key={i} className="pf-link" onClick={() => openExternal(l.url)}>
                  <Icon name="link" size={13} />
                  <span className="bidi">{l.label || hostOf(l.url)}</span>
                </button>
              ))}
            </div>
          )}

          <div className="pf-stats">
            {(
              [
                [stats?.pages, "Pages"],
                [stats?.chats, "Chats"],
                [stats?.automations, "Automations"],
                [stats?.streak, "Day streak"],
              ] as [number | undefined, string][]
            ).map(([n, label]) => (
              <div key={label} className="pf-stat">
                <span className="pf-stat-num">{n === undefined ? "--" : fmt(n)}</span>
                <span className="pf-stat-label">{label}</span>
              </div>
            ))}
          </div>

          <BlocksSection blocks={blocks} live={live} customizing={customizing} setCustomizing={setCustomizing} onSave={(b) => save({ blocks: b })} />

          <div className="pf-tabs">
            <Segmented
              value={tab}
              onChange={(v) => setTab(v as Tab)}
              options={[
                { value: "pages", label: "Pages" },
                { value: "media", label: "Media" },
                { value: "about", label: "About" },
              ]}
            />
          </div>
          {tab === "pages" && <PagesTab />}
          {tab === "media" && <MediaTab />}
          {tab === "about" && <AboutTab profile={profile} memberSince={memberSince} stats={stats} onEdit={() => setEditing(true)} />}
        </div>
      </div>

      {editing && <EditProfile profile={profile} onClose={() => setEditing(false)} onSave={save} onPick={pick} onAdjust={(w) => setAdjust(w)} />}
      {adjust === "banner" && bannerSrc && (
        <CropEditor
          title="Banner area"
          src={bannerSrc}
          aspect={(bannerW || 900) / bannerH}
          value={bannerCrop}
          onClose={() => setAdjust(null)}
          onReplace={() => {
            setAdjust(null);
            pick("banner");
          }}
          onSave={async (c) => {
            await save({ bannerFocus: c ? formatCrop(c) : null });
            setAdjust(null);
          }}
        />
      )}
      {adjust === "avatar" && avatarSrc && (
        <CropEditor
          title="Avatar"
          src={avatarSrc}
          aspect={1}
          round
          value={parseCrop(profile.avatarCrop)}
          onClose={() => setAdjust(null)}
          onReplace={() => {
            setAdjust(null);
            pick("avatar");
          }}
          onSave={async (c) => {
            await save({ avatarCrop: c ? formatCrop(c) : null });
            setAdjust(null);
          }}
        />
      )}
    </div>
  );
}
