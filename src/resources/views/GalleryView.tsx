import { useEffect, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { api, errorMessage, fileUrl, isTauri } from "../../lib/api";
import type { Attachment } from "../../lib/types";
import { useStore } from "../../state/store";
import { Button, IconButton } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { menuAt } from "../../ui/Menu";
import { EmptyState, formatBytes, Spinner } from "../../ui/misc";
import { Segmented } from "../../ui/Segmented";
import { openLightbox } from "../../editor/views/Pages3Views";
import { useThumb } from "../../media/thumbs";
import { ResourceHeader, saveMeta, useResource } from "./ResourceHeader";

export interface GalleryItem {
  bid: string;
  attachmentId: string;
  name: string;
  mime: string;
  size: number;
  kind: string;
  caption: string;
}

const MEDIA = ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg", "heic", "mp4", "webm", "mov", "m4v", "mkv", "mp3", "wav", "m4a", "ogg", "flac"];
const newBid = () => Array.from(crypto.getRandomValues(new Uint8Array(13)), (b) => b.toString(16).padStart(2, "0")).join("");

function toItem(a: Attachment): GalleryItem {
  return { bid: newBid(), attachmentId: a.id, name: a.fileName, mime: a.mime, size: a.size, kind: a.kind, caption: "" };
}

/** A gallery is its own resource: an ordered set of pictures, videos and GIFs. */
export function GalleryView({ id }: { id: string }) {
  const meta = useStore((s) => s.pages[id]);
  const { page, error } = useResource(id);
  const [items, setItems] = useState<GalleryItem[] | null>(null);
  const [adding, setAdding] = useState(0);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const syncedAt = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const toast = useStore((s) => s.toast);

  useEffect(() => {
    if (!page) return;
    syncedAt.current = page.updatedAt;
    setItems(page.blocks.filter((b) => b.content.type === "galleryItem").map((b) => ({ ...(b.content.attrs as GalleryItem), bid: b.id })));
  }, [page]);

  /** Persist the whole ordered list (refused if someone else changed the gallery first). */
  const persist = async (next: GalleryItem[]) => {
    setItems(next);
    try {
      const res = await api.saveBlocks(
        id,
        next.map((it) => ({ id: it.bid, content: { type: "galleryItem", attrs: { ...it } } })),
        syncedAt.current,
      );
      syncedAt.current = res.updatedAt;
      const s = useStore.getState();
      const m = s.pages[id];
      if (m) s.patchPageLocal({ ...m, updatedAt: res.updatedAt });
    } catch (e) {
      const message = errorMessage(e);
      if (message.startsWith("conflict")) {
        // Changed elsewhere (Claude, another window): take the stored order, then reapply nothing blindly.
        const fresh = await api.page(id);
        if (fresh) {
          syncedAt.current = fresh.updatedAt;
          setItems(fresh.blocks.filter((b) => b.content.type === "galleryItem").map((b) => ({ ...(b.content.attrs as GalleryItem), bid: b.id })));
        }
        toast({ message: "The gallery changed elsewhere and was reloaded. Please try again.", tone: "info" });
      } else toast({ message: `Could not save the gallery: ${message}`, tone: "error" });
    }
  };

  const addPaths = async (paths: string[]) => {
    const media = paths.filter((p) => MEDIA.includes(p.split(".").pop()?.toLowerCase() ?? ""));
    if (media.length < paths.length) toast({ message: "Only pictures, videos and audio go into a gallery.", tone: "info" });
    if (!media.length || !items) return;
    setAdding((n) => n + media.length);
    const added: GalleryItem[] = [];
    for (const p of media) {
      try {
        added.push(toItem(await api.importFile(id, p)));
      } catch (e) {
        toast({ message: errorMessage(e), tone: "error" });
      } finally {
        setAdding((n) => n - 1);
      }
    }
    if (added.length) await persist([...(items ?? []), ...added]);
  };

  const pick = async () => {
    const picked = await openDialog({ multiple: true, title: "Add to gallery", filters: [{ name: "Media", extensions: MEDIA }] });
    if (picked) addPaths(Array.isArray(picked) ? picked : [picked]);
  };

  // Files dropped from Explorer onto the gallery.
  useEffect(() => {
    if (!isTauri) return;
    const un = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type !== "drop" || !root.current) return;
      const dpr = window.devicePixelRatio || 1;
      const el = document.elementFromPoint(e.payload.position.x / dpr, e.payload.position.y / dpr);
      if (el && root.current.contains(el)) addPaths(e.payload.paths);
    });
    return () => {
      un.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  if (error) return <EmptyState icon="warning" title="This gallery could not be opened" text={error} />;
  if (!page || !meta || !items) return <div className="page-loading"><Spinner /></div>;
  const view = ((page.metadata as { gallery?: { view?: string } }).gallery?.view ?? "grid") as "grid" | "list";
  const setView = async (v: string) => {
    await saveMeta(id, "gallery", { ...((page.metadata as { gallery?: object }).gallery ?? {}), view: v });
  };
  const show = (i: number) =>
    openLightbox(
      items.filter((it) => !it.mime.startsWith("audio/")).map((it) => ({ attachmentId: it.attachmentId, name: it.name })),
      Math.max(0, items.filter((it) => !it.mime.startsWith("audio/")).findIndex((it) => it.bid === items[i].bid)),
    );
  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = [...items];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    persist(next);
  };
  const itemMenu = (el: HTMLElement, i: number) =>
    menuAt(el, [
      { label: "View", icon: "expand", onSelect: () => show(i) },
      {
        label: "Use as Gallery Icon",
        icon: "image",
        disabled: !items[i].mime.startsWith("image/"),
        onSelect: async () => useStore.getState().patchPageLocal(await api.updatePage(id, { icon: `img:${items[i].attachmentId}` })),
      },
      { label: "Move to Start", icon: "arrowLeft", disabled: i === 0, onSelect: () => move(i, 0) },
      { label: "Move to End", icon: "arrowRight", disabled: i === items.length - 1, onSelect: () => move(i, items.length - 1) },
      { kind: "separator" },
      { label: "Remove from Gallery", icon: "delete", danger: true, onSelect: () => persist(items.filter((_, k) => k !== i)) },
    ]);

  return (
    <div className="res-view res-gallery" ref={root}>
      <ResourceHeader
        meta={meta}
        subtitle={<span>{items.length} item{items.length === 1 ? "" : "s"}</span>}
        actions={
          <>
            <Segmented value={view} onChange={setView} label="Layout" options={[{ value: "grid", label: "Grid" }, { value: "list", label: "List" }]} />
            <Button variant="tinted" icon="add" onClick={pick}>Add</Button>
          </>
        }
      />
      {adding > 0 && (
        <div className="gal-adding">
          <Spinner size={13} /> Adding {adding} file{adding === 1 ? "" : "s"}
        </div>
      )}
      {items.length === 0 ? (
        <EmptyState icon="image" title="An empty gallery" text="Add pictures, videos or GIFs, or drop them here from Explorer." action={<Button variant="tinted" icon="add" onClick={pick}>Add media</Button>} />
      ) : (
        <div className={view === "grid" ? "gal-grid" : "gal-list"}>
          {items.map((it, i) => (
            <div
              key={it.bid}
              className={`gal-item ${dragFrom === i ? "is-dragging" : ""}`}
              draggable
              onDragStart={(e) => {
                setDragFrom(i);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => dragFrom !== null && e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom !== null) move(dragFrom, i);
                setDragFrom(null);
              }}
              onDragEnd={() => setDragFrom(null)}
            >
              <button className="gal-thumb" onClick={() => show(i)} aria-label={`View ${it.name}`}>
                <GalleryThumb item={it} />
                {it.mime.startsWith("video/") && <span className="gal-play"><Icon name="play" size={14} /></span>}
                {it.mime === "image/gif" && <span className="gal-badge">GIF</span>}
              </button>
              <div className="gal-meta">
                <span className="gal-name bidi">{it.name}</span>
                {view === "list" && <span className="gal-sub">{it.mime} · {formatBytes(it.size)}</span>}
              </div>
              <IconButton icon="more" label="Item options" className="gal-more" onClick={(e) => itemMenu(e.currentTarget, i)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GalleryThumb({ item }: { item: GalleryItem }) {
  const ref = useRef<HTMLDivElement>(null);
  const isImage = item.mime.startsWith("image/");
  const thumb = useThumb(isImage ? fileUrl(item.attachmentId) : null, 520, ref);
  if (item.mime.startsWith("video/")) {
    return (
      <div ref={ref} className="gal-media">
        <video src={`${fileUrl(item.attachmentId)}#t=0.5`} preload="metadata" muted playsInline />
      </div>
    );
  }
  if (item.mime.startsWith("audio/")) {
    return (
      <div ref={ref} className="gal-media is-audio">
        <Icon name="mic" size={26} />
      </div>
    );
  }
  return <div ref={ref} className="gal-media">{thumb ? <img src={thumb} alt="" draggable={false} /> : null}</div>;
}
