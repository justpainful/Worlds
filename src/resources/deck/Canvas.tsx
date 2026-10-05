import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { snap, STAGE_H, STAGE_W, type Slide, type SlideElement } from "./model";
import { boxStyle, ElementBody, slideBackground, textStyle } from "./SlideRender";

type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const MIN = 16;

interface Gesture {
  kind: "move" | "resize";
  handle?: Handle;
  startX: number;
  startY: number;
  origin: Map<string, SlideElement>;
  moved: boolean;
}

/**
 * The editable slide. Coordinates are stage units (1280 x 720), scaled to fit.
 * Moves snap to the stage and to other elements with visible guides; resizes
 * work from eight handles (Shift keeps the proportions).
 */
export function Canvas({
  slide,
  scale,
  selected,
  onSelect,
  onChange,
  editingId,
  onEditing,
}: {
  slide: Slide;
  scale: number;
  selected: string[];
  onSelect: (ids: string[]) => void;
  /** `commit` is false while a gesture is in progress (no history entry yet). */
  onChange: (next: Slide, commit: boolean) => void;
  editingId: string | null;
  onEditing: (id: string | null) => void;
}) {
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const gesture = useRef<Gesture | null>(null);
  /** Text when editing began: live typing updates the slide, finishing records one undo step. */
  const editStart = useRef<string | null>(null);
  const wasEditing = useRef<string | null>(null);
  useEffect(() => {
    // Editing ended without a blur (a click on the slide, switching slides):
    // still record what was typed as one step.
    const prev = wasEditing.current;
    if (prev && prev !== editingId && editStart.current !== null) {
      const now = latest.current.elements.find((e) => e.id === prev)?.text ?? "";
      if (now !== editStart.current) onChange(latest.current, true);
    }
    wasEditing.current = editingId;
    editStart.current = editingId ? (slide.elements.find((e) => e.id === editingId)?.text ?? "") : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);
  const latest = useRef(slide);
  latest.current = slide;

  const toStage = (e: { clientX: number; clientY: number }) => ({ x: e.clientX / scale, y: e.clientY / scale });

  const begin = (e: RPointerEvent, el: SlideElement, kind: "move" | "resize", handle?: Handle) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (editingId === el.id) return;
    let ids = selected;
    if (kind === "move") {
      if (e.shiftKey) ids = selected.includes(el.id) ? selected.filter((i) => i !== el.id) : [...selected, el.id];
      else if (!selected.includes(el.id)) ids = [el.id];
      onSelect(ids);
    }
    const p = toStage(e);
    gesture.current = {
      kind,
      handle,
      startX: p.x,
      startY: p.y,
      origin: new Map(slide.elements.filter((x) => (kind === "move" ? ids.includes(x.id) : x.id === el.id)).map((x) => [x.id, { ...x }])),
      moved: false,
    };
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* no active pointer (synthetic events); the gesture still works without capture */
    }
  };

  const move = (e: RPointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const p = toStage(e);
    let dx = p.x - g.startX;
    let dy = p.y - g.startY;
    if (!g.moved && Math.hypot(dx, dy) < 2) return;
    g.moved = true;
    const cur = latest.current;
    let next: SlideElement[];
    if (g.kind === "move") {
      // Snap the selection's bounding box (single element or group).
      const boxes = [...g.origin.values()];
      const bx = Math.min(...boxes.map((b) => b.x));
      const by = Math.min(...boxes.map((b) => b.y));
      const bw = Math.max(...boxes.map((b) => b.x + b.w)) - bx;
      const bh = Math.max(...boxes.map((b) => b.y + b.h)) - by;
      if (!e.altKey) {
        const others = cur.elements.filter((x) => !g.origin.has(x.id));
        const s = snap({ x: bx + dx, y: by + dy, w: bw, h: bh }, others, 7);
        dx = s.x - bx;
        dy = s.y - by;
        setGuides(s.guides);
      } else setGuides({ v: [], h: [] });
      next = cur.elements.map((x) => {
        const o = g.origin.get(x.id);
        return o ? { ...x, x: Math.round(o.x + dx), y: Math.round(o.y + dy) } : x;
      });
    } else {
      const [o] = [...g.origin.values()];
      const h = g.handle!;
      let { x, y, w, h: hh } = o;
      if (h.includes("e")) w = Math.max(MIN, o.w + dx);
      if (h.includes("s")) hh = Math.max(MIN, o.h + dy);
      if (h.includes("w")) {
        w = Math.max(MIN, o.w - dx);
        x = o.x + (o.w - w);
      }
      if (h.includes("n")) {
        hh = Math.max(MIN, o.h - dy);
        y = o.y + (o.h - hh);
      }
      if (e.shiftKey && o.w > 0 && o.h > 0) {
        const ratio = o.w / o.h;
        if (h === "n" || h === "s") w = hh * ratio;
        else hh = w / ratio;
        if (h.includes("w")) x = o.x + (o.w - w);
        if (h.includes("n")) y = o.y + (o.h - hh);
      }
      next = cur.elements.map((el) => (el.id === o.id ? { ...el, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(hh) } : el));
    }
    // Keep the newest state here too: a release in the same frame commits it, not the stale prop.
    latest.current = { ...cur, elements: next };
    onChange(latest.current, false);
  };

  const end = () => {
    const g = gesture.current;
    gesture.current = null;
    setGuides({ v: [], h: [] });
    if (g?.moved) onChange(latest.current, true);
  };

  const single = selected.length === 1 ? slide.elements.find((e) => e.id === selected[0]) : undefined;

  return (
    <div className="dk-canvas" style={{ width: STAGE_W * scale, height: STAGE_H * scale }}>
      <div
        className="sl-stage dk-stage"
        style={{ width: STAGE_W, height: STAGE_H, scale: String(scale), background: slideBackground(slide) }}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) {
            onSelect([]);
            onEditing(null);
          }
        }}
      >
        {slide.elements.map((el) => (
          <div
            key={el.id}
            className={`sl-el sl-${el.type} dk-el ${selected.includes(el.id) ? "is-selected" : ""} ${editingId === el.id ? "is-editing" : ""}`}
            style={boxStyle(el)}
            onPointerDown={(e) => begin(e, el, "move")}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onDoubleClick={() => el.type === "text" && onEditing(el.id)}
          >
            <ElementBody el={el} showHints editing={editingId === el.id}>
              <TextEditor
                el={el}
                onInput={(text) => onChange({ ...latest.current, elements: latest.current.elements.map((x) => (x.id === el.id ? { ...x, text } : x)) }, false)}
                onDone={(text) => {
                  const before = editStart.current ?? "";
                  // Handled here; the editing-ended effect must not record it again.
                  editStart.current = null;
                  onEditing(null);
                  if (text !== before) onChange({ ...latest.current, elements: latest.current.elements.map((x) => (x.id === el.id ? { ...x, text } : x)) }, true);
                }}
              />
            </ElementBody>
          </div>
        ))}
        {single && editingId !== single.id && (
          <div className="dk-handles" style={boxStyle(single)}>
            {HANDLES.map((h) => (
              <span
                key={h}
                className={`dk-handle is-${h}`}
                style={{ scale: String(1 / scale) }}
                onPointerDown={(e) => begin(e, single, "resize", h)}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={end}
              />
            ))}
          </div>
        )}
        {guides.v.map((v) => (
          <span key={`v${v}`} className="dk-guide is-v" style={{ left: v, width: 1 / scale }} />
        ))}
        {guides.h.map((h) => (
          <span key={`h${h}`} className="dk-guide is-h" style={{ top: h, height: 1 / scale }} />
        ))}
      </div>
    </div>
  );
}

/** Plain-text editing in place; Escape or clicking away finishes. */
function TextEditor({ el, onInput, onDone }: { el: SlideElement; onInput: (text: string) => void; onDone: (text: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.innerText = el.text ?? "";
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      ref={ref}
      className="sl-text dk-text-edit"
      style={textStyle(el)}
      dir="auto"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") ref.current?.blur();
      }}
      onInput={() => onInput(ref.current?.innerText.replace(/\n$/, "") ?? "")}
      onBlur={() => onDone(ref.current?.innerText.replace(/\n$/, "") ?? "")}
    />
  );
}
