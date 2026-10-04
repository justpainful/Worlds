import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { ProductIcon, type ProductIconName } from "../../ui/ProductIcon";
import { useEffect, useRef, useState } from "react";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, errorMessage, fileUrl } from "../../lib/api";
import { useStore } from "../../state/store";
import { Icon, type IconName } from "../../ui/Icon";
import { formatBytes } from "../../ui/misc";
import { SmartImage } from "../../ui/SmartImage";
import { FilePreview, canPreview } from "./FilePreview";
import { Glass } from "../../glass/Glass";
import { LAYER } from "../../glass/materials";

async function reveal(id: string) {
  try {
    await revealItemInDir(await api.attachmentPath(id));
  } catch (e) {
    useStore.getState().toast({ message: errorMessage(e), tone: "error" });
  }
}
async function openFile(id: string) {
  try {
    await openPath(await api.attachmentPath(id));
  } catch (e) {
    useStore.getState().toast({ message: errorMessage(e), tone: "error" });
  }
}

/** Drag the edge of media to resize it as a % of the text column. */
function useResize(update: (pct: number) => void) {
  return (e: React.PointerEvent, side: "left" | "right", frame: HTMLElement) => {
    e.preventDefault();
    e.stopPropagation();
    const column = frame.parentElement?.getBoundingClientRect().width ?? frame.getBoundingClientRect().width;
    const startW = frame.getBoundingClientRect().width;
    const startX = e.clientX;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) * (side === "right" ? 1 : -1) * 2;
      const pct = Math.round(Math.min(100, Math.max(20, ((startW + dx) / column) * 100)));
      update(pct);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
}

function MediaToolbar({ attrs, update, onDelete, extra }: { attrs: Record<string, unknown>; update: (a: Record<string, unknown>) => void; onDelete: () => void; extra?: React.ReactNode }) {
  const btn = (icon: IconName, label: string, active: boolean, fn: () => void) => (
    <button className={`mt-btn ${active ? "is-active" : ""}`} aria-label={label} data-tip={label} onMouseDown={(e) => e.preventDefault()} onClick={fn}>
      <Icon name={icon} size={15} />
    </button>
  );
  const display = attrs.display as number;
  return (
    <Glass material="dense" layer={LAYER.floating} className="media-toolbar" radius="var(--r-capsule)" contentEditable={false}>
      <div className="mt-row">
        {btn("alignLeft", "Align left", attrs.align === "left" && display !== 0, () => update({ align: "left", display: display === 0 ? 100 : display }))}
        {btn("alignCenter", "Center", attrs.align === "center" && display !== 0, () => update({ align: "center", display: display === 0 ? 100 : display }))}
        {btn("alignRight", "Align right", attrs.align === "right" && display !== 0, () => update({ align: "right", display: display === 0 ? 100 : display }))}
        <span className="mt-sep" />
        {[50, 75, 100].map((p) => (
          <button key={p} className={`mt-btn mt-text ${display === p ? "is-active" : ""}`} onMouseDown={(e) => e.preventDefault()} onClick={() => update({ display: p })}>
            {p}%
          </button>
        ))}
        {btn("expand", "Full width", display === 0, () => update({ display: 0 }))}
        <span className="mt-sep" />
        {extra}
        {btn("delete", "Delete", false, onDelete)}
      </div>
    </Glass>
  );
}

export function ImageView({ node, updateAttributes, selected, deleteNode, editor }: ReactNodeViewProps) {
  const a = node.attrs;
  const frame = useRef<HTMLDivElement>(null);
  const startResize = useResize((pct) => updateAttributes({ display: pct }));
  const [failed, setFailed] = useState(false);
  const display = a.display as number;
  const full = display === 0;
  const ratio = a.width && a.height ? `${a.width} / ${a.height}` : undefined;
  return (
    <NodeViewWrapper className={`media media-image align-${a.align} ${full ? "is-full" : ""} ${selected ? "is-selected" : ""}`} data-drag-handle>
      <figure className="media-figure" style={{ width: full ? undefined : `${display}%` }} ref={frame}>
        {failed || !a.attachmentId ? (
          <div className="media-missing">
            <Icon name="image" size={20} />
            <span>This image is no longer available.</span>
          </div>
        ) : (
          <div className="media-frame" style={{ aspectRatio: ratio }}>
            <SmartImage src={fileUrl(a.attachmentId)} animated={a.mime === "image/gif"} alt={a.caption || a.name} onError={() => setFailed(true)} />
          </div>
        )}
        {editor.isEditable && !full && (
          <>
            <span className="media-handle left" onPointerDown={(e) => frame.current && startResize(e, "left", frame.current)} contentEditable={false} />
            <span className="media-handle right" onPointerDown={(e) => frame.current && startResize(e, "right", frame.current)} contentEditable={false} />
          </>
        )}
        <Caption value={a.caption} onChange={(caption) => updateAttributes({ caption })} editable={editor.isEditable} />
      </figure>
      {selected && editor.isEditable && (
        <MediaToolbar
          attrs={a}
          update={updateAttributes}
          onDelete={deleteNode}
          extra={
            <>
              <button className="mt-btn" aria-label="Open" data-tip="Open" onClick={() => openFile(a.attachmentId)}><Icon name="openExternal" size={15} /></button>
              <button className="mt-btn" aria-label="Show in Explorer" data-tip="Show in Explorer" onClick={() => reveal(a.attachmentId)}><Icon name="folderOpen" size={15} /></button>
              <span className="mt-sep" />
            </>
          }
        />
      )}
    </NodeViewWrapper>
  );
}

function Caption({ value, onChange, editable }: { value: string; onChange: (v: string) => void; editable: boolean }) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => setV(value ?? ""), [value]);
  if (!editable && !value) return null;
  return (
    <figcaption contentEditable={false}>
      <input
        className="media-caption bidi"
        dir="auto"
        value={v}
        placeholder="Add a caption"
        readOnly={!editable}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== value && onChange(v)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    </figcaption>
  );
}

export function VideoView({ node, updateAttributes, selected, deleteNode, editor }: ReactNodeViewProps) {
  const a = node.attrs;
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const startResize = useResize((pct) => updateAttributes({ display: pct }));
  const display = a.display as number;
  const full = display === 0;
  const capturing = useRef(false);

  // Capture a poster frame once and store it as its own attachment.
  const onLoaded = async () => {
    const v = video.current;
    if (!v || a.poster || capturing.current || !editor.isEditable) return;
    capturing.current = true;
    try {
      const at = Math.min(0.8, (v.duration || 1) / 3);
      await new Promise<void>((res) => {
        const done = () => {
          v.removeEventListener("seeked", done);
          res();
        };
        v.addEventListener("seeked", done);
        v.currentTime = at;
      });
      const c = document.createElement("canvas");
      const scale = Math.min(1, 1280 / (v.videoWidth || 1280));
      c.width = Math.round((v.videoWidth || 1280) * scale);
      c.height = Math.round((v.videoHeight || 720) * scale);
      c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      const blob: Blob | null = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.86));
      if (blob) {
        const pageId = (editor.storage as unknown as { worlds?: { pageId?: string } }).worlds?.pageId ?? null;
        const att = await api.importBytes(pageId, `${(a.name || "video").replace(/\.[^.]+$/, "")}-poster.jpg`, new Uint8Array(await blob.arrayBuffer()));
        updateAttributes({ poster: att.id, width: v.videoWidth, height: v.videoHeight });
      }
      v.currentTime = 0;
    } catch {
      /* poster is a nicety */
    }
  };

  return (
    <NodeViewWrapper className={`media media-video align-${a.align} ${full ? "is-full" : ""} ${selected ? "is-selected" : ""}`} data-drag-handle>
      <figure className="media-figure" style={{ width: full ? undefined : `${display}%` }} ref={frame}>
        <div className="media-frame" style={{ aspectRatio: a.width && a.height ? `${a.width} / ${a.height}` : "16 / 9" }} contentEditable={false}>
          <video
            ref={video}
            src={fileUrl(a.attachmentId)}
            poster={a.poster ? fileUrl(a.poster) : undefined}
            controls
            preload="metadata"
            crossOrigin="anonymous"
            onLoadedData={onLoaded}
          />
        </div>
        {editor.isEditable && !full && (
          <>
            <span className="media-handle left" onPointerDown={(e) => frame.current && startResize(e, "left", frame.current)} contentEditable={false} />
            <span className="media-handle right" onPointerDown={(e) => frame.current && startResize(e, "right", frame.current)} contentEditable={false} />
          </>
        )}
        <Caption value={a.caption} onChange={(caption) => updateAttributes({ caption })} editable={editor.isEditable} />
      </figure>
      {selected && editor.isEditable && <MediaToolbar attrs={a} update={updateAttributes} onDelete={deleteNode} />}
    </NodeViewWrapper>
  );
}

/** File types as miniature product renders (the Apple-style icon set). */
function fileProduct(mime: string, name: string): ProductIconName {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (/\.pdf$/i.test(name) || mime === "application/pdf") return "pdf";
  if (/\.(zip|rar|7z|tar|gz)$/i.test(name)) return "archive";
  if (/\.(pptx?|ppsx?|key|odp)$/i.test(name)) return "presentation";
  if (/\.(xlsx?|xlsm|ods|csv|tsv)$/i.test(name)) return "spreadsheet";
  if (/\.(docx?|rtf|odt|txt|md)$/i.test(name)) return "document";
  if (/\.(js|ts|tsx|py|rs|json|cs|lua|sql|html|css)$/i.test(name)) return "code";
  return "file";
}

export function fileIcon(mime: string, name: string): IconName {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (/\.(zip|rar|7z)$/i.test(name)) return "storage";
  if (/\.(pptx?|ppsx?|key|odp)$/i.test(name)) return "play";
  if (/\.(xlsx?|xlsm|ods|csv|tsv)$/i.test(name)) return "table";
  if (/\.(docx?|rtf|odt|pdf)$/i.test(name)) return "page";
  if (mime.startsWith("audio/")) return "play";
  if (/\.(js|ts|py|rs|json|cs|lua|sql)$/i.test(name)) return "code";
  return "file";
}

export function FileView({ node, selected, updateAttributes, editor }: ReactNodeViewProps) {
  const a = node.attrs;
  const ext = (a.name.split(".").pop() || "").toUpperCase();
  const previewable = !!a.attachmentId && canPreview(a.name || "", a.mime || "");
  const showing = previewable && a.preview !== false;
  return (
    <NodeViewWrapper className={`file-block ${showing ? "has-preview" : ""} ${selected ? "is-selected" : ""}`} data-drag-handle contentEditable={false}>
      <div className="file-card">
        <span className="file-icon">
          <ProductIcon name={fileProduct(a.mime || "", a.name || "")} size={36} />
        </span>
        <span className="file-main">
          <span className="file-name isolate" dir="auto">{a.name || "File"}</span>
          <span className="file-meta">
            {ext && <span>{ext}</span>}
            {a.size ? <span>{formatBytes(a.size)}</span> : null}
          </span>
        </span>
        <span className="file-actions">
          {previewable && editor.isEditable && (
            <button className="chip-btn" onClick={() => updateAttributes({ preview: !showing })}>
              <Icon name={showing ? "chevronDown" : "preview"} size={13} />
              {showing ? "Hide preview" : "Preview"}
            </button>
          )}
          <button className="chip-btn" onClick={() => openFile(a.attachmentId)} data-tip="Open in its own app">
            <Icon name="openExternal" size={13} />
          </button>
          <button className="chip-btn" onClick={() => reveal(a.attachmentId)} data-tip="Show in Explorer">
            <Icon name="folderOpen" size={13} />
          </button>
        </span>
      </div>
      {showing && (
        <div className="file-preview">
          <FilePreview attachmentId={a.attachmentId} name={a.name || ""} />
        </div>
      )}
    </NodeViewWrapper>
  );
}
