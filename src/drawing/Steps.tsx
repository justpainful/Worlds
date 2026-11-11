import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { Button } from "../ui/Button";
import { id, type Change, type DrawingScene, type Step } from "./model";
import { DrawingRenderer, type Viewport } from "./renderer";
import { createZip } from "./archive";
import { saveDrawingBlob } from "./files";
import type { DrawingSession } from "./session";
import type { DrawingExportScene } from "./exportPolicy";
import { canDrawingExport } from "./exportPolicy";
import { useDrawingExportPolicy } from "./exportAccess";
import { accountApi } from "../account/api";

export function StepsPanel({
  scene,
  view,
  frameId,
  selected,
  canEdit,
  arabic,
  session,
  commit,
}: {
  scene: DrawingScene;
  view: Viewport;
  frameId: string;
  selected: string[];
  canEdit: boolean;
  arabic: boolean;
  session: DrawingSession;
  commit: (label: string, changes: Change[]) => void;
}) {
  const [presenting, setPresenting] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [committingExport, setCommittingExport] = useState(false);
  const exportAbort = useRef<AbortController | null>(null);
  const exportCommitting = useRef(false);
  useEffect(
    () => () => {
      if (!exportCommitting.current) exportAbort.current?.abort();
    },
    [],
  );
  const t = (en: string, ar: string) => (arabic ? ar : en);
  const exportPolicy = useDrawingExportPolicy(session.pageId),
    canExport = !!exportPolicy.info && !exportPolicy.error && canDrawingExport(exportPolicy.info.policy, exportPolicy.info.level, "images");
  const patch = (step: Step, fields: Partial<Step>) =>
    commit("Edit presentation step", [{ type: "patch", collection: "steps", id: step.id, fields }]);
  const move = (index: number, delta: number) => {
    const ids = [...scene.stepOrder],
      next = index + delta;
    if (next < 0 || next >= ids.length) return;
    [ids[index], ids[next]] = [ids[next], ids[index]];
    commit("Reorder steps", [{ type: "order", list: "stepOrder", ids }]);
  };
  const pin = async () => {
    try {
      setBusy(true);
      setError(null);
      await session.flush();
      const source = session.snapshot();
      if (source.pending || !source.document)
        throw new Error(t("Save the drawing before pinning its presentation", "احفظ الرسم قبل تثبيت العرض"));
      const version = await api.drawingVersionSave(session.pageId, "Presentation snapshot");
      const current = session.snapshot().document;
      if (!current || current.revision !== source.document.revision)
        throw new Error(
          t(
            "The drawing changed while pinning. Review the steps and try again.",
            "تغيّر الرسم أثناء تثبيت الإصدار. راجع الخطوات وحاول مجددًا.",
          ),
        );
      commit(
        "Pin presentation version",
        current.scene.stepOrder.map((id): Change => ({ type: "patch", collection: "steps", id, fields: { pinnedVersionId: version.id } })),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const exportSteps = async () => {
    setBusy(true);
    setError(null);
    const renderer = new DrawingRenderer(),
      controller = new AbortController();
    exportAbort.current = controller;
    const cancelRenderer = () => renderer.dispose();
    controller.signal.addEventListener("abort", cancelRenderer, { once: true });
    const check = () => {
      if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
    };
    try {
      const draft = structuredClone(scene),
        snapshots = new Map<string, DrawingScene>(),
        contexts = new Map<string, DrawingExportScene>();
      const entries: { name: string; blob: Blob }[] = [];
      let contextBytes = 0,
        imageBytes = 0;
      for (let i = 0; i < scene.stepOrder.length; i++) {
        check();
        const step = scene.steps[scene.stepOrder[i]];
        if (step.pinnedVersionId && !snapshots.has(step.pinnedVersionId))
          snapshots.set(step.pinnedVersionId, await api.drawingVersionScene(session.pageId, step.pinnedVersionId));
        check();
        const snapshot = step.pinnedVersionId ? snapshots.get(step.pinnedVersionId)! : draft;
        if (!snapshot.frames[step.frameId]) throw new Error("This step's frame is missing from its pinned version");
        const imageScene = {
          ...snapshot,
          nodes: Object.fromEntries(
            Object.entries(snapshot.nodes).map(([id, node]) => [
              id,
              { ...node, visible: node.visible && !step.hiddenNodeIds.includes(id) },
            ]),
          ),
        };
        const frame = { ...snapshot.frames[step.frameId], ...step.camera };
        const key = JSON.stringify([step.pinnedVersionId ?? "draft", step.frameId, step.camera, [...step.hiddenNodeIds].sort()]);
        if (!contexts.has(key)) {
          // The source snapshots are already isolated. Keep their immutable
          // references rather than cloning every complete drawing a second time.
          const context: DrawingExportScene = { scene: imageScene, frameId: step.frameId, region: { ...step.camera } };
          contextBytes += new Blob([JSON.stringify(context)]).size + 1;
          if (contextBytes > 64 * 1024 * 1024) throw new Error("The export context exceeds its memory limit");
          contexts.set(key, context);
        }
        const blob = await renderer.exportFrame(imageScene, frame, 1);
        imageBytes += blob.size;
        if (imageBytes > 256 * 1024 * 1024) throw new Error("The frame archive exceeds 256 MiB");
        entries.push({
          name: `${String(i + 1).padStart(3, "0")}-${step.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "Step"}.png`,
          blob,
        });
      }
      const archive = await createZip(entries, controller.signal);
      check();
      await saveDrawingBlob(
        archive,
        "Drawing steps.zip",
        { pageId: session.pageId, kind: "images", scenes: [...contexts.values()] },
        controller.signal,
        () => {
          exportCommitting.current = true;
          setCommittingExport(true);
        },
      );
    } catch (e) {
      if (!controller.signal.aborted) setError(errorMessage(e));
    } finally {
      controller.signal.removeEventListener("abort", cancelRenderer);
      renderer.dispose();
      if (exportAbort.current === controller) exportAbort.current = null;
      exportCommitting.current = false;
      setCommittingExport(false);
      setBusy(false);
    }
  };
  return (
    <div className="drawing-steps">
      {exportPolicy.error && <p role="alert">{exportPolicy.error}</p>}
      {exportPolicy.info && !canExport && (
        <p role="status">{t("Your current permission does not allow image exports.", "صلاحيتك الحالية لا تسمح بتصدير الصور.")}</p>
      )}
      <Button
        size="compact"
        icon="add"
        disabled={!canEdit}
        onClick={() => {
          const step: Step = {
            id: id(),
            title: t(`Step ${scene.stepOrder.length + 1}`, `خطوة ${scene.stepOrder.length + 1}`),
            body: "",
            frameId,
            camera: { x: view.x, y: view.y, w: view.w, h: view.h },
            hiddenNodeIds: [],
            transition: "cut",
            duration: null,
          };
          commit("Add presentation step", [
            { type: "put", collection: "steps", id: step.id, value: step },
            { type: "order", list: "stepOrder", ids: [...scene.stepOrder, step.id] },
          ]);
        }}
      >
        {t("Capture current view", "حفظ العرض كخطوة")}
      </Button>
      {scene.stepOrder.map((id, index) => {
        const step = scene.steps[id];
        return (
          <section className="drawing-step" key={id}>
            <label>
              {t("Title", "العنوان")}
              <input value={step.title} disabled={!canEdit} onChange={(e) => patch(step, { title: e.target.value })} />
            </label>
            <label>
              {t("Description", "الوصف")}
              <textarea dir="auto" value={step.body} disabled={!canEdit} onChange={(e) => patch(step, { body: e.target.value })} />
            </label>
            <label>
              {t("Transition", "الانتقال")}
              <select
                value={step.transition}
                disabled={!canEdit}
                onChange={(e) => patch(step, { transition: e.target.value as Step["transition"] })}
              >
                <option value="cut">{t("Cut", "مباشر")}</option>
                <option value="fade">{t("Fade", "تلاشي")}</option>
              </select>
            </label>
            <label>
              {t("Auto advance seconds (0 = manual)", "الانتقال بعد ثوانٍ (0 = يدوي)")}
              <input
                type="number"
                min={0}
                max={600}
                value={step.duration ?? 0}
                disabled={!canEdit}
                onChange={(e) => patch(step, { duration: Math.max(0, Math.min(600, Number(e.target.value))) || null })}
              />
            </label>
            <div className="drawing-step-actions">
              <Button
                size="compact"
                disabled={!canEdit}
                onClick={() => patch(step, { camera: { x: view.x, y: view.y, w: view.w, h: view.h }, frameId })}
              >
                {t("Update view", "تحديث العرض")}
              </Button>
              <Button
                size="compact"
                disabled={!canEdit || !selected.length}
                onClick={() => patch(step, { hiddenNodeIds: [...new Set([...step.hiddenNodeIds, ...selected])] })}
              >
                {t("Hide selected here", "إخفاء المحدد هنا")}
              </Button>
              <Button size="compact" disabled={!canEdit} onClick={() => patch(step, { hiddenNodeIds: [] })}>
                {t("Show all here", "إظهار الكل هنا")}
              </Button>
              <Button size="compact" disabled={!canEdit || index === 0} onClick={() => move(index, -1)}>
                {t("Up", "للأعلى")}
              </Button>
              <Button size="compact" disabled={!canEdit || index === scene.stepOrder.length - 1} onClick={() => move(index, 1)}>
                {t("Down", "للأسفل")}
              </Button>
              <Button
                size="compact"
                disabled={!canEdit}
                onClick={() => {
                  const copy = {
                    ...structuredClone(step),
                    id: id + "-" + crypto.randomUUID(),
                    title: `${step.title} (${t("copy", "نسخة")})`,
                  };
                  const ids = [...scene.stepOrder];
                  ids.splice(index + 1, 0, copy.id);
                  commit("Duplicate step", [
                    { type: "put", collection: "steps", id: copy.id, value: copy },
                    { type: "order", list: "stepOrder", ids },
                  ]);
                }}
              >
                {t("Duplicate", "نسخ")}
              </Button>
              <Button
                size="compact"
                disabled={!canEdit}
                onClick={() =>
                  commit("Remove step", [
                    { type: "remove", collection: "steps", id },
                    { type: "order", list: "stepOrder", ids: scene.stepOrder.filter((key) => key !== id) },
                  ])
                }
              >
                {t("Remove", "حذف")}
              </Button>
            </div>
          </section>
        );
      })}
      <div className="drawing-step-actions">
        <Button icon="play" disabled={!scene.stepOrder.length} onClick={() => setPresenting(true)}>
          {t("Present", "عرض")}
        </Button>
        <Button icon="download" loading={busy} disabled={!scene.stepOrder.length || !canExport} onClick={exportSteps}>
          {t("Export steps", "تصدير الخطوات")}
        </Button>
        <Button disabled={!canEdit || !scene.stepOrder.length} loading={busy} onClick={pin}>
          {t("Pin version", "تثبيت الإصدار")}
        </Button>
        <Button
          disabled={!canEdit}
          onClick={() =>
            commit(
              "Follow draft",
              scene.stepOrder.map((id): Change => ({ type: "patch", collection: "steps", id, fields: { pinnedVersionId: null } })),
            )
          }
        >
          {t("Follow draft", "متابعة المسودة")}
        </Button>
      </div>
      {busy && exportAbort.current && (
        <Button size="compact" disabled={committingExport} onClick={() => exportAbort.current?.abort()}>
          {t("Cancel export", "إلغاء التصدير")}
        </Button>
      )}
      {committingExport && <p role="status">{t("Finishing file save", "جارٍ إكمال حفظ الملف")}</p>}
      {error && <p role="alert">{error}</p>}
      {presenting && scene.stepOrder.length > 0 && (
        <DrawingPresentation scene={scene} pageId={session.pageId} arabic={arabic} onClose={() => setPresenting(false)} />
      )}
    </div>
  );
}

function DrawingPresentation({
  scene,
  pageId,
  arabic,
  onClose,
}: {
  scene: DrawingScene;
  pageId: string;
  arabic: boolean;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0),
    [pinned, setPinned] = useState<{ key: string; scene: DrawingScene } | null>(null),
    [error, setError] = useState<string | null>(null);
  const [access, setAccess] = useState<"checking" | "allowed" | "denied">("checking");
  const canvas = useRef<HTMLCanvasElement>(null),
    host = useRef<HTMLDivElement>(null),
    renderer = useRef<DrawingRenderer | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: innerWidth, h: innerHeight - 170 });
  const safeIndex = Math.max(0, Math.min(index, scene.stepOrder.length - 1)),
    step = scene.steps[scene.stepOrder[safeIndex]],
    reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const snapshotKey = step ? `${step.id}:${step.pinnedVersionId ?? "draft"}` : "",
    snapshot = step?.pinnedVersionId ? (pinned?.key === snapshotKey ? pinned.scene : null) : step ? scene : null;
  useEffect(() => {
    setIndex((value) => Math.max(0, Math.min(value, scene.stepOrder.length - 1)));
  }, [scene.stepOrder.length]);
  useEffect(() => {
    let alive = true,
      sequence = 0;
    const check = async () => {
      const request = ++sequence;
      try {
        const level = await accountApi.pageLevel(pageId);
        if (alive && request === sequence) setAccess(level === "none" ? "denied" : "allowed");
      } catch {
        if (alive && request === sequence) setAccess("denied");
      }
    };
    const changed = (event: Event) => {
      const rows = (event as CustomEvent<{ kind: string }[]>).detail ?? [];
      if (rows.some((row) => ["account", "page", "tree"].includes(row.kind))) void check();
    };
    setAccess("checking");
    void check();
    window.addEventListener("worlds:changed", changed);
    const timer = setInterval(() => void check(), 5000);
    return () => {
      alive = false;
      window.removeEventListener("worlds:changed", changed);
      clearInterval(timer);
    };
  }, [pageId]);
  useEffect(() => {
    const r = new DrawingRenderer();
    renderer.current = r;
    return () => r.dispose();
  }, []);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => before?.focus();
  }, []);
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (host.current) setSize({ w: host.current.clientWidth, h: host.current.clientHeight });
    });
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, [access]);
  useEffect(() => {
    let live = true;
    setError(null);
    setPinned(null);
    if (access === "allowed" && step?.pinnedVersionId)
      api.drawingVersionScene(pageId, step.pinnedVersionId).then(
        (s) => {
          if (live) setPinned({ key: snapshotKey, scene: s });
        },
        (e) => {
          if (live) setError(errorMessage(e));
        },
      );
    return () => {
      live = false;
    };
  }, [snapshotKey, step?.pinnedVersionId, pageId, access]);
  useEffect(() => {
    let live = true;
    const r = renderer.current;
    const draw = () => {
      if (!live || !r || !canvas.current || !snapshot || !step || access !== "allowed") return;
      try {
        if (!snapshot.frames[step.frameId])
          throw new Error(
            arabic ? "إطار هذه الخطوة غير موجود في الإصدار المحدد" : "This step's frame is missing from the selected version",
          );
        if (size.w <= 0 || size.h <= 0) return;
        const scale = Math.min(size.w / step.camera.w, size.h / step.camera.h),
          dpr = devicePixelRatio || 1;
        canvas.current.width = Math.ceil(size.w * dpr);
        canvas.current.height = Math.ceil(size.h * dpr);
        r.render(
          canvas.current,
          snapshot,
          {
            ...step.camera,
            x: step.camera.x - (size.w / scale - step.camera.w) / 2,
            y: step.camera.y - (size.h / scale - step.camera.h) / 2,
            scale: scale * dpr,
          },
          { frameId: step.frameId, hiddenNodeIds: step.hiddenNodeIds },
        );
        setError((previous) => (previous ? null : previous));
      } catch (e) {
        canvas.current.getContext("2d")?.clearRect(0, 0, canvas.current.width, canvas.current.height);
        setError(errorMessage(e));
      }
    };
    if (r && snapshot && access === "allowed") {
      r.onAssetChange = draw;
      void r
        .prepare(snapshot)
        .then(draw)
        .catch((e) => {
          if (live) setError(errorMessage(e));
        });
    }
    return () => {
      live = false;
    };
  }, [snapshot, step, size, access]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (access !== "allowed" || e.isComposing || e.defaultPrevented) return;
      const target = e.target as Element | null;
      if (
        target?.closest?.(
          'button,input,select,textarea,a[href],[contenteditable]:not([contenteditable="false"]),[role="button"],[role="listbox"],[role="slider"]',
        )
      )
        return;
      if (["ArrowRight", "PageDown", " "].includes(e.key)) {
        e.preventDefault();
        setIndex((i) => Math.min(scene.stepOrder.length - 1, i + 1));
      }
      if (["ArrowLeft", "PageUp"].includes(e.key)) {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [scene.stepOrder.length, onClose, access]);
  useEffect(() => {
    if (!step?.duration || !snapshot || error || access !== "allowed") return;
    const timer = setTimeout(() => setIndex((i) => Math.min(scene.stepOrder.length - 1, i + 1)), step.duration * 1000);
    return () => clearTimeout(timer);
  }, [step, scene.stepOrder.length, snapshot, access, error]);
  return (
    <div
      ref={dialog}
      tabIndex={-1}
      dir={arabic ? "rtl" : "ltr"}
      className="drawing-presentation"
      role="dialog"
      aria-modal="true"
      aria-label={arabic ? "عرض الشرح" : "Drawing presentation"}
    >
      <header>
        <h2>{access === "allowed" && step ? step.title : arabic ? "عرض الشرح" : "Drawing presentation"}</h2>
        <Button onClick={onClose}>{arabic ? "إغلاق" : "Close"}</Button>
      </header>
      {access !== "allowed" ? (
        <p role="status">
          {access === "checking"
            ? arabic
              ? "جارٍ التحقق من الوصول"
              : "Checking access"
            : arabic
              ? "تعذر الوصول إلى هذا الرسم"
              : "This drawing is unavailable"}
        </p>
      ) : !step ? (
        <p role="status">{arabic ? "لا توجد خطوات للعرض" : "There are no steps to present"}</p>
      ) : (
        <>
          <div ref={host} className={`drawing-presentation-stage ${!reducedMotion && step.transition === "fade" ? "fade" : ""}`}>
            <canvas ref={canvas} key={snapshotKey} />
            {!snapshot && !error && <p role="status">{arabic ? "جارٍ تحميل الإصدار" : "Loading version"}</p>}
          </div>
          <p dir="auto">{step.body}</p>
          {error && <p role="alert">{error}</p>}
          <footer>
            <Button disabled={!safeIndex} onClick={() => setIndex(safeIndex - 1)}>
              {arabic ? "السابق" : "Previous"}
            </Button>
            <select aria-label={arabic ? "الخطوة" : "Step"} value={safeIndex} onChange={(e) => setIndex(Number(e.target.value))}>
              {scene.stepOrder.map((id, i) => (
                <option key={id} value={i}>
                  {i + 1}. {scene.steps[id].title}
                </option>
              ))}
            </select>
            <Button disabled={safeIndex === scene.stepOrder.length - 1} onClick={() => setIndex(safeIndex + 1)}>
              {arabic ? "التالي" : "Next"}
            </Button>
          </footer>
        </>
      )}
    </div>
  );
}
