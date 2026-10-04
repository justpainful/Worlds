import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { analyzeImage, cropStyle, NO_CROP, type Crop } from "./crop";

/**
 * Choose the visible area of a banner, cover or avatar: drag to move, wheel or
 * slider to zoom, Smart for the automatic focus. What you see in the frame is
 * exactly what the page shows, at the frame's real proportions.
 */
export function CropEditor({
  src,
  title,
  aspect,
  round,
  value,
  onSave,
  onClose,
  onReplace,
}: {
  src: string;
  title: string;
  /** Frame width / height. */
  aspect: number;
  round?: boolean;
  value: Crop;
  onSave: (c: Crop | null) => void;
  onClose: () => void;
  onReplace?: () => void;
}) {
  const [crop, setCrop] = useState<Crop>(value);
  const [dragging, setDragging] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; crop: Crop } | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    analyzeImage(src).then((i) => setNatural({ w: i.width, h: i.height }));
  }, [src]);

  // How far the picture can travel inside the frame, per axis, at this zoom.
  const travel = () => {
    const el = frame.current;
    if (!el || !natural?.w) return { x: 1, y: 1 };
    const fw = el.clientWidth, fh = el.clientHeight;
    const s = Math.max(fw / natural.w, fh / natural.h);
    const iw = natural.w * s * crop.zoom, ih = natural.h * s * crop.zoom;
    return { x: Math.max(1, iw - fw), y: Math.max(1, ih - fh) };
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY, crop };
    setDragging(true);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s) return;
    const t = travel();
    const nx = s.crop.x - ((e.clientX - s.x) / t.x) * 100;
    const ny = s.crop.y - ((e.clientY - s.y) / t.y) * 100;
    setCrop({ ...s.crop, x: Math.max(0, Math.min(100, nx)), y: Math.max(0, Math.min(100, ny)) });
  };
  const onUp = () => {
    start.current = null;
    setDragging(false);
  };
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    const z = Math.max(1, Math.min(4, crop.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
    setCrop({ ...crop, zoom: z });
  };
  const nudge = (dx: number, dy: number) => setCrop((c) => ({ ...c, x: Math.max(0, Math.min(100, c.x + dx)), y: Math.max(0, Math.min(100, c.y + dy)) }));

  return (
    <Modal
      title={title}
      onClose={onClose}
      width={round ? 460 : 720}
      className="crop-sheet"
      footer={
        <>
          <Button variant="quiet" onClick={() => onSave(null)}>
            Automatic
          </Button>
          <span className="grow" />
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="tinted" icon="check" onClick={() => onSave(crop)}>
            Save
          </Button>
        </>
      }
    >
      <div className="crop-stage">
        <div
          ref={frame}
          className={`crop-frame ${round ? "is-round" : ""} ${dragging ? "is-dragging" : ""}`}
          style={{ aspectRatio: String(aspect) }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onWheel={onWheel}
          tabIndex={0}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 5 : 1;
            if (e.key === "ArrowLeft") nudge(-step, 0);
            else if (e.key === "ArrowRight") nudge(step, 0);
            else if (e.key === "ArrowUp") nudge(0, -step);
            else if (e.key === "ArrowDown") nudge(0, step);
            else return;
            e.preventDefault();
          }}
          aria-label="Drag to choose the visible area"
        >
          <img src={src} alt="" draggable={false} style={cropStyle(crop)} />
          <span className="crop-grid" aria-hidden />
        </div>
      </div>
      <div className="crop-controls">
        <Icon name="image" size={13} />
        <input
          type="range"
          min={1}
          max={4}
          step={0.01}
          value={crop.zoom}
          onChange={(e) => setCrop({ ...crop, zoom: Number(e.target.value) })}
          aria-label="Zoom"
          className="crop-zoom"
        />
        <Icon name="image" size={18} />
        <span className="grow" />
        <button
          className="chip-btn"
          onClick={async () => {
            const i = await analyzeImage(src);
            setCrop({ x: i.focus.x, y: i.focus.y, zoom: 1 });
          }}
        >
          <Icon name="assistant" size={13} />
          Smart
        </button>
        <button className="chip-btn" onClick={() => setCrop(NO_CROP)}>
          <Icon name="restore" size={13} />
          Center
        </button>
        {onReplace && (
          <button className="chip-btn" onClick={onReplace}>
            <Icon name="upload" size={13} />
            Replace
          </button>
        )}
      </div>
      <p className="crop-hint">Drag to move. Scroll or use the slider to zoom. Arrow keys nudge. Automatic lets Worlds pick the area for you.</p>
    </Modal>
  );
}
