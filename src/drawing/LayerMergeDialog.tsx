import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import type { DrawingScene } from "./model";
import type { DrawingGestureLease } from "./gestureLeases";
import { DrawingScenePreview } from "./ScenePreview";
import { applyChanges } from "./operations";
import { exportPreparationScene } from "./exportScope";
import { mergeSourceKey, mergedLayerChanges, renderVisibleMerge, type MergePlan, type MergedFrame } from "./layerMerge";
import "./imageCrop.css";
interface Props {
  pageId: string;
  scene: DrawingScene;
  canEdit: boolean;
  arabic: boolean;
  begin: () => Promise<DrawingGestureLease | null>;
  apply: (plan: MergePlan, frames: MergedFrame[]) => Promise<string[]>;
  onClose: () => void;
}
export function LayerMergeDialog(p: Props) {
  const t = (en: string, ar: string) => (p.arabic ? ar : en),
    [source] = useState(() => p.scene),
    [result, setResult] = useState<{ plan: MergePlan; frames: MergedFrame[] } | null>(null),
    [frameId, setFrameId] = useState(p.scene.defaultFrameId),
    [image, setImage] = useState<{ image: HTMLImageElement; attachment: string; url: string } | null>(null),
    [progress, setProgress] = useState(0),
    [waiting, setWaiting] = useState(true),
    [lost, setLost] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const active = useRef(true),
    lease = useRef<DrawingGestureLease | null>(null),
    finished = useRef(false),
    controller = useRef<AbortController | null>(null);
  const [progressTotal, setProgressTotal] = useState(source.frameOrder.length);
  const message = (e: unknown) => {
    const key = e instanceof Error ? e.message : String(e);
    return (
      (
        {
          "merge-empty": t("There is no visible content to merge", "لا يوجد محتوى ظاهر للدمج"),
          "merge-world": t(
            "Some world items extend outside the frames have anchored endpoints or use a non-image blur. Move them fully inside one frame and remove these conditions before merging. No content has been changed.",
            "بعض عناصر العالم تمتد خارج الإطارات أو لها نهايات مرتبطة أو ضبابية على عنصر غير صوري. انقلها بالكامل داخل إطار واحد وأزل هذه الحالات قبل الدمج. لم يتغير أي محتوى.",
          ),
          "merge-locked": t("Unlock source layers and elements before merging", "أزل قفل طبقات المصدر وعناصره قبل الدمج"),
          "merge-steps": t(
            "A step hides only part of a merged image or affects overlapping frames. Keep the layers or change that step first.",
            "تخفي إحدى الخطوات جزءًا فقط من الصورة المدمجة أو تؤثر في إطارات متداخلة. أبق الطبقات أو عدّل الخطوة أولًا.",
          ),
          "merge-frame-layout": t(
            "Merge needs whole-pixel frame dimensions. In an unclipped frame all visible content must stay inside the frame and cannot have anchored endpoints or non-image blur.",
            "يتطلب الدمج أبعاد إطار بأرقام صحيحة. في الإطار غير المقصوص يجب أن يبقى كل المحتوى الظاهر داخله وألا تكون له نهايات مرتبطة أو ضبابية على عناصر غير صورية.",
          ),
          "merge-frame-background": t(
            "Use a fully opaque or transparent hexadecimal frame background before merging. Partly transparent backgrounds cannot be flattened safely.",
            "استخدم خلفية إطار سداسية معتمة بالكامل أو شفافة قبل الدمج. لا يمكن تسطيح الخلفية شبه الشفافة بأمان.",
          ),
          "merge-overlap": t(
            "Overlapping frames need opaque backgrounds and no lower-frame or world content in the overlap. Move the content or separate the frames.",
            "الإطارات المتداخلة تحتاج خلفيات معتمة ومنطقة تداخل خالية من محتوى الإطار السفلي والعالم. انقل المحتوى أو افصل الإطارات.",
          ),
          "merge-memory": t(
            "This merge exceeds the64-million-pixel or working-memory limit",
            "يتجاوز الدمج حد64 مليون بكسل أو حد ذاكرة العمل",
          ),
          "merge-scene-limit": t(
            "The drawing is too large for an atomic merge. Split it into smaller drawings.",
            "الرسم أكبر من حد الدمج الذري. قسّمه إلى رسومات أصغر.",
          ),
          "merge-stale": t("The source changed. Cancel and reopen the merge.", "تغيّر المصدر. ألغِ المعاينة وافتح الدمج مجددًا."),
        } as Record<string, string>
      )[key] ?? key
    );
  };
  useEffect(() => {
    active.current = true;
    const task = new AbortController();
    controller.current = task;
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      try {
        const value = await p.begin();
        if (!active.current) {
          value?.cancel();
          return;
        }
        lease.current = value;
        const update = () => {
          const lost = value?.state() === "lost";
          setLost(lost);
          if (lost) task.abort();
        };
        unsubscribe = value?.subscribe(update);
        update();
        setWaiting(false);
        if (value?.state() === "lost") return;
        const output = await renderVisibleMerge(p.pageId, source, task.signal, (n, total) => {
          if (active.current) {
            setProgress(n);
            setProgressTotal(total);
          }
        });
        if (active.current && !task.signal.aborted) setResult(output);
      } catch (e) {
        if (active.current && !task.signal.aborted) setError(message(e));
        setWaiting(false);
      }
    })();
    return () => {
      active.current = false;
      task.abort();
      unsubscribe?.();
      if (!finished.current) lease.current?.cancel();
    };
  }, []);
  useEffect(() => {
    if (!p.canEdit) {
      controller.current?.abort();
      lease.current?.cancel();
      setLost(true);
    }
  }, [p.canEdit]);
  useEffect(() => {
    const frame = result?.frames.find((f) => f.frameId === frameId);
    if (!frame) return;
    let alive = true;
    const url = URL.createObjectURL(frame.blob),
      img = new Image();
    setImage(null);
    img.src = url;
    void img.decode().then(
      () => {
        if (alive) setImage({ image: img, attachment: frame.asset.attachmentId, url });
      },
      (e) => {
        if (alive) setError(message(e));
      },
    );
    return () => {
      alive = false;
      URL.revokeObjectURL(url);
    };
  }, [result, frameId]);
  const [worldImage, setWorldImage] = useState<{ image: HTMLImageElement; attachment: string } | null>(null);
  useEffect(() => {
    const world = result?.frames.find((f) => f.world);
    setWorldImage(null);
    if (!world) return;
    let alive = true;
    const url = URL.createObjectURL(world.blob),
      img = new Image();
    img.src = url;
    void img.decode().then(
      () => {
        if (alive) setWorldImage({ image: img, attachment: world.asset.attachmentId });
      },
      (e) => {
        if (alive) setError(message(e));
      },
    );
    return () => {
      alive = false;
      URL.revokeObjectURL(url);
    };
  }, [result]);
  const after = useMemo(
      () => (result ? applyChanges(source, mergedLayerChanges(source, result.plan, result.frames).changes) : source),
      [result, source],
    ),
    frame = source.frames[frameId],
    beforePrepared = useMemo(() => exportPreparationScene(source, frameId, frame, true), [source, frameId, frame]),
    afterPrepared = useMemo(() => exportPreparationScene(after, frameId, frame, true), [after, frameId, frame]),
    images = useMemo(() => {
      if (!image) return undefined;
      const map = new Map([[image.attachment, image.image]]);
      if (worldImage) map.set(worldImage.attachment, worldImage.image);
      return map;
    }, [image, worldImage]),
    valid = mergeSourceKey(p.scene) === mergeSourceKey(source);
  return (
    <Modal
      title={t("Merge visible layers into pixels", "دمج الطبقات الظاهرة كبكسلات")}
      width={860}
      className={`drawing-image-crop${p.arabic ? " is-arabic" : ""}`}
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
            loading={saving}
            disabled={!result || !image || (!!result.plan.world && !worldImage) || waiting || lost || saving || !p.canEdit || !valid}
            onClick={async () => {
              if (!result) return;
              setSaving(true);
              try {
                if (lease.current?.state() === "lost") throw Error(t("The root reservation was lost", "فُقد حجز الرسم"));
                const operations = await p.apply(result.plan, result.frames);
                if (!active.current) return;
                if (!operations.length) throw Error(t("The merge could not be saved", "تعذر حفظ الدمج"));
                finished.current = true;
                lease.current?.finish(operations);
                p.onClose();
              } catch (e) {
                if (active.current) {
                  setError(message(e));
                  setSaving(false);
                }
              }
            }}
          >
            {t("Apply raster merge", "تطبيق الدمج البكسلي")}
          </Button>
        </>
      }
    >
      <div dir={p.arabic ? "rtl" : "ltr"}>
        <p>
          {t(
            "All visible layers across every frame become one PNG per frame at one document pixel per source pixel, including each frame background. World content outside frames is kept in a separate transparent image. Source elements are hidden in place and remain available to one Undo. Text and live links in the merged copy become static pixels.",
            "تتحول الطبقات الظاهرة في جميع الإطارات إلى PNG مستقل لكل إطار بدقة بكسل مصدر لكل بكسل في المستند، مع تثبيت خلفية الإطار. يُحفظ محتوى العالم خارج الإطارات في صورة شفافة مستقلة. تُخفى العناصر الأصلية في مكانها وتبقى متاحة بتراجع واحد. تصبح النصوص والروابط الحية في النسخة المدمجة بكسلات ثابتة.",
          )}
        </p>
        <label className="drawing-field">
          <span>{t("Preview frame", "معاينة الإطار")}</span>
          <select value={frameId} onChange={(e) => setFrameId(e.target.value)}>
            {source.frameOrder.map((id) => (
              <option key={id} value={id}>
                {source.frames[id].name}
              </option>
            ))}
          </select>
        </label>
        <div className="drawing-crop-comparison">
          <section>
            <h3>{t("Before", "قبل")}</h3>
            <DrawingScenePreview
              scene={source}
              preparation={beforePrepared}
              frameId={frameId}
              camera={frame}
              label={t("Before layer merge", "قبل دمج الطبقات")}
            />
          </section>
          <section>
            <h3>{t("After", "بعد")}</h3>
            {result && image && (!result.plan.world || worldImage) ? (
              <DrawingScenePreview
                scene={after}
                preparation={afterPrepared}
                previewImages={images}
                frameId={frameId}
                camera={frame}
                label={t("After layer merge", "بعد دمج الطبقات")}
              />
            ) : (
              <p role="status">{t(`Preparing frames ${progress}/${progressTotal}`, `جارٍ تجهيز الإطارات ${progress}/${progressTotal}`)}</p>
            )}
          </section>
        </div>
        {waiting && <p role="status">{t("Reserving the complete drawing", "جارٍ حجز الرسم كاملًا")}</p>}
        {lost && (
          <p role="alert">{t("Root reservation unavailable. Cancel and reopen.", "حجز الرسم غير متاح. ألغِ المعاينة وافتحها مجددًا.")}</p>
        )}
        {!saving && !valid && (
          <p role="alert">{t("The source changed. Cancel and reopen.", "تغيّر المصدر. ألغِ المعاينة وافتحها مجددًا.")}</p>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
