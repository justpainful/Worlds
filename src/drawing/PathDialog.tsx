import { useEffect, useId, useRef, useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import type { DrawingNode, DrawingPath, Point } from "./model";
import type { DrawingGestureLease } from "./gestureLeases";
import { movePathVertex, pathBounds, pathFromNode, smoothPathVertex, splitPath, svgPath, validPath } from "./paths";
const sourceKey = (n: DrawingNode) =>
  JSON.stringify([
    n.id,
    n.path,
    n.points,
    n.shape,
    n.x,
    n.y,
    n.w,
    n.h,
    n.geometrySize,
    n.rotation,
    n.flipX,
    n.flipY,
    n.locked,
    n.layerId,
    n.frameId,
  ]);
export function PathDialog(p: {
  node: DrawingNode;
  canEdit: boolean;
  arabic: boolean;
  begin: () => Promise<DrawingGestureLease | null>;
  onApply: (path: DrawingPath) => string[] | Promise<string[]>;
  onClose: () => void;
}) {
  const t = (en: string, ar: string) => (p.arabic ? ar : en),
    [original] = useState(() => sourceKey(p.node)),
    [path, setPath] = useState(() => pathFromNode(p.node)),
    [index, setIndex] = useState(0),
    [view, setView] = useState(() => pathBounds(pathFromNode(p.node))),
    [waiting, setWaiting] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState<string | null>(null),
    [lost, setLost] = useState(false);
  const lease = useRef<DrawingGestureLease | null>(null),
    finished = useRef(false),
    svg = useRef<SVGSVGElement>(null),
    drag = useRef<{ index: number; pointer: number; before: DrawingPath; handle?: "in" | "out" } | null>(null),
    gradientId = `path-${useId().replace(/:/g, "")}`;
  useEffect(() => {
    let active = true,
      unsubscribe: (() => void) | undefined;
    void p.begin().then(
      (value) => {
        if (!active) {
          value?.cancel();
          return;
        }
        lease.current = value;
        const update = () => setLost(value?.state() === "lost");
        unsubscribe = value?.subscribe(update);
        update();
        setWaiting(false);
      },
      (e) => {
        if (active) {
          setWaiting(false);
          setError(String(e));
          setLost(true);
        }
      },
    );
    return () => {
      active = false;
      unsubscribe?.();
      if (!finished.current) lease.current?.cancel();
    };
  }, []);
  const enabled = p.canEdit && !waiting && !saving && !lost,
    v = path.vertices[index] ?? path.vertices[0],
    g = p.node.paint.gradient;
  const change = (point: Point, handle?: "in" | "out") => setPath((value) => movePathVertex(value, index, point, handle));
  const coordinate = (e: React.PointerEvent) => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return null;
    const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
    return { x: q.x, y: q.y };
  };
  const handle = (i: number, point: Point, key?: "in" | "out") => (
    <g key={`${i}-${key ?? "anchor"}`}>
      <circle
        role="button"
        tabIndex={enabled ? 0 : -1}
        aria-label={t(
          `Point ${i + 1} ${key ?? "anchor"}`,
          `النقطة ${i + 1} ${key === "in" ? "المقبض الداخل" : key === "out" ? "المقبض الخارج" : "المرساة"}`,
        )}
        aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
        cx={point.x}
        cy={point.y}
        r={3}
        fill="transparent"
        stroke="transparent"
        strokeWidth={28}
        vectorEffect="non-scaling-stroke"
        onPointerDown={(e) => {
          if (!enabled || e.button !== 0 || drag.current) return;
          e.preventDefault();
          e.currentTarget.focus();
          setIndex(i);
          drag.current = { index: i, pointer: e.pointerId, before: structuredClone(path), handle: key };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onKeyDown={(e) => {
          if (!enabled) return;
          const delta = e.shiftKey ? 10 : 1;
          if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
            e.preventDefault();
            e.stopPropagation();
            setIndex(i);
            setPath((value) =>
              movePathVertex(
                value,
                i,
                {
                  x: point.x + (e.key === "ArrowLeft" ? -delta : e.key === "ArrowRight" ? delta : 0),
                  y: point.y + (e.key === "ArrowUp" ? -delta : e.key === "ArrowDown" ? delta : 0),
                },
                key,
              ),
            );
          }
        }}
      />
      <circle
        cx={point.x}
        cy={point.y}
        r={4}
        fill={key ? "#ffffff" : i === index ? "#007aff" : "#ffffff"}
        stroke="#007aff"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
      />
    </g>
  );
  return (
    <Modal
      title={t("Edit path", "تعديل المسار")}
      width={860}
      className={`drawing-path-dialog${p.arabic ? " is-arabic" : ""}`}
      onClose={() => {
        if (!saving) p.onClose();
      }}
      footer={
        <>
          <Button disabled={saving} onClick={p.onClose}>
            {t("Cancel", "إلغاء")}
          </Button>
          <Button
            variant="tinted"
            disabled={!enabled || !validPath(path)}
            loading={saving}
            onClick={async () => {
              if (sourceKey(p.node) !== original) {
                setError(t("The source geometry changed. Cancel and reopen.", "تغيّر مسار المصدر. ألغِ المعاينة وافتحها مجددًا."));
                return;
              }
              setSaving(true);
              try {
                const operations = await p.onApply(path);
                if (!operations.length) throw Error(t("The path could not be saved", "تعذر حفظ المسار"));
                finished.current = true;
                lease.current?.finish(operations);
                p.onClose();
              } catch (e) {
                setError(String(e));
                setSaving(false);
              }
            }}
          >
            {t("Apply path", "تطبيق المسار")}
          </Button>
        </>
      }
    >
      <div dir={p.arabic ? "rtl" : "ltr"}>
        <p className="drawing-selection-help">
          {t(
            "Drag anchors and handles, or use arrow keys. Shift moves 10 units. Apply makes one reversible edit.",
            "اسحب نقاط المسار ومقابضه أو استخدم الأسهم. مع Shift تتحرك النقطة 10 وحدات. التطبيق يضيف تعديلًا واحدًا قابلًا للتراجع.",
          )}
        </p>
        <svg
          ref={svg}
          className="drawing-path-preview"
          role="application"
          aria-label={t("Path editor", "محرر المسار")}
          viewBox={`${view.x - 40} ${view.y - 40} ${view.w + 80} ${view.h + 80}`}
          onPointerMove={(e) => {
            const d = drag.current,
              q = coordinate(e);
            if (enabled && d && d.pointer === e.pointerId && q) setPath((value) => movePathVertex(value, d.index, q, d.handle));
          }}
          onPointerUp={(e) => {
            if (drag.current?.pointer === e.pointerId) drag.current = null;
          }}
          onPointerCancel={(e) => {
            const d = drag.current;
            if (d?.pointer === e.pointerId) {
              setPath(d.before);
              drag.current = null;
            }
          }}
          onLostPointerCapture={(e) => {
            const d = drag.current;
            if (d?.pointer === e.pointerId) {
              setPath(d.before);
              drag.current = null;
            }
          }}
        >
          {g && (
            <defs>
              {g.type === "linear" ? (
                <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={g.from.x} y1={g.from.y} x2={g.to.x} y2={g.to.y}>
                  {g.stops.map((s, i) => (
                    <stop key={i} offset={s.at} stopColor={s.color} />
                  ))}
                </linearGradient>
              ) : (
                <radialGradient
                  id={gradientId}
                  gradientUnits="userSpaceOnUse"
                  cx={g.from.x}
                  cy={g.from.y}
                  r={Math.hypot(g.to.x - g.from.x, g.to.y - g.from.y)}
                >
                  {g.stops.map((s, i) => (
                    <stop key={i} offset={s.at} stopColor={s.color} />
                  ))}
                </radialGradient>
              )}
            </defs>
          )}
          <path
            d={svgPath(path)}
            fill={g ? `url(#${gradientId})` : p.node.paint.fill}
            stroke={p.node.paint.stroke}
            strokeWidth={p.node.paint.strokeWidth}
            strokeDasharray={p.node.paint.dash.join(" ")}
            strokeLinecap={p.node.paint.cap}
            strokeLinejoin="round"
            opacity={p.node.opacity}
          />
          {path.vertices.map((point, i) => (
            <g key={i}>
              {(["in", "out"] as const).map(
                (key) =>
                  point[key] && (
                    <g key={key}>
                      <line
                        x1={point.x}
                        y1={point.y}
                        x2={point[key]!.x}
                        y2={point[key]!.y}
                        stroke="#007aff"
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                      />
                      {handle(i, point[key]!, key)}
                    </g>
                  ),
              )}
              {handle(i, point)}
            </g>
          ))}
        </svg>
        <fieldset disabled={!enabled}>
          <label className="drawing-field">
            <span>{t("Vertex", "نقطة المسار")}</span>
            <select value={index} onChange={(e) => setIndex(Number(e.target.value))}>
              {path.vertices.map((_, i) => (
                <option key={i} value={i}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
          <div className="drawing-step-actions">
            <Button
              size="compact"
              disabled={path.vertices.length >= 4096}
              onClick={() => {
                setPath((value) => splitPath(value, index));
                setIndex(index + 1);
              }}
            >
              {t("Add vertex", "إضافة نقطة")}
            </Button>
            <Button
              size="compact"
              disabled={path.vertices.length <= 2}
              onClick={() => {
                setPath((value) => ({ ...value, vertices: value.vertices.filter((_, i) => i !== index) }));
                setIndex(Math.max(0, index - 1));
              }}
            >
              {t("Delete vertex", "حذف النقطة")}
            </Button>
            <Button size="compact" onClick={() => setPath((value) => smoothPathVertex(value, index))}>
              {t("Smooth", "تنعيم")}
            </Button>
            <Button
              size="compact"
              onClick={() =>
                setPath((value) => ({
                  ...value,
                  vertices: value.vertices.map((point, i) => (i === index ? { x: point.x, y: point.y } : point)),
                }))
              }
            >
              {t("Corner", "زاوية")}
            </Button>
            <Button size="compact" onClick={() => setView(pathBounds(path))}>
              {t("Fit path", "ملاءمة المسار")}
            </Button>
          </div>
          <label className="drawing-check">
            <input type="checkbox" checked={path.closed} onChange={(e) => setPath((value) => ({ ...value, closed: e.target.checked }))} />
            {t("Closed path", "مسار مغلق")}
          </label>
          {([undefined, "in", "out"] as const).map((key) => {
            const point = key ? v[key] : v;
            return (
              point && (
                <div className="drawing-transform-fields" key={key ?? "point"}>
                  {(["x", "y"] as const).map((axis) => (
                    <label key={axis} className="drawing-field">
                      <span>{`${key ? t(key, key === "in" ? "الداخل" : "الخارج") : t("Anchor", "المرساة")} ${axis}`}</span>
                      <input
                        type="number"
                        value={Number(point[axis].toFixed(3))}
                        step={1}
                        onChange={(e) => {
                          const value = e.target.valueAsNumber;
                          if (Number.isFinite(value) && Math.abs(value) <= 1e9) change({ ...point, [axis]: value }, key);
                        }}
                      />
                    </label>
                  ))}
                </div>
              )
            );
          })}
        </fieldset>
        {waiting && <p role="status">{t("Reserving path", "جارٍ حجز المسار")}</p>}
        {lost && <p role="alert">{t("Path reservation was lost", "فُقد حجز المسار")}</p>}
        {error && <p role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
