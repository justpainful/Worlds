import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, errorMessage, fileUrl } from "../../lib/api";
import { useStore } from "../../state/store";
import { Icon } from "../../ui/Icon";
import { menuAt } from "../../ui/Menu";
import { Glass } from "../../glass/Glass";
import { LAYER } from "../../glass/materials";

// ---------------------------------------------------------------------------
// Table of contents
// ---------------------------------------------------------------------------

export function TocView({ editor, selected }: ReactNodeViewProps) {
  const [heads, setHeads] = useState<{ pos: number; level: number; text: string }[]>([]);
  useEffect(() => {
    const read = () => {
      const out: { pos: number; level: number; text: string }[] = [];
      editor.state.doc.descendants((n, pos) => {
        if (n.type.name === "heading" && n.textContent.trim()) out.push({ pos, level: n.attrs.level as number, text: n.textContent.trim() });
        return n.type.name !== "heading";
      });
      setHeads(out);
    };
    read();
    editor.on("update", read);
    return () => {
      editor.off("update", read);
    };
  }, [editor]);
  return (
    <NodeViewWrapper className={`toc-block ${selected ? "is-selected" : ""}`} contentEditable={false} data-drag-handle>
      <div className="toc-title">Contents</div>
      {heads.length === 0 ? (
        <div className="toc-empty">Headings you add appear here.</div>
      ) : (
        heads.map((h, i) => (
          <button
            key={`${h.pos}-${i}`}
            className={`toc-item lvl-${h.level}`}
            dir="auto"
            onClick={() => (editor.view.nodeDOM(h.pos) as HTMLElement | null)?.scrollIntoView({ behavior: "smooth", block: "start" })}
          >
            {h.text}
          </button>
        ))
      )}
    </NodeViewWrapper>
  );
}

// ---------------------------------------------------------------------------
// Gallery + full-screen viewer
// ---------------------------------------------------------------------------

type Img = { attachmentId: string; name: string; src?: string };

export function openLightbox(images: Img[], index: number) {
  window.dispatchEvent(new CustomEvent("worlds:lightbox", { detail: { images, index } }));
}

export function GalleryView({ node, updateAttributes, editor, selected }: ReactNodeViewProps) {
  const images = (node.attrs.images as Img[]) ?? [];
  const cols = node.attrs.columns as number;
  const aspect = node.attrs.aspect as string;
  const pageId = (editor.storage as unknown as { worlds?: { pageId: string } }).worlds?.pageId ?? null;

  const add = async () => {
    const picked = await openDialog({ multiple: true, title: "Add pictures", filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif"] }] });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    const added: Img[] = [];
    for (const p of paths) {
      try {
        const a = await api.importFile(pageId, p);
        added.push({ attachmentId: a.id, name: a.fileName });
      } catch (e) {
        useStore.getState().toast({ message: errorMessage(e), tone: "error" });
      }
    }
    updateAttributes({ images: [...images, ...added].slice(0, 60) });
  };

  const options = (el: HTMLElement) =>
    menuAt(el, [
      { kind: "label", label: "Columns" },
      ...[2, 3, 4, 5].map((n) => ({ label: `${n} columns`, checked: cols === n, onSelect: () => updateAttributes({ columns: n }) })),
      { kind: "separator" },
      { kind: "label", label: "Shape" },
      ...[
        ["square", "Square"],
        ["landscape", "Landscape"],
        ["portrait", "Portrait"],
        ["natural", "Original shape"],
      ].map(([v, l]) => ({ label: l, checked: aspect === v, onSelect: () => updateAttributes({ aspect: v }) })),
    ]);

  return (
    <NodeViewWrapper className={`gallery-block ${selected ? "is-selected" : ""}`} contentEditable={false} data-drag-handle>
      {images.length === 0 ? (
        <button className="gallery-empty" onClick={add}>
          <Icon name="image" size={20} />
          <span>Add pictures to this gallery</span>
        </button>
      ) : (
        <div className={`gallery-grid aspect-${aspect}`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: node.attrs.gap }}>
          {images.map((im, i) => (
            <div key={im.attachmentId + i} className="gallery-cell" onClick={() => openLightbox(images, i)}>
              <img src={fileUrl(im.attachmentId)} alt={im.name} loading="lazy" draggable={false} />
              {editor.isEditable && (
                <button
                  className="gallery-x"
                  aria-label="Remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    updateAttributes({ images: images.filter((_, j) => j !== i) });
                  }}
                >
                  <Icon name="close" size={11} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {editor.isEditable && images.length > 0 && (
        <div className="gallery-bar">
          <button onClick={add}>
            <Icon name="add" size={13} />
            Add
          </button>
          <button onClick={(e) => options(e.currentTarget)}>
            <Icon name="grid" size={13} />
            Layout
          </button>
          <span className="gallery-count">{images.length} pictures</span>
        </div>
      )}
    </NodeViewWrapper>
  );
}

/** Mounted once: shows any list of pictures full screen, with arrows and Esc. */
export function LightboxHost() {
  const [state, setState] = useState<{ images: Img[]; index: number } | null>(null);
  useEffect(() => {
    const onOpen = (e: Event) => setState((e as CustomEvent).detail);
    window.addEventListener("worlds:lightbox", onOpen);
    return () => window.removeEventListener("worlds:lightbox", onOpen);
  }, []);
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setState(null);
      else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const d = e.key === "ArrowRight" ? 1 : -1;
        setState((s) => (s ? { ...s, index: (s.index + d + s.images.length) % s.images.length } : s));
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [state]);
  if (!state) return null;
  const im = state.images[state.index];
  const step = (d: number) => setState((s) => (s ? { ...s, index: (s.index + d + s.images.length) % s.images.length } : s));
  return createPortal(
    <div className="lightbox" onClick={() => setState(null)}>
      <img src={im.src ?? fileUrl(im.attachmentId)} alt={im.name} onClick={(e) => e.stopPropagation()} />
      <Glass className="lightbox-bar" contentClassName="lightbox-row" material="regular" layer={LAYER.modal} radius="var(--r-capsule)" onClick={(e) => e.stopPropagation()}>
        {state.images.length > 1 && (
          <button onClick={() => step(-1)} aria-label="Previous">
            <Icon name="back" size={16} />
          </button>
        )}
        <span className="lightbox-name bidi">{im.name}</span>
        <span className="lightbox-count">
          {state.index + 1} / {state.images.length}
        </span>
        {state.images.length > 1 && (
          <button onClick={() => step(1)} aria-label="Next">
            <Icon name="forward" size={16} />
          </button>
        )}
        <button onClick={() => setState(null)} aria-label="Close">
          <Icon name="close" size={15} />
        </button>
      </Glass>
    </div>,
    document.body,
  );
}
