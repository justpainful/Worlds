import { effectiveLayer } from "./layers";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { DrawingScenePreview } from "./ScenePreview";
import { DrawingRenderer } from "./renderer";
import { worldInkBounds } from "./geometry";
import {
  cropPreviewScene,
  dragImageCrop,
  imageCropChanges,
  imageCropSourceKey,
  validImageCrop,
  type CropGrip,
  type CropMode,
} from "./imageCrop";
import type { DrawingGestureLease } from "./gestureLeases";
import { id, type DrawingNode, type DrawingScene, type Point, type Rect } from "./model";
import "./imageCrop.css";
interface Props {
  scene: DrawingScene;
  nodeId: string;
  canEdit: boolean;
  arabic: boolean;
  begin: () => Promise<DrawingGestureLease | null>;
  apply: (before: DrawingNode, crop: Rect, mode: CropMode, sourceKey: string, effects: DrawingNode["effects"]) => Promise<string[]>;
  onClose: () => void;
}
function CropSource({
  scene,
  crop,
  width,
  height,
  enabled,
  onChange,
  arabic,
}: {
  scene: DrawingScene;
  crop: Rect;
  width: number;
  height: number;
  enabled: boolean;
  onChange: (crop: Rect) => void;
  arabic: boolean;
}) {
  const host = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    svg = useRef<SVGSVGElement>(null),
    drag = useRef<{ point: Point; crop: Rect; grip: CropGrip } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const r = new DrawingRenderer();
    let active = true;
    const draw = () => {
      if (!active || !host.current || !canvas.current) return;
      const w = host.current.clientWidth,
        h = host.current.clientHeight,
        dpr = devicePixelRatio || 1,
        scale = Math.min(w / width, h / height);
      canvas.current.width = Math.max(1, Math.round(w * dpr));
      canvas.current.height = Math.max(1, Math.round(h * dpr));
      try {
        r.render(
          canvas.current,
          scene,
          { x: -(w / scale - width) / 2, y: -(h / scale - height) / 2, w: w / scale, h: h / scale, scale: scale * dpr },
          { background: false },
        );
      } catch (e) {
        setError(String(e));
      }
    };
    r.onAssetChange = draw;
    void r
      .prepare(scene)
      .then(draw)
      .catch((e) => {
        if (active) setError(String(e));
      });
    const observer = new ResizeObserver(draw);
    if (host.current) observer.observe(host.current);
    return () => {
      active = false;
      observer.disconnect();
      r.dispose();
    };
  }, [scene, width, height]);
  const point = (e: PointerEvent): Point | null => {
    const m = svg.current?.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  const start = (e: PointerEvent<SVGElement>, grip: CropGrip) => {
    if (!enabled || e.button !== 0) return;
    const p = point(e);
    if (!p) return;
    e.preventDefault();
    e.currentTarget.focus();
    drag.current = { point: p, crop: { ...crop }, grip };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const grips: [CropGrip, number, number][] = [
      ["nw", crop.x, crop.y],
      ["n", crop.x + crop.w / 2, crop.y],
      ["ne", crop.x + crop.w, crop.y],
      ["e", crop.x + crop.w, crop.y + crop.h / 2],
      ["se", crop.x + crop.w, crop.y + crop.h],
      ["s", crop.x + crop.w / 2, crop.y + crop.h],
      ["sw", crop.x, crop.y + crop.h],
      ["w", crop.x, crop.y + crop.h / 2],
    ],
    radius = Math.max(width, height) / 110;
  const key = (e: React.KeyboardEvent, grip: CropGrip) => {
    if (!enabled) return;
    const step = e.shiftKey ? 10 : 1,
      dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0,
      dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
    if (dx || dy) {
      e.preventDefault();
      e.stopPropagation();
      onChange(dragImageCrop(crop, grip, dx, dy, width, height));
    }
  };
  return (
    <div className="drawing-crop-source" ref={host}>
      <canvas ref={canvas} role="img" aria-label={arabic ? "الصورة الأصلية دون تغيير" : "Unchanged original image"} />
      <svg
        ref={svg}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        role="application"
        aria-label={arabic ? "حدود اقتصاص الصورة" : "Image crop boundaries"}
        onPointerMove={(e) => {
          const p = point(e),
            g = drag.current;
          if (g && p && enabled) onChange(dragImageCrop(g.crop, g.grip, p.x - g.point.x, p.y - g.point.y, width, height));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          if (drag.current) onChange(drag.current.crop);
          drag.current = null;
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && drag.current) {
            e.preventDefault();
            e.stopPropagation();
            onChange(drag.current.crop);
            drag.current = null;
          }
        }}
      >
        <path
          d={`M0 0H${width}V${height}H0Z M${crop.x} ${crop.y}V${crop.y + crop.h}H${crop.x + crop.w}V${crop.y}Z`}
          fill="rgba(0,0,0,.55)"
          fillRule="evenodd"
          pointerEvents="none"
        />
        <rect
          className="drawing-crop-outline"
          x={crop.x}
          y={crop.y}
          width={crop.w}
          height={crop.h}
          fill="transparent"
          stroke="#ffffff"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          role="button"
          tabIndex={enabled ? 0 : -1}
          aria-label={arabic ? "تحريك منطقة الاقتصاص" : "Move crop region"}
          onPointerDown={(e) => start(e, "move")}
          onKeyDown={(e) => key(e, "move")}
        />
        {grips.map(([grip, x, y]) => (
          <g key={grip}>
            <circle
              cx={x}
              cy={y}
              r={radius}
              fill="transparent"
              stroke="transparent"
              strokeWidth={32}
              vectorEffect="non-scaling-stroke"
              role="button"
              tabIndex={enabled ? 0 : -1}
              aria-label={
                arabic
                  ? `حد الاقتصاص ${{ nw: "أعلى اليسار", n: "الأعلى", ne: "أعلى اليمين", e: "اليمين", se: "أسفل اليمين", s: "الأسفل", sw: "أسفل اليسار", w: "اليسار", move: "المنطقة" }[grip]}`
                  : `Crop edge ${grip}`
              }
              onPointerDown={(e) => start(e, grip)}
              onKeyDown={(e) => key(e, grip)}
            />
            <circle
              cx={x}
              cy={y}
              r={radius}
              fill="#ffffff"
              stroke="#202023"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          </g>
        ))}
      </svg>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
export function ImageCropDialog(p: Props) {
  const t = (en: string, ar: string) => (p.arabic ? ar : en),
    [before] = useState(() => structuredClone(p.scene.nodes[p.nodeId])),
    [sourceKey] = useState(() => imageCropSourceKey(p.scene, p.nodeId)),
    asset = p.scene.assets[before?.assetId ?? ""];
  const [crop, setCrop] = useState<Rect>(() => before?.crop ?? { x: 0, y: 0, w: asset?.width ?? 1, h: asset?.height ?? 1 }),
    [mode, setMode] = useState<CropMode>(() => (effectiveLayer(p.scene, before.layerId).positionLocked ? "fit" : "trim")),
    [compare, setCompare] = useState<"crop" | "effects">("crop"),
    [waiting, setWaiting] = useState(true),
    [lost, setLost] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const [effects, setEffects] = useState<DrawingNode["effects"]>(() => structuredClone(before.effects));
  const active = useRef(true),
    lease = useRef<DrawingGestureLease | null>(null),
    finished = useRef(false);
  useEffect(() => {
    active.current = true;
    let unsubscribe: (() => void) | undefined;
    void p.begin().then(
      (value) => {
        if (!active.current) {
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
        if (active.current) {
          setError(String(e));
          setWaiting(false);
          setLost(true);
        }
      },
    );
    return () => {
      active.current = false;
      unsubscribe?.();
      if (!finished.current) lease.current?.cancel();
    };
  }, []);
  useEffect(() => {
    if (!p.canEdit) {
      lease.current?.cancel();
      setLost(true);
    }
  }, [p.canEdit]);
  const describe = (e: unknown) => {
    const key = e instanceof Error ? e.message : "";
    return (
      (
        {
          "crop-mask-missing": t("A referenced mask is missing. The image was not changed.", "قناع مرتبط بالصورة مفقود. لم تتغير الصورة."),
          "crop-source": t("The original image is unavailable", "الصورة الأصلية غير متاحة"),
          "crop-stale": t("The image changed. Close this sheet and reopen it.", "تغيّرت الصورة. أغلق المعاينة وافتحها مجددًا."),
          "crop-locked": t("The image or its parent group is locked", "الصورة أو مجموعتها الأم مقفلة"),
          "crop-bounds": t("Keep the crop inside the original image", "أبقِ حدود الاقتصاص داخل الصورة الأصلية"),
        } as Record<string, string>
      )[key] ?? String(e)
    );
  };
  const result = useMemo(() => {
    try {
      return { ...imageCropChanges(p.scene, before, crop, mode, sourceKey), error: "" };
    } catch (e) {
      return { node: before, changes: [], error: describe(e) };
    }
  }, [p.scene, before, crop, mode, sourceKey, p.arabic]);
  const sourceScene = useMemo(() => {
    if (!asset) return p.scene;
    const f = p.scene.frames[p.scene.defaultFrameId],
      raw = {
        ...structuredClone(before),
        x: 0,
        y: 0,
        w: asset.width,
        h: asset.height,
        rotation: 0,
        flipX: false,
        flipY: false,
        geometrySize: undefined,
        crop: undefined,
        maskId: undefined,
        effects: [],
        opacity: 1,
        frameId: f.id,
        visible: true,
      },
      layer = { ...p.scene.layers[raw.layerId], parentId: null, visible: true, opacity: 1, blend: "source-over" as const };
    return {
      ...p.scene,
      frames: { [f.id]: { ...f, x: 0, y: 0, w: asset.width, h: asset.height, background: "transparent" } },
      frameOrder: [f.id],
      layers: { [layer.id]: layer },
      layerOrder: [layer.id],
      assets: { [asset.id]: asset },
      nodes: { [raw.id]: raw },
      nodeOrder: [raw.id],
      steps: {},
      stepOrder: [],
    };
  }, [p.scene, before, asset]);
  const previewEffects = useMemo(
    () =>
      effects.map((effect) => ({
        ...effect,
        maskId: effect.maskId ? (result.node.effects.find((e) => e.id === effect.id)?.maskId ?? effect.maskId) : undefined,
      })),
    [effects, result.node.effects],
  );
  const afterScene = useMemo(
    () => cropPreviewScene(p.scene, { ...result.node, effects: previewEffects }, result.changes),
    [p.scene, result.node, result.changes, previewEffects],
  );
  const beforeScene = useMemo(
    () =>
      compare === "effects" ? { ...afterScene, nodes: { ...afterScene.nodes, [before.id]: { ...result.node, effects: [] } } } : p.scene,
    [afterScene, before.id, compare, result.node, p.scene],
  );
  const camera = useMemo(() => {
    const a = worldInkBounds(before),
      b = worldInkBounds(result.node),
      x = Math.min(a.x, b.x) - 16,
      y = Math.min(a.y, b.y) - 16;
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x + 16, h: Math.max(a.y + a.h, b.y + b.h) - y + 16 };
  }, [before, result.node]);
  const enabled = !!asset && p.canEdit && !waiting && !lost && !saving && !result.error;
  const number = (key: keyof Rect, en: string, ar: string) => (
    <label className="drawing-field">
      <span>{t(en, ar)}</span>
      <input
        type="number"
        min={key === "x" || key === "y" ? 0 : 1}
        step={1}
        value={crop[key]}
        onChange={(e) => {
          const value = e.target.valueAsNumber;
          if (!Number.isFinite(value)) return;
          const next = { ...crop, [key]: value };
          if (asset && validImageCrop(next, asset.width, asset.height)) setCrop(next);
        }}
      />
    </label>
  );
  return (
    <Modal
      title={t("Crop image and compare", "اقتصاص الصورة والمقارنة")}
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
            disabled={!enabled}
            onClick={async () => {
              if (!enabled) return;
              if (!result.changes.length && JSON.stringify(effects) === JSON.stringify(before.effects)) {
                p.onClose();
                return;
              }
              setSaving(true);
              try {
                if (lease.current?.state() === "lost") throw Error(t("The image reservation was lost", "فُقد حجز الصورة"));
                const operations = await p.apply(before, crop, mode, sourceKey, effects);
                if (!active.current) return;
                if (!operations.length) throw Error(t("The crop could not be saved", "تعذر حفظ الاقتصاص"));
                finished.current = true;
                lease.current?.finish(operations);
                p.onClose();
              } catch (e) {
                if (active.current) {
                  setError(describe(e));
                  setSaving(false);
                }
              }
            }}
          >
            {t("Apply edits", "تطبيق التعديلات")}
          </Button>
        </>
      }
    >
      <div dir={p.arabic ? "rtl" : "ltr"}>
        {asset && (
          <CropSource
            scene={sourceScene}
            crop={crop}
            width={asset.width}
            height={asset.height}
            enabled={enabled}
            onChange={setCrop}
            arabic={p.arabic}
          />
        )}
        <p className="drawing-selection-help">
          {t(
            "Drag the crop area or its edges. Arrow keys move one source pixel; Shift moves10. The original file remains intact.",
            "اسحب منطقة الاقتصاص أو حدودها. الأسهم تحرّك بكسلًا واحدًا من الأصل، ومع Shift تتحرك10 بكسلات. يبقى الملف الأصلي محفوظًا.",
          )}
        </p>
        <fieldset disabled={!enabled} className="drawing-crop-fields">
          {number("x", "Source X", "بداية أفقية")}
          {number("y", "Source Y", "بداية رأسية")}
          {number("w", "Source width", "عرض المصدر")}
          {number("h", "Source height", "ارتفاع المصدر")}
          <label className="drawing-field">
            <span>{t("Result geometry", "أبعاد النتيجة")}</span>
            <select value={mode} onChange={(e) => setMode(e.target.value as CropMode)}>
              <option value="trim">{t("Trim at original pixel density", "قص مع الحفاظ على كثافة البكسلات")}</option>
              <option value="fit">{t("Fit crop into current display box", "ملء أبعاد العنصر الحالية بالجزء المقصوص")}</option>
            </select>
          </label>
          <Button size="compact" onClick={() => asset && setCrop({ x: 0, y: 0, w: asset.width, h: asset.height })}>
            {t("Full original", "الأصل كاملًا")}
          </Button>
        </fieldset>
        <fieldset disabled={!enabled} className="drawing-crop-fields">
          <label className="drawing-field">
            <span>{t("Draft adjustment", "إضافة تأثير للمعاينة")}</span>
            <select
              value=""
              onChange={(e) => {
                const kind = e.target.value as DrawingNode["effects"][number]["kind"];
                if (kind) {
                  setEffects((current) => [
                    ...current,
                    {
                      id: id(),
                      kind,
                      amount: ["blur", "pixelate"].includes(kind) ? 6 : ["grayscale", "invert"].includes(kind) ? 1 : 0.1,
                      enabled: true,
                    },
                  ]);
                  setCompare("effects");
                }
              }}
            >
              <option value="">{t("Choose adjustment", "اختر تأثيرًا")}</option>
              {(["brightness", "contrast", "saturation", "temperature", "grayscale", "invert", "blur", "sharpen", "pixelate"] as const).map(
                (kind) => (
                  <option value={kind} key={kind}>
                    {p.arabic
                      ? (
                          {
                            brightness: "السطوع",
                            contrast: "التباين",
                            saturation: "التشبع",
                            temperature: "الحرارة",
                            grayscale: "تدرج رمادي",
                            invert: "عكس الألوان",
                            blur: "ضبابية",
                            sharpen: "حدة",
                            pixelate: "بكسلة",
                          } as const
                        )[kind]
                      : kind}
                  </option>
                ),
              )}
            </select>
          </label>
          {effects.map((effect, index) => (
            <div className="drawing-effect" key={effect.id}>
              <label className="drawing-check">
                <input
                  type="checkbox"
                  checked={effect.enabled}
                  onChange={(e) =>
                    setEffects((current) => current.map((item) => (item.id === effect.id ? { ...item, enabled: e.target.checked } : item)))
                  }
                />
                {effect.kind}
                {effect.maskId && t(" (mask retained)", " (القناع محفوظ)")}
              </label>
              <label className="drawing-field">
                <span>{t("Amount", "القيمة")}</span>
                <input
                  type="range"
                  min={["brightness", "contrast", "saturation", "temperature"].includes(effect.kind) ? -1 : 0}
                  max={["blur", "pixelate"].includes(effect.kind) ? 64 : 1}
                  step="0.01"
                  value={effect.amount}
                  onChange={(e) =>
                    setEffects((current) =>
                      current.map((item) => (item.id === effect.id ? { ...item, amount: Number(e.target.value) } : item)),
                    )
                  }
                />
                <output>{effect.amount.toFixed(2)}</output>
              </label>
              <Button
                size="compact"
                disabled={index === 0}
                onClick={() =>
                  setEffects((current) => {
                    const next = [...current];
                    [next[index - 1], next[index]] = [next[index], next[index - 1]];
                    return next;
                  })
                }
              >
                {t("Move up", "للأعلى")}
              </Button>
              <Button
                size="compact"
                disabled={index === effects.length - 1}
                onClick={() =>
                  setEffects((current) => {
                    const next = [...current];
                    [next[index], next[index + 1]] = [next[index + 1], next[index]];
                    return next;
                  })
                }
              >
                {t("Move down", "للأسفل")}
              </Button>
              <Button size="compact" onClick={() => setEffects((current) => current.filter((item) => item.id !== effect.id))}>
                {t("Remove", "حذف")}
              </Button>
            </div>
          ))}
        </fieldset>
        <label className="drawing-field">
          <span>{t("Compare", "المقارنة")}</span>
          <select value={compare} onChange={(e) => setCompare(e.target.value as typeof compare)}>
            <option value="crop">{t("Before and after cropping", "قبل الاقتصاص وبعده")}</option>
            <option value="effects">{t("Without and with image effects", "دون تأثيرات الصورة ومعها")}</option>
          </select>
        </label>
        <div className="drawing-crop-comparison">
          <section>
            <h3>{t("Before", "قبل")}</h3>
            <DrawingScenePreview scene={beforeScene} camera={camera} label={t("Before image edit", "قبل تعديل الصورة")} />
          </section>
          <section>
            <h3>{t("After", "بعد")}</h3>
            <DrawingScenePreview scene={afterScene} camera={camera} label={t("After image edit", "بعد تعديل الصورة")} />
          </section>
        </div>
        {waiting && <p role="status">{t("Reserving image", "جارٍ حجز الصورة")}</p>}
        {lost && (
          <p role="alert">
            {t("The image reservation is unavailable. Cancel and reopen.", "حجز الصورة غير متاح. ألغِ المعاينة وافتحها مجددًا.")}
          </p>
        )}
        {!saving && (error || result.error) && <p role="alert">{error || result.error}</p>}
      </div>
    </Modal>
  );
}
