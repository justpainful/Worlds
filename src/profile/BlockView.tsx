import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { openExternal } from "../lib/links";
import { fileUrl } from "../lib/api";
import { useStore, pageTitle } from "../state/store";
import { Glass } from "../glass/Glass";
import { LAYER } from "../glass/materials";
import { Icon } from "../ui/Icon";
import { PageIcon, relTime } from "../ui/misc";
import { RefIcon } from "../ui/ProductIcon";
import { SmartImage } from "../ui/SmartImage";
import { dynamicSource, FRAME_SHAPES, parseFocus, sizeOf, type FrameBlock, type ImageFit, type ImageSide, type ProfileBlock } from "./blocks";
import { useImageInfo } from "../media/crop";
import { BRIDGE } from "../discord/bridge";

export interface LiveData {
  stats: ProfileStats | null;
  bridge: { state: string; bot?: string } | null;
  sessionStart: number;
}

export interface ProfileStats {
  pages: number;
  chats: number;
  automations: number;
  streak: number;
  edits7d: number;
  words?: number;
  activeDays: { date: string; count: number }[];
}

const open = (url?: string) => {
  if (!url) return;
  if (/^https?:\/\//.test(url)) openExternal(url);
};

/** The frame: size on the 12-column grid plus the chosen style preset. */
export function BlockFrame({ block, children, onClick, selected, className = "" }: { block: ProfileBlock; children: ReactNode; onClick?: () => void; selected?: boolean; className?: string }) {
  const size = sizeOf(block.size);
  const style = {
    gridColumn: `span ${size.cols}`,
    gridRow: `span ${size.rows}`,
    "--pb-accent": block.accent ?? "var(--banner-accent, #8d99ff)",
  } as CSSProperties;
  const cls = `pblock pbt-${block.type} pb-style-${block.style} pb-size-${block.size.replace("x", "-")} ${selected ? "is-selected" : ""} ${onClick || block.url ? "is-clickable" : ""} ${className}`;
  const click = onClick ?? (block.url ? () => open(block.url) : undefined);
  if (block.style === "soft" || block.style === "tinted") {
    return (
      <Glass
        material={block.style === "tinted" ? "regular" : "clear"}
        layer={LAYER.chrome}
        className={cls}
        style={style}
        radius="24px"
        responsive={false}
        onClick={click}
      >
        {children}
      </Glass>
    );
  }
  return (
    <div className={cls} style={style} onClick={click}>
      {children}
    </div>
  );
}

function Art({ id, side = "right", fit = "contain", focus, video }: { id?: string; side?: ImageSide; fit?: ImageFit; focus?: string; video?: boolean }) {
  if (!id) return null;
  const f = parseFocus(focus);
  const st: CSSProperties = { objectFit: fit === "original" ? "none" : fit, objectPosition: `${f.x}% ${f.y}%` };
  return (
    <div className={`pb-art pb-art-${side}`}>
      {video ? <video src={fileUrl(id)} autoPlay muted loop playsInline style={st} /> : <SmartImage src={fileUrl(id)} animated alt="" style={st} />}
    </div>
  );
}

function Label({ icon, text }: { icon?: string; text?: string }) {
  if (!text) return null;
  return (
    <div className="pb-label">
      {icon && <RefIcon value={icon} size={16} />}
      <span className="bidi">{text}</span>
    </div>
  );
}

function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="pb-bar" role="progressbar" aria-valuenow={value} aria-valuemax={max}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

function ItemRow({ item, size = 44 }: { item: { icon?: string; title: string; subtitle?: string; url?: string }; size?: number }) {
  return (
    <div
      className={`pb-item ${item.url ? "is-link" : ""}`}
      onClick={
        item.url
          ? (e) => {
              e.stopPropagation();
              open(item.url);
            }
          : undefined
      }
    >
      {item.icon && (
        <span className="pb-item-icon" style={{ width: size, height: size }}>
          <RefIcon value={item.icon} size={size} />
        </span>
      )}
      <span className="pb-item-text">
        <span className="pb-item-title bidi">{item.title}</span>
        {item.subtitle && <span className="pb-item-sub bidi">{item.subtitle}</span>}
      </span>
    </div>
  );
}

function fmtMinutes(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

function useNow(ms = 30_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function Dynamic({ block, live }: { block: Extract<ProfileBlock, { type: "dynamic" }>; live: LiveData }) {
  const pages = useStore((s) => s.pages);
  const openPage = useStore((s) => s.openPage);
  const now = useNow();
  const latest = useMemo(
    () => Object.values(pages).filter((p) => !p.deletedAt && p.kind === "page").sort((a, b) => b.updatedAt - a.updatedAt)[0],
    [pages],
  );
  switch (dynamicSource(block.source)) {
    case "session": {
      const goal = block.goal ?? 120;
      const min = (now - live.sessionStart) / 60_000;
      return (
        <div className="pb-progress">
          <span className="pb-tile">
            <RefIcon value="pi:activity" size={44} />
          </span>
          <div className="pb-progress-main">
            <Bar value={min} max={goal} />
            <div className="pb-progress-row">
              <div>
                <div className="pb-item-title">{block.title || "Current session"}</div>
                <div className="pb-item-sub">
                  {fmtMinutes(min)} / {fmtMinutes(goal)}
                </div>
              </div>
              <span className="pb-progress-value">
                {Math.min(100, Math.round((min / goal) * 100))}/100
              </span>
            </div>
          </div>
        </div>
      );
    }
    case "streak": {
      const s = live.stats?.streak ?? 0;
      return (
        <div className="pb-stat">
          <RefIcon value="pi:star" size={40} />
          <div>
            <div className="pb-stat-num">
              {s} <span>day{s === 1 ? "" : "s"}</span>
            </div>
            <div className="pb-item-sub">{block.title || (s ? "Streak, keep it going" : "Edit a page to start a streak")}</div>
          </div>
        </div>
      );
    }
    case "activity": {
      const days = live.stats?.activeDays ?? [];
      const peak = Math.max(1, ...days.map((d) => d.count));
      return (
        <div className="pb-activity">
          <div className="pb-label">
            <span>{block.title || "Last 4 weeks"}</span>
          </div>
          <div className="pb-heat">
            {days.map((d) => (
              <span key={d.date} title={`${d.date}: ${d.count}`} style={{ opacity: d.count ? 0.3 + 0.7 * (d.count / peak) : 0.08 }} />
            ))}
          </div>
        </div>
      );
    }
    case "latest-page":
      return latest ? (
        <div className="pb-latest" onClick={() => openPage(latest.id)}>
          <div className="pb-label">
            <span>{block.title || "Latest page"}</span>
          </div>
          <div className="pb-latest-row">
            <PageIcon icon={latest.icon} size={26} />
            <div className="pb-item-text">
              <span className="pb-item-title bidi">{pageTitle(latest)}</span>
              <span className="pb-item-sub">Edited {relTime(latest.updatedAt)}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="pb-item-sub">No pages yet</div>
      );
    case "bridge": {
      const ok = live.bridge?.state === "connected";
      return (
        <div className="pb-stat">
          <RefIcon value="pi:discord" size={40} />
          <div>
            <div className="pb-item-title">{block.title || "Discord"}</div>
            <div className="pb-item-sub">
              <span className={`pb-dot ${ok ? "is-on" : ""}`} />
              {ok ? `Online as ${live.bridge?.bot ?? BRIDGE.name}` : live.bridge ? "Offline" : "Checking"}
            </div>
          </div>
        </div>
      );
    }
  }
}

/**
 * A photo frame: the picture is the widget. Shapes, fill or whole, radius,
 * a floating shadow, an optional line of text and a cross-fading slideshow.
 */
function FrameView({ block }: { block: FrameBlock }) {
  const [i, setI] = useState(0);
  const photos = block.photos;
  const n = photos.length;
  useEffect(() => {
    if (n < 2) return;
    const t = window.setInterval(() => setI((v) => (v + 1) % n), Math.max(3, block.interval ?? 8) * 1000);
    return () => clearInterval(t);
  }, [n, block.interval]);
  const current = n ? photos[i % n] : undefined;
  const info = useImageInfo(current ? fileUrl(current) : null);
  const shape = FRAME_SHAPES.find((s) => s.id === block.shape) ?? FRAME_SHAPES[0];
  const ratio = shape.id === "auto" ? (info?.width && info.height ? Math.max(0.33, Math.min(3, info.width / info.height)) : 1) : shape.ratio;
  const f = parseFocus(block.focus);
  const round = block.shape === "circle";
  const style = {
    aspectRatio: String(ratio),
    borderRadius: round ? "50%" : `${block.radius}px`,
  } as CSSProperties;
  if (!n) {
    return (
      <div className="frame-art is-empty" style={style}>
        <Icon name="image" size={22} />
        <span>Add photos</span>
      </div>
    );
  }
  return (
    <div className={`frame-art ${block.shadow ? "has-shadow" : ""} fit-${block.fit}`} style={style}>
      {photos.map((p, k) => (
        <div key={p + k} className={`frame-slide ${k === i % n ? "is-on" : ""}`}>
          {block.fit === "whole" && <img className="frame-back" src={fileUrl(p)} alt="" />}
          <SmartImage src={fileUrl(p)} animated alt="" className="frame-img" style={{ objectFit: block.fit === "whole" ? "contain" : "cover", objectPosition: `${f.x}% ${f.y}%` }} />
        </div>
      ))}
      {block.text && (
        <div className={`frame-text is-${block.textPos ?? "bottom"}`}>
          <span className="bidi" dir="auto">{block.text}</span>
        </div>
      )}
      {n > 1 && (
        <div className="frame-dots" aria-hidden>
          {photos.map((_, k) => (
            <span key={k} className={k === i % n ? "is-on" : ""} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Renders one block's content (no editing affordances). */
export function BlockBody({ block, live }: { block: ProfileBlock; live: LiveData }) {
  switch (block.type) {
    case "info":
      return (
        <>
          <Art id={block.image} side={block.imageSide} fit={block.imageFit} focus={block.focus} />
          <div className={`pb-hero ${block.image ? `has-art-${block.imageSide ?? "right"}` : ""}`}>
            <Label icon={block.labelIcon} text={block.label} />
            <div className="pb-title-row">
              <h3 className="pb-title bidi">{block.title}</h3>
              {block.badge && <span className="pb-badge">{block.badge}</span>}
            </div>
            {block.subtitle && <div className="pb-subtitle bidi">{block.subtitle}</div>}
          </div>
        </>
      );
    case "quote":
      return (
        <>
          <Art id={block.image} side={block.imageSide} fit={block.imageFit} focus={block.focus} />
          <div className={`pb-hero pb-quote-body align-${block.align ?? "start"} ${block.image ? `has-art-${block.imageSide ?? "right"}` : ""}`}>
            <Label icon={block.labelIcon} text={block.label} />
            <div className="pb-statement bidi">{block.statement}</div>
            {block.subtext && <div className="pb-subtitle bidi">{block.subtext}</div>}
          </div>
        </>
      );
    case "progress": {
      const pct = block.max > 0 ? Math.round((block.value / block.max) * 100) : 0;
      return (
        <div className="pb-progress">
          {block.icon && (
            <span className="pb-tile">
              <RefIcon value={block.icon} size={44} />
            </span>
          )}
          <div className="pb-progress-main">
            <Bar value={block.value} max={block.max} />
            <div className="pb-progress-row">
              <div>
                <div className="pb-item-title bidi">{block.title}</div>
                {block.caption && <div className="pb-item-sub bidi">{block.caption}</div>}
              </div>
              {block.display !== "none" && <span className="pb-progress-value">{block.display === "percent" ? `${pct}%` : `${block.value}/${block.max}`}</span>}
            </div>
          </div>
        </div>
      );
    }
    case "grid":
      return (
        <div className="pb-section">
          {block.title && <div className="pb-label"><span className="bidi">{block.title}</span></div>}
          <div className="pb-grid" style={{ gridTemplateColumns: `repeat(${block.columns}, minmax(0, 1fr))` }}>
            {block.items.map((it, i) => (
              <ItemRow key={i} item={it} size={48} />
            ))}
          </div>
        </div>
      );
    case "list":
      return (
        <div className="pb-section">
          {block.title && <div className="pb-label"><span className="bidi">{block.title}</span></div>}
          <div className="pb-list">
            {block.items.map((it, i) => (
              <ItemRow key={i} item={it} size={36} />
            ))}
          </div>
        </div>
      );
    case "media":
      return block.media ? (
        <div className="pb-media">
          <Art id={block.media} side="background" fit={block.fit} focus={block.focus} video={block.isVideo} />
          {block.caption && <div className="pb-media-caption bidi">{block.caption}</div>}
        </div>
      ) : (
        <div className="pb-media is-empty">
          <Icon name="image" size={20} />
          <span>Add an image, GIF or short video</span>
        </div>
      );
    case "frame":
      return <FrameView block={block} />;
    case "fields":
      return (
        <div className="pb-section">
          {block.title && <div className="pb-label"><span className="bidi">{block.title}</span></div>}
          <dl className="pb-fields">
            {block.fields.map((f, i) => (
              <div key={i} className="pb-field">
                <dt className="bidi">{f.key}</dt>
                <dd className="bidi">{f.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      );
    case "links":
      return (
        <div className="pb-section">
          {block.title && <div className="pb-label"><span className="bidi">{block.title}</span></div>}
          <div className="pb-links">
            {block.links.map((l, i) => (
              <button
                key={i}
                className="pb-link"
                onClick={(e) => {
                  e.stopPropagation();
                  open(l.url);
                }}
              >
                {l.icon ? <RefIcon value={l.icon} size={20} /> : <Icon name="link" size={14} />}
                <span className="bidi">{l.title}</span>
                <Icon name="external" size={12} />
              </button>
            ))}
          </div>
        </div>
      );
    case "badges":
      return (
        <div className="pb-section">
          {block.title && <div className="pb-label"><span className="bidi">{block.title}</span></div>}
          <div className="pb-badges">
            {block.badges.map((b, i) => (
              <span key={i} className="pb-badge-item" data-tip={b.subtitle}>
                <RefIcon value={b.icon} size={28} />
                <span className="bidi">{b.title}</span>
              </span>
            ))}
          </div>
        </div>
      );
    case "dynamic":
      return <Dynamic block={block} live={live} />;
  }
}
