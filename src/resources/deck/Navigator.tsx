import { useState } from "react";
import { menuAt } from "../../ui/Menu";
import { Icon } from "../../ui/Icon";
import { LAYOUTS, type LayoutId, type Slide } from "./model";
import { SlideRender } from "./SlideRender";

const THUMB = 0.15;

/** The slide list: thumbnails, drag to reorder, and per-slide actions. */
export function Navigator({
  slides,
  current,
  onPick,
  onMove,
  onAdd,
  onDuplicate,
  onDelete,
}: {
  slides: Slide[];
  current: number;
  onPick: (i: number) => void;
  onMove: (from: number, to: number) => void;
  onAdd: (after: number, layout: LayoutId) => void;
  onDuplicate: (i: number) => void;
  onDelete: (i: number) => void;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const addMenu = (el: HTMLElement, after: number) => menuAt(el, LAYOUTS.map((l) => ({ label: l.label, onSelect: () => onAdd(after, l.id) })));
  return (
    <nav className="dk-nav" aria-label="Slides">
      {slides.map((s, i) => (
        <div
          key={s.bid}
          className={`dk-thumb-row ${over === i && drag !== null && drag !== i ? "is-over" : ""}`}
          draggable
          onDragStart={(e) => {
            setDrag(i);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(e) => {
            if (drag === null) return;
            e.preventDefault();
            setOver(i);
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (drag !== null) onMove(drag, i);
            setDrag(null);
            setOver(null);
          }}
          onDragEnd={() => {
            setDrag(null);
            setOver(null);
          }}
        >
          <span className="dk-num">{i + 1}</span>
          <button
            className={`dk-thumb ${i === current ? "is-current" : ""}`}
            onClick={() => onPick(i)}
            onContextMenu={(e) => {
              e.preventDefault();
              menuAt(e.currentTarget, [
                { label: "New Slide After", icon: "add", submenu: LAYOUTS.map((l) => ({ label: l.label, onSelect: () => onAdd(i, l.id) })) },
                { label: "Duplicate", icon: "duplicate", onSelect: () => onDuplicate(i) },
                { kind: "separator" },
                { label: "Delete Slide", icon: "delete", danger: true, disabled: slides.length === 1, onSelect: () => onDelete(i) },
              ]);
            }}
            aria-label={`Slide ${i + 1}`}
          >
            <SlideRender slide={s} scale={THUMB} />
          </button>
        </div>
      ))}
      <button className="dk-add" onClick={(e) => addMenu(e.currentTarget, slides.length - 1)}>
        <Icon name="add" size={15} /> New slide
      </button>
    </nav>
  );
}
