import { useLayoutEffect, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, errorMessage, fileUrl } from "../lib/api";
import type { PageMeta } from "../lib/types";
import { useStore } from "../state/store";
import { Glass } from "../glass/Glass";
import { LAYER } from "../glass/materials";
import { Icon } from "../ui/Icon";
import { SmartImage } from "../ui/SmartImage";
import { bannerHeight, cropStyle, effectiveCrop, formatCrop, useImageInfo } from "../media/crop";
import { CropEditor } from "../media/CropEditor";

const toast = (e: unknown) => useStore.getState().toast({ message: errorMessage(e), tone: "error" });

export async function pickCover(page: PageMeta) {
  const path = await openDialog({ multiple: false, title: "Choose a cover", filters: [{ name: "Images", extensions: ["gif", "png", "jpg", "jpeg", "webp", "avif"] }] });
  if (!path || Array.isArray(path)) return;
  try {
    const a = await api.importFile(page.id, path);
    const meta = await api.updatePage(page.id, { cover: a.id });
    useStore.getState().patchPageLocal(meta);
  } catch (e) {
    toast(e);
  }
}

/**
 * A page cover with the same engine as the profile banner: height from the
 * picture's proportions, automatic focus, and an Adjust sheet for the area.
 */
export function PageCover({ page }: { page: PageMeta }) {
  const src = page.cover ? fileUrl(page.cover) : null;
  const info = useImageInfo(src);
  const el = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [adjust, setAdjust] = useState(false);
  useLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    const ro = new ResizeObserver(() => setW(node.offsetWidth));
    ro.observe(node);
    setW(node.offsetWidth);
    return () => ro.disconnect();
  }, [src]);
  if (!src) return null;
  // Covers are calmer than the profile banner: at most about a third of the window.
  const h = Math.min(bannerHeight(w || 900, window.innerHeight * 0.8, info), 360);
  const crop = effectiveCrop(page.look?.coverCrop, info);

  const saveLook = async (coverCrop: string | null) => {
    try {
      const look = { ...(page.look ?? {}) } as Record<string, unknown>;
      if (coverCrop) look.coverCrop = coverCrop;
      else delete look.coverCrop;
      useStore.getState().patchPageLocal(await api.setPageMeta(page.id, "look", look));
    } catch (e) {
      toast(e);
    }
  };

  return (
    <div className="page-cover-wrap" style={{ height: h }}>
      <div className="page-cover" ref={el} style={{ height: h }}>
        <SmartImage src={src} animated alt="" className="page-cover-img" style={cropStyle(crop)} />
      </div>
      {/* Outside the fading mask, in the corner nothing overlaps, so it never vanishes under the pointer. */}
      <Glass className="page-cover-actions" contentClassName="page-cover-actions-row" material="control" layer={LAYER.chrome} radius="var(--r-capsule)">
        <button onClick={() => pickCover(page)}>
          <Icon name="image" size={13} />
          Change
        </button>
        <button onClick={() => setAdjust(true)}>
          <Icon name="sliders" size={13} />
          Adjust
        </button>
        <button
          onClick={async () => {
            try {
              useStore.getState().patchPageLocal(await api.updatePage(page.id, { cover: null }));
            } catch (e) {
              toast(e);
            }
          }}
        >
          <Icon name="close" size={13} />
          Remove
        </button>
      </Glass>
      {adjust && (
        <CropEditor
          title="Cover area"
          src={src}
          aspect={(w || 900) / h}
          value={crop}
          onClose={() => setAdjust(false)}
          onReplace={() => {
            setAdjust(false);
            pickCover(page);
          }}
          onSave={async (c) => {
            await saveLook(c ? formatCrop(c) : null);
            setAdjust(false);
          }}
        />
      )}
    </div>
  );
}
