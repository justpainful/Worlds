import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, errorMessage, fileUrl } from "../lib/api";
import type { Attachment, Profile } from "../lib/types";
import { useStore, pageTitle } from "../state/store";
import { Glass } from "../glass/Glass";
import { LAYER } from "../glass/materials";
import { Button, IconButton } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { menuAt } from "../ui/Menu";
import { Modal } from "../ui/Modal";
import { Avatar, EmptyState, PageIcon, relTime } from "../ui/misc";
import { SmartImage } from "../ui/SmartImage";
import { Segmented } from "../ui/Segmented";
import { RefIcon } from "../ui/ProductIcon";
import { Verified } from "../ui/Verified";
import { BlockBody, BlockFrame, type LiveData, type ProfileStats } from "../profile/BlockView";
import { BlockInspector, BlockPicker, move } from "../profile/BlockEditor";
import { dynamicSource, FEATURED, MAX_BLOCKS, sanitize, sizeOf, SIZES, starterBlocks, type ProfileBlock } from "../profile/blocks";
import { useBannerTone } from "../profile/bannerColor";
import { renderShareCard } from "../profile/shareCard";
import { useThumb } from "../media/thumbs";
import { bannerHeight, cropStyle, effectiveCrop, formatCrop, parseCrop, useImageInfo } from "../media/crop";
import { CropEditor } from "../media/CropEditor";

type Link = { label: string; url: string };
type Tab = "pages" | "media" | "about";

const SESSION_START = Date.now();
const toast = (message: string, tone: "error" | "success" | "info" = "info") => useStore.getState().toast({ message, tone });

function hostOf(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const fmt = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}K` : n.toLocaleString());

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
              <IconButton icon="share" label="Copy profile card" size="standard" className="pf-round" onClick={share} />
              <IconButton icon="more" label="More" size="standard" className="pf-round" onClick={(e) => moreMenu(e.currentTarget)} />
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
                <button key={i} className="pf-link" onClick={() => openUrl(l.url)}>
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

// ---------------------------------------------------------------------------
// Blocks: view + Customize Blocks
// ---------------------------------------------------------------------------

function BlocksSection({
  blocks,
  live,
  customizing,
  setCustomizing,
  onSave,
}: {
  blocks: ProfileBlock[];
  live: LiveData;
  customizing: boolean;
  setCustomizing: (v: boolean) => void;
  onSave: (b: ProfileBlock[]) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<ProfileBlock[]>(blocks);
  const [selected, setSelected] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  useEffect(() => {
    if (customizing) setDraft(blocks);
    else setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customizing]);

  const list = customizing ? draft : blocks.filter((b) => !b.hidden);
  const sel = draft.find((b) => b.id === selected) ?? null;

  const done = async () => {
    await onSave(draft);
    setCustomizing(false);
  };

  const onDrop = (e: DragEvent, targetId: string) => {
    e.preventDefault();
    if (!dragId || dragId === targetId) return;
    const from = draft.findIndex((b) => b.id === dragId);
    const to = draft.findIndex((b) => b.id === targetId);
    setDraft(move(draft, from, to));
    setDragId(null);
    setOverId(null);
  };

  if (!customizing && list.length === 0) {
    return (
      <section className="pf-blocks-empty">
        <div className="pf-blocks-empty-art">
          <RefIcon value="pi:design" size={44} />
          <RefIcon value="pi:star" size={44} />
          <RefIcon value="pi:activity" size={44} />
        </div>
        <div className="pf-blocks-empty-title">Make this profile yours</div>
        <p className="pf-blocks-empty-text">Blocks show what you are working on, your skills, links, media and live stats from Worlds.</p>
        <div className="pf-blocks-empty-actions">
          <Button variant="tinted" icon="grid" onClick={() => setCustomizing(true)}>
            Customize Blocks
          </Button>
          <Button variant="plain" onClick={() => onSave(starterBlocks())}>
            Start with suggestions
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="pf-blocks-wrap">
      <div className="pf-blocks-head">
        {customizing ? (
          <>
            <span className="pf-blocks-title">Customize Blocks</span>
            <span className="pf-blocks-count">
              {draft.length}/{MAX_BLOCKS}
            </span>
            <span className="grow" />
            <Button variant="quiet" onClick={() => setCustomizing(false)}>
              Cancel
            </Button>
            <Button variant="tinted" icon="check" onClick={done}>
              Done
            </Button>
          </>
        ) : (
          <>
            <span className="grow" />
            <button className="pf-customize" onClick={() => setCustomizing(true)}>
              <Icon name="grid" size={13} />
              Customize
            </button>
          </>
        )}
      </div>

      <div className="pf-blocks">
        {list.map((b, i) => {
          if (!customizing) {
            return (
              <BlockFrame key={b.id} block={b}>
                <BlockBody block={b} live={live} />
              </BlockFrame>
            );
          }
          const size = sizeOf(b.size);
          return (
            <div
              key={b.id}
              className={`pf-edit-cell ${dragId === b.id ? "is-dragging" : ""} ${overId === b.id ? "is-over" : ""} ${b.hidden ? "is-hidden" : ""}`}
              style={{ gridColumn: `span ${size.cols}`, gridRow: `span ${size.rows}` }}
              draggable
              onDragStart={(e) => {
                setDragId(b.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOverId(b.id);
              }}
              onDrop={(e) => onDrop(e, b.id)}
            >
              <BlockFrame block={{ ...b, size: "12x1" }} selected={selected === b.id} onClick={() => setSelected(b.id)} className="is-editing">
                <BlockBody block={b} live={live} />
              </BlockFrame>
              <div className="pf-edit-bar">
                {i < FEATURED && <span className="pf-featured">Featured</span>}
                <span className="pf-edit-grip" data-tip="Drag to reorder">
                  <Icon name="grip" size={14} />
                </span>
                <button
                  className="pf-edit-btn"
                  data-tip="Size"
                  onClick={() => {
                    const idx = SIZES.findIndex((s) => s.id === b.size);
                    const next = SIZES[(idx + 1) % SIZES.length].id;
                    setDraft(draft.map((x) => (x.id === b.id ? { ...x, size: next } : x)));
                  }}
                >
                  {sizeOf(b.size).label}
                </button>
                <button className="pf-edit-btn" data-tip="Edit" onClick={() => setSelected(b.id)}>
                  <Icon name="edit" size={13} />
                </button>
                <button className="pf-edit-btn is-danger" data-tip="Remove" onClick={() => setDraft(draft.filter((x) => x.id !== b.id))}>
                  <Icon name="minimize" size={13} />
                </button>
              </div>
            </div>
          );
        })}
        {customizing && draft.length < MAX_BLOCKS && (
          <button className="pf-add-block" onClick={() => setPicking(true)}>
            <Icon name="add" size={20} />
            <span>Add a block</span>
          </button>
        )}
      </div>

      {customizing && sel && (
        <Glass material="dense" layer={LAYER.popover} className="pf-inspector" radius="26px">
          <BlockInspector
            block={sel}
            onChange={(nb) => setDraft(draft.map((x) => (x.id === nb.id ? nb : x)))}
            onRemove={() => {
              setDraft(draft.filter((x) => x.id !== sel.id));
              setSelected(null);
            }}
            onClose={() => setSelected(null)}
          />
        </Glass>
      )}
      {picking && (
        <BlockPicker
          blocks={draft}
          onClose={() => setPicking(false)}
          onPick={(b) => {
            setDraft([...draft, b]);
            setSelected(b.id);
            setPicking(false);
          }}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function PagesTab() {
  const pages = useStore((s) => s.pages);
  const openPage = useStore((s) => s.openPage);
  const list = useMemo(
    () =>
      Object.values(pages)
        .filter((p) => !p.deletedAt && p.kind === "page")
        .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt)
        .slice(0, 12),
    [pages],
  );
  if (!list.length) return <EmptyState compact icon="page" title="No pages yet" text="Pages you create show up here." />;
  return (
    <div className="pf-pages">
      {list.map((p) => (
        <button key={p.id} className="pf-page" onClick={(e) => openPage(p.id, e.ctrlKey ? "tab" : e.altKey ? "right" : "current")}>
          <div className="pf-page-top">
            <PageIcon icon={p.icon} size={22} />
            {p.pinned && <Icon name="pin" size={12} />}
          </div>
          <span className="pf-page-title bidi">{pageTitle(p)}</span>
          <span className="pf-page-preview bidi">{p.preview || "Empty page"}</span>
          <span className="pf-page-time">{relTime(p.updatedAt)}</span>
        </button>
      ))}
    </div>
  );
}

function MediaTile({ a, onOpen }: { a: Attachment; onOpen: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const isVideo = a.kind === "video";
  const url = useThumb(isVideo ? null : fileUrl(a.id), 360, ref);
  return (
    <button ref={ref} className="pf-media-item" onClick={onOpen} data-tip={a.fileName}>
      {isVideo ? <video src={fileUrl(a.id)} muted preload="none" /> : url ? <img src={url} alt="" /> : <span className="pf-media-wait" />}
      {(a.kind === "gif" || isVideo) && <span className="pf-media-badge">{isVideo ? "Video" : "GIF"}</span>}
    </button>
  );
}

function MediaTab() {
  const [items, setItems] = useState<Attachment[] | null>(null);
  const openPage = useStore((s) => s.openPage);
  useEffect(() => {
    api
      .mediaRecent(60)
      .then((list) => {
        // The same picture is often imported more than once (a banner re-chosen): show it once.
        const seen = new Set<string>();
        setItems(list.filter((a) => (seen.has(`${a.fileName}|${a.size}`) ? false : (seen.add(`${a.fileName}|${a.size}`), true))).slice(0, 48));
      })
      .catch(() => setItems([]));
  }, []);
  if (items === null) return null;
  if (!items.length) return <EmptyState compact icon="image" title="No media yet" text="Images, GIFs and videos from your pages collect here." />;
  return (
    <div className="pf-media">
      {items.map((a) => (
        <MediaTile key={a.id} a={a} onOpen={() => a.pageId && openPage(a.pageId)} />
      ))}
    </div>
  );
}

function AboutTab({ profile, memberSince, stats, onEdit }: { profile: Profile; memberSince: string; stats: ProfileStats | null; onEdit: () => void }) {
  const now = useClock();
  const days = stats?.activeDays ?? [];
  const peak = Math.max(1, ...days.map((d) => d.count));
  return (
    <div className="pf-about">
      <ul className="about-list">
        {profile.location && (
          <li>
            <Icon name="globe" size={14} />
            <span className="bidi">{profile.location}</span>
          </li>
        )}
        <li>
          <Icon name="clock" size={14} />
          <span>{now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} local time</span>
        </li>
        <li>
          <Icon name="calendar" size={14} />
          <span>Since {memberSince}</span>
        </li>
        {stats?.words ? (
          <li>
            <Icon name="text" size={14} />
            <span>About {fmt(stats.words)} words written</span>
          </li>
        ) : null}
        <li>
          <Icon name="activity" size={14} />
          <span>{stats?.edits7d ?? 0} edits in the last 7 days</span>
        </li>
        {(profile.links ?? []).map((l, i) => (
          <li key={i}>
            <Icon name="link" size={14} />
            <button className="about-link" onClick={() => openUrl(l.url)}>
              <span className="bidi">{l.label || hostOf(l.url)}</span>
              <Icon name="external" size={12} />
            </button>
          </li>
        ))}
      </ul>
      {days.length > 0 && (
        <div className="pf-heat-wrap">
          <div className="pf-heat-label">Last 4 weeks</div>
          <div className="pb-heat is-large">
            {days.map((d) => (
              <span key={d.date} title={`${d.date}: ${d.count}`} style={{ opacity: d.count ? 0.3 + 0.7 * (d.count / peak) : 0.08 }} />
            ))}
          </div>
        </div>
      )}
      <div className="pref-note">
        <Icon name="lock" size={12} />
        Lives on this PC and owns every page here.
        <button className="link-btn" onClick={onEdit}>
          Edit details
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit Profile sheet
// ---------------------------------------------------------------------------

function EditProfile({
  profile,
  onClose,
  onSave,
  onPick,
  onAdjust,
}: {
  profile: Profile;
  onClose: () => void;
  onSave: (p: Partial<Profile>) => Promise<Profile | null>;
  onPick: (f: "avatar" | "banner") => void;
  onAdjust: (f: "avatar" | "banner") => void;
}) {
  const [d, setD] = useState<Profile>(profile);
  const setLink = (i: number, patch: Partial<Link>) => setD({ ...d, links: (d.links ?? []).map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const commit = async () => {
    const links = (d.links ?? [])
      .map((l) => ({ label: l.label.trim(), url: /^https?:\/\//.test(l.url.trim()) ? l.url.trim() : l.url.trim() ? `https://${l.url.trim()}` : "" }))
      .filter((l) => l.url);
    const ok = await onSave({ displayName: d.displayName, handle: d.handle, bio: d.bio, status: d.status, location: d.location, links });
    if (ok) onClose();
  };
  return (
    <Modal
      title="Edit Profile"
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="tinted" icon="check" onClick={commit}>
            Save
          </Button>
        </>
      }
    >
      <div className="pf-edit">
        <div className="pf-edit-media">
          <Button size="compact" icon="image" onClick={() => onPick("banner")}>
            {profile.banner ? "Change banner" : "Add banner"}
          </Button>
          {profile.banner && (
            <Button size="compact" icon="sliders" onClick={() => onAdjust("banner")}>
              Adjust banner
            </Button>
          )}
          <Button size="compact" icon="profile" onClick={() => onPick("avatar")}>
            Change avatar
          </Button>
          {profile.avatar && (
            <Button size="compact" icon="sliders" onClick={() => onAdjust("avatar")}>
              Adjust avatar
            </Button>
          )}
        </div>
        <div className="pbi-two">
          <label className="pbi-row">
            <span className="field-label">Name</span>
            <input className="field bidi" dir="auto" value={d.displayName} onChange={(e) => setD({ ...d, displayName: e.target.value })} />
          </label>
          <label className="pbi-row">
            <span className="field-label">Handle</span>
            <input className="field" dir="ltr" value={d.handle ?? ""} placeholder="handle" onChange={(e) => setD({ ...d, handle: e.target.value.replace(/\s/g, "") || null })} />
          </label>
        </div>
        <label className="pbi-row">
          <span className="field-label">Status</span>
          <input className="field bidi" dir="auto" maxLength={80} value={d.status ?? ""} placeholder="Exploring Game Development" onChange={(e) => setD({ ...d, status: e.target.value || null })} />
        </label>
        <label className="pbi-row">
          <span className="field-label">Bio</span>
          <textarea className="field bidi" dir="auto" rows={3} maxLength={400} value={d.bio ?? ""} placeholder="A sentence or two about you" onChange={(e) => setD({ ...d, bio: e.target.value || null })} />
        </label>
        <label className="pbi-row">
          <span className="field-label">Location</span>
          <input className="field bidi" dir="auto" value={d.location ?? ""} placeholder="City, country" onChange={(e) => setD({ ...d, location: e.target.value || null })} />
        </label>
        <div className="pbi-row">
          <span className="field-label">Links</span>
          <div className="links-edit">
            {(d.links ?? []).map((l, i) => (
              <div key={i} className="link-edit-row">
                <input className="field bidi" dir="auto" placeholder="Label" value={l.label} onChange={(e) => setLink(i, { label: e.target.value })} />
                <input className="field" dir="ltr" placeholder="https://" value={l.url} onChange={(e) => setLink(i, { url: e.target.value })} />
                <IconButton icon="close" label="Remove link" onClick={() => setD({ ...d, links: (d.links ?? []).filter((_, j) => j !== i) })} />
              </div>
            ))}
            {(d.links ?? []).length < 12 && (
              <button className="chip-btn" onClick={() => setD({ ...d, links: [...(d.links ?? []), { label: "", url: "" }] })}>
                <Icon name="add" size={13} />
                Add link
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
