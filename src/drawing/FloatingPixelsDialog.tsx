import { useMemo, useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { DrawingStage } from "./Stage";
import { DEFAULT_BRUSH, type DrawingNode } from "./model";
import { projectedPixelScene } from "./floatingPixels";
import { transformObjects, translateObjects, objectTransformOrigin } from "./objectTransforms";
import { pixelEditMessage } from "./PixelSelectionActions";
import type { PreparedPixelEdit } from "./usePixelEdits";
export function FloatingPixelsDialog(p: {
  draft: PreparedPixelEdit;
  arabic: boolean;
  canEdit: boolean;
  busy: boolean;
  saving: boolean;
  error: unknown;
  leaseState: "locked" | "offline" | "lost" | null;
  onApply: (node: DrawingNode) => void;
  onCancel: () => void;
  onFrame: (index: number) => void;
}) {
  const d = p.draft,
    t = (en: string, ar: string) => (p.arabic ? ar : en),
    [node, setNode] = useState(d.art.node),
    [localError, setLocalError] = useState<unknown>(null);
  const [view, setView] = useState(() => ({
    ...d.region,
    x: d.region.x - 60,
    y: d.region.y - 60,
    w: d.region.w + 120,
    h: d.region.h + 120,
    scale: Math.min(2, 650 / (d.region.w + 120), 340 / (d.region.h + 120)),
  }));
  const scene = useMemo(() => projectedPixelScene(d.scene, d.art, node), [d, node]),
    editable = p.canEdit && !p.busy && p.leaseState !== "lost";
  const identity = useMemo(
    () => (d.action === "move" ? { node: d.art.node, hiddenIds: [d.art.node.id, ...d.art.erasers.map((n) => n.id)] } : undefined),
    [d],
  );
  const update = (patch: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    rotation?: number;
    flipX?: boolean;
    flipY?: boolean;
  }) => {
    try {
      const o = objectTransformOrigin(scene, [node]);
      setNode(
        transformObjects(scene, [node], {
          centerX: patch.x ?? o.x,
          centerY: patch.y ?? o.y,
          scale: 1,
          width: patch.width,
          height: patch.height,
          rotation: patch.rotation === undefined ? 0 : patch.rotation - node.rotation,
          flipX: patch.flipX === undefined ? false : patch.flipX !== node.flipX,
          flipY: patch.flipY === undefined ? false : patch.flipY !== node.flipY,
        })[0],
      );
      setLocalError(null);
    } catch (e) {
      setLocalError(e);
    }
  };
  const origin = objectTransformOrigin(scene, [node]);
  const show = (next: DrawingNode) => {
    const a = (next.rotation * Math.PI) / 180,
      w = Math.abs(Math.cos(a)) * next.w + Math.abs(Math.sin(a)) * next.h,
      h = Math.abs(Math.sin(a)) * next.w + Math.abs(Math.cos(a)) * next.h;
    setView({
      x: next.x + next.w / 2 - w / 2 - 30,
      y: next.y + next.h / 2 - h / 2 - 30,
      w: w + 60,
      h: h + 60,
      scale: Math.min(2, 650 / (w + 60), 340 / (h + 60)),
    });
  };
  const fit = () => {
    try {
      const a = (node.rotation * Math.PI) / 180,
        w = Math.abs(Math.cos(a)) * node.w + Math.abs(Math.sin(a)) * node.h,
        h = Math.abs(Math.sin(a)) * node.w + Math.abs(Math.cos(a)) * node.h,
        next = transformObjects(scene, [node], {
          centerX: d.frame.x + d.frame.w / 2,
          centerY: d.frame.y + d.frame.h / 2,
          scale: Math.min(d.frame.w / w, d.frame.h / h),
          rotation: 0,
          flipX: false,
          flipY: false,
        })[0];
      setNode(next);
      show(next);
      setLocalError(null);
    } catch (e) {
      setLocalError(e);
    }
  };
  const title =
    d.kind === "image"
      ? t(d.action === "import" ? "Import image" : "Paste image", d.action === "import" ? "إضافة صورة" : "لصق صورة")
      : t(
          d.action === "move" ? "Move selected pixels" : "Duplicate selected pixels",
          d.action === "move" ? "نقل البكسلات المحددة" : "تكرار البكسلات المحددة",
        );
  return (
    <Modal
      title={title}
      width={1040}
      className={`drawing-floating-dialog${p.arabic ? " is-arabic" : ""}`}
      onClose={() => {
        if (!p.saving) p.onCancel();
      }}
      footer={
        <>
          <Button disabled={p.saving} onClick={p.onCancel}>
            {t("Cancel", "إلغاء")}
          </Button>
          <Button variant="tinted" loading={p.busy} disabled={!editable || !!localError} onClick={() => p.onApply(node)}>
            {t("Apply pixels", "تطبيق البكسلات")}
          </Button>
        </>
      }
    >
      <div dir={p.arabic ? "rtl" : "ltr"}>
        <p className="drawing-selection-help">
          {t(
            "Drag the pixels or use the resize and rotation grips. Cancel leaves the drawing unchanged. Apply preserves source elements and adds one reversible edit.",
            "اسحب البكسلات أو استخدم مقابض التحجيم والدوران. الإلغاء يبقي الرسم كما هو. التطبيق يحتفظ بعناصر المصدر ويضيف تعديلًا واحدًا يمكن التراجع عنه.",
          )}
        </p>
        {d.kind === "image" && (
          <p className="drawing-selection-help">
            {d.convertedFromSvg
              ? t(
                  `SVG is sanitized and converted to a ${d.art.asset.width} × ${d.art.asset.height} px PNG. The original SVG is not stored.`,
                  `تُنقّى صورة SVG وتُحوّل إلى PNG بمقاس ${d.art.asset.width} × ${d.art.asset.height} بكسل. لا يُحفظ ملف SVG الأصلي.`,
                )
              : t(
                  `Original image: ${d.art.asset.width} × ${d.art.asset.height} px. Its file stays intact when resized.`,
                  `المقاس الأصلي: ${d.art.asset.width} × ${d.art.asset.height} بكسل. يبقى ملف الصورة محفوظًا عند تغيير المقاس.`,
                )}
          </p>
        )}
        {d.kind === "image" && (
          <p className="drawing-selection-help">
            {t(
              "Drawing and flattened image exports use 8-bit sRGB. Color-profile handling depends on your browser; wide-gamut colors may look different. The original image file is not changed.",
              "يستخدم الرسم والصور المسطحة المصدّرة ألوان sRGB بعمق 8 بت. تعتمد معالجة ملف تعريف الألوان على المتصفح وقد تختلف الألوان واسعة النطاق. لا يُعدّل ملف الصورة المحفوظ.",
            )}
          </p>
        )}
        {d.kind === "image" && d.animation && (
          <section aria-label={t("Choose a static frame", "اختيار لقطة ثابتة")}>
            <p className="drawing-selection-help">
              {t(
                `Animated image, ${d.animation.frameCount} frames. Choose the static frame to place in the drawing. The animated original is retained.`,
                `صورة متحركة من ${d.animation.frameCount} لقطات. اختر اللقطة الثابتة التي ستُضاف للرسم. يبقى الملف المتحرك الأصلي محفوظًا.`,
              )}
            </p>
            <label className="drawing-field">
              <span>{t("Animation frame", "لقطة الصورة المتحركة")}</span>
              <input
                type="number"
                min={1}
                max={d.animation.frameCount}
                step={1}
                disabled={!editable}
                value={d.animation.index + 1}
                onChange={(e) => p.onFrame(e.target.valueAsNumber - 1)}
              />
            </label>
            {p.busy && !p.saving && <p role="status">{t("Preparing the selected frame", "جارٍ تجهيز اللقطة المختارة")}</p>}
          </section>
        )}
        <div className="drawing-floating-stage">
          <DrawingStage
            scene={scene}
            tool="select"
            brush={DEFAULT_BRUSH}
            shape="rect"
            layerId={d.art.layer.id}
            frameId={d.frame.id}
            editable={editable}
            onError={setLocalError}
            selected={[node.id]}
            view={view}
            autoShape={false}
            laserLifetime={1200}
            onView={setView}
            onSelect={() => {}}
            onResize={(w, h) => setView((v) => ({ ...v, w: w / v.scale, h: h / v.scale }))}
            onAdd={() => {}}
            onMove={(_ids, dx, dy, before) => {
              setNode(translateObjects(scene, before ?? [node], { x: dx, y: dy })[0]);
              return [];
            }}
            onTransform={async (_before, after) => {
              setNode(after[0]);
              setLocalError(null);
              return [];
            }}
            onText={() => {}}
            onColor={() => {}}
            onFill={() => {}}
            onRegion={() => {}}
            selectionKind="rect"
            previewImages={d.images}
            interactiveIds={[node.id]}
            previewIdentity={identity}
          />
        </div>
        <fieldset className="drawing-transform-fields" disabled={!editable}>
          <div className="drawing-step-actions">
            <Button size="compact" onClick={fit}>
              {t("Fit to frame", "ملاءمة للإطار")}
            </Button>
            <Button size="compact" onClick={() => show(node)}>
              {t("Show pixels", "إظهار البكسلات")}
            </Button>
            {d.kind === "image" && (
              <Button
                size="compact"
                onClick={() => {
                  update({ width: d.art.asset.width, height: d.art.asset.height });
                }}
              >
                {t("Original size", "المقاس الأصلي")}
              </Button>
            )}
          </div>
          {(
            [
              ["x", "Center X", "المركز الأفقي", origin.x],
              ["y", "Center Y", "المركز الرأسي", origin.y],
              ["width", "Width", "العرض", node.w],
              ["height", "Height", "الارتفاع", node.h],
              ["rotation", "Rotation (degrees)", "الدوران بالدرجات", node.rotation],
            ] as const
          ).map(([key, en, ar, value]) => (
            <label className="drawing-field" key={key}>
              <span>{t(en, ar)}</span>
              <input
                type="number"
                step="0.1"
                value={Number(value.toFixed(4))}
                onChange={(e) => update({ [key]: e.target.valueAsNumber })}
              />
            </label>
          ))}
          <label className="drawing-check">
            <input type="checkbox" checked={node.flipX} onChange={(e) => update({ flipX: e.target.checked })} />
            {t("Flip horizontally", "قلب أفقي")}
          </label>
          <label className="drawing-check">
            <input type="checkbox" checked={node.flipY} onChange={(e) => update({ flipY: e.target.checked })} />
            {t("Flip vertically", "قلب رأسي")}
          </label>
        </fieldset>
        {p.leaseState === "offline" && (
          <p role="status">
            {t(
              "Offline edit. The operation stays local until source changes are checked during synchronization.",
              "تعديل دون اتصال. تبقى العملية محلية حتى التحقق من تغييرات المصدر عند المزامنة.",
            )}
          </p>
        )}
        {p.leaseState === "lost" && (
          <p role="alert">{t("The source reservation was lost. Cancel and try again.", "فُقد حجز المصدر. ألغِ المعاينة وأعد المحاولة.")}</p>
        )}
        {!!(p.error || localError) && <p role="alert">{pixelEditMessage(p.error || localError, p.arabic)}</p>}
      </div>
    </Modal>
  );
}
