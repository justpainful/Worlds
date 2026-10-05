import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, errorMessage, fileUrl } from "../../lib/api";
import { openAttachment } from "../../lib/links";
import { pageTitle, useStore } from "../../state/store";
import { menuAt } from "../../ui/Menu";
import { createResource } from "../create";
import { Button } from "../../ui/Button";
import { EmptyState, formatBytes, Spinner } from "../../ui/misc";
import { canPreview, FilePreview } from "../../editor/views/FilePreview";
import { openLightbox } from "../../editor/views/Pages3Views";
import { ResourceHeader, useResource } from "./ResourceHeader";

interface FileMeta {
  attachmentId: string;
  name: string;
  mime: string;
  size: number;
  kind?: string;
}

/** Put this file's picture or video into a gallery (it stays a file too). */
function addToGallery(anchor: HTMLElement, f: FileMeta) {
  const s = useStore.getState();
  const galleries = Object.values(s.pages).filter((p) => p.kind === "gallery" && !p.deletedAt);
  const add = async (galleryId: string) => {
    try {
      const g = await api.page(galleryId);
      if (!g) return;
      const blocks = g.blocks.map((b) => ({ id: b.id, content: b.content }));
      const bid = Array.from(crypto.getRandomValues(new Uint8Array(13)), (b) => b.toString(16).padStart(2, "0")).join("");
      blocks.push({ id: bid, content: { type: "galleryItem", attrs: { bid, attachmentId: f.attachmentId, name: f.name, mime: f.mime, size: f.size, kind: f.kind ?? "image", caption: "" } } });
      await api.saveBlocks(galleryId, blocks, g.updatedAt);
      s.toast({ message: `Added to ${pageTitle(s.pages[galleryId])}`, tone: "success", action: { label: "Open", run: () => s.openPage(galleryId, "current") } });
    } catch (e) {
      s.toast({ message: errorMessage(e), tone: "error" });
    }
  };
  menuAt(anchor, [
    ...galleries.map((g) => ({ label: pageTitle(g), icon: "image" as const, onSelect: () => add(g.id) })),
    ...(galleries.length ? [{ kind: "separator" as const }] : []),
    {
      label: "New Gallery",
      icon: "add" as const,
      onSelect: async () => {
        const g = await createResource("gallery", { where: "current" });
        if (g) await add(g.id);
      },
    },
  ]);
}

/** A file kept in Worlds: the file itself, previewed in place, with its details. */
export function FileView({ id }: { id: string }) {
  const meta = useStore((s) => s.pages[id]);
  const { page, error } = useResource(id);
  if (error) return <EmptyState icon="warning" title="This file could not be opened" text={error} />;
  if (!page || !meta) return <div className="page-loading"><Spinner /></div>;
  const f = (page.metadata as { file?: FileMeta }).file;
  const isImage = !!f && f.mime.startsWith("image/");
  const isVideo = !!f && f.mime.startsWith("video/");
  const reveal = async () => {
    if (!f) return;
    try {
      await revealItemInDir(await api.attachmentPath(f.attachmentId));
    } catch (e) {
      useStore.getState().toast({ message: errorMessage(e), tone: "error" });
    }
  };
  return (
    <div className="res-view res-file">
      <ResourceHeader
        meta={meta}
        subtitle={f ? <span>{formatBytes(f.size)}</span> : null}
        actions={
          f && (
            <>
              {(isImage || isVideo) && (
                <Button variant="quiet" icon="image" onClick={(e) => addToGallery(e.currentTarget, f)}>Add to Gallery</Button>
              )}
              <Button variant="quiet" icon="folderOpen" onClick={reveal}>Show in Explorer</Button>
              <Button variant="plain" icon="openExternal" onClick={() => openAttachment(f.attachmentId)}>Open</Button>
            </>
          )
        }
      />
      {!f ? (
        <EmptyState icon="file" title="No file yet" text="This file is still being added, or its upload did not finish." />
      ) : isImage ? (
        <button className="res-file-stage is-image" onClick={() => openLightbox([{ attachmentId: f.attachmentId, name: f.name }], 0)}>
          <img src={fileUrl(f.attachmentId)} alt={f.name} />
        </button>
      ) : isVideo ? (
        <div className="res-file-stage is-video">
          <video src={fileUrl(f.attachmentId)} controls preload="metadata" />
        </div>
      ) : canPreview(f.name, f.mime) ? (
        <div className="res-file-stage is-doc">
          <FilePreview attachmentId={f.attachmentId} name={f.name} />
        </div>
      ) : (
        <EmptyState icon="file" title={f.name} text="Worlds cannot show this kind of file. Open it with its own app." />
      )}
      {f && (
        <dl className="res-facts">
          <dt>Name</dt>
          <dd className="bidi">{f.name}</dd>
          <dt>Type</dt>
          <dd>{f.mime}</dd>
          <dt>Size</dt>
          <dd>{formatBytes(f.size)}</dd>
          <dt>Added</dt>
          <dd>{new Date(meta.createdAt).toLocaleString()}</dd>
        </dl>
      )}
    </div>
  );
}
