import { useEffect, useMemo, useRef, useState } from "react";
import { openExternal } from "../../lib/links";
import { api, fileUrl } from "../../lib/api";
import type { Attachment, Profile } from "../../lib/types";
import { useStore, pageTitle } from "../../state/store";
import { Icon } from "../../ui/Icon";
import { EmptyState, PageIcon, relTime } from "../../ui/misc";
import { type ProfileStats } from "../../profile/BlockView";
import { useThumb } from "../../media/thumbs";
import { hostOf, useClock, fmt } from "./shared";

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export function PagesTab() {
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

export function MediaTile({ a, onOpen }: { a: Attachment; onOpen: () => void }) {
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

export function MediaTab() {
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

export function AboutTab({ profile, memberSince, stats, onEdit }: { profile: Profile; memberSince: string; stats: ProfileStats | null; onEdit: () => void }) {
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
            <button className="about-link" onClick={() => openExternal(l.url)}>
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
