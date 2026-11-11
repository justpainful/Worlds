import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";
import type { PageMeta } from "../lib/types";
import { useStore } from "../state/store";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { bounds, localToWorld } from "./geometry";
import { id, newNode, type Change, type DrawingNode, type DrawingScene, type Rect } from "./model";
import { sceneChanges } from "./operations";
import type { DrawingSession } from "./session";
import { readDrawingReference, searchDrawingReferences, type ReferencePreview } from "./references";
import { referenceNodeKey, referenceSourceKey, referenceSnapshot } from "./referenceLayout";
import { ReferenceLayoutDialog } from "./ReferenceLayoutDialog";
import { beginDrawingGesture } from "./syncManager";
import type { DrawingGestureLease } from "./gestureLeases";

interface Props {
  session: DrawingSession;
  scene: DrawingScene;
  frameId: string;
  layerId: string;
  selected: string[];
  canEdit: boolean;
  arabic: boolean;
  commit: (label: string, changes: Change[], guard?: undefined, strictBase?: boolean) => string | null | void;
  onSelect: (ids: string[]) => void;
}
export function ReferencesPanel({ session, scene, frameId, layerId, selected, canEdit, arabic, commit, onSelect }: Props) {
  const [layout, setLayout] = useState<{ node: DrawingNode; data: ReferencePreview; scene: DrawingScene } | null>(null);
  const active = useRef(true),
    reservation = useRef<DrawingGestureLease | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      reservation.current?.cancel();
    };
  }, []);
  const [query, setQuery] = useState(""),
    [pages, setPages] = useState<PageMeta[]>([]),
    [picker, setPicker] = useState<"link" | "relink" | "embed" | null>(null);
  const [preview, setPreview] = useState<ReferencePreview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [taskTitle, setTaskTitle] = useState<string | null>(null),
    [pinEmbed, setPinEmbed] = useState(false);
  const t = (en: string, ar: string) => (arabic ? ar : en),
    reference = selected.map((key) => scene.nodes[key]).find((n) => n?.kind === "reference");
  useEffect(() => {
    if (!picker) return;
    let active = true,
      generation = 0;
    const refresh = async () => {
      const request = ++generation;
      setPages([]);
      try {
        const rows = await searchDrawingReferences(query, picker === "embed");
        if (active && request === generation) setPages(rows.filter((p) => p.id !== session.pageId));
      } catch (e) {
        if (active && request === generation) setError(errorMessage(e));
      }
    };
    const timer = setTimeout(() => void refresh(), 120),
      poll = setInterval(() => void refresh(), 15000),
      invalidate = () => void refresh();
    window.addEventListener("offline", invalidate);
    window.addEventListener("online", invalidate);
    window.addEventListener("focus", invalidate);
    return () => {
      active = false;
      clearTimeout(timer);
      clearInterval(poll);
      window.removeEventListener("offline", invalidate);
      window.removeEventListener("online", invalidate);
      window.removeEventListener("focus", invalidate);
    };
  }, [query, picker, session.pageId]);
  useEffect(() => {
    let active = true,
      running = false,
      generation = 0;
    setPreview(null);
    if (!reference?.sourceId) return;
    const refresh = async (force = false) => {
      if (running && !force) return;
      running = true;
      const request = ++generation;
      setPreview((old) => ({
        state: "loading",
        checkedAt: Date.now(),
        lastReadyAt: old?.state === "ready" ? old.checkedAt : old?.lastReadyAt,
        lastUpdatedAt: old?.state === "ready" ? old.updatedAt : old?.lastUpdatedAt,
      }));
      try {
        const value = await readDrawingReference(reference.sourceId!);
        if (active && request === generation)
          setPreview((old) =>
            value.state === "ready"
              ? value
              : { state: value.state, checkedAt: value.checkedAt, lastReadyAt: old?.lastReadyAt, lastUpdatedAt: old?.lastUpdatedAt },
          );
      } finally {
        if (request === generation) running = false;
      }
    };
    const invalidate = () => void refresh(true);
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    window.addEventListener("offline", invalidate);
    window.addEventListener("online", invalidate);
    window.addEventListener("focus", invalidate);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("offline", invalidate);
      window.removeEventListener("online", invalidate);
      window.removeEventListener("focus", invalidate);
    };
  }, [reference?.id, reference?.sourceId]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (active.current) setError(errorMessage(e));
    } finally {
      if (active.current) setBusy(false);
    }
  };
  const changeReference = async (node: DrawingNode, label: string, work: (current: DrawingScene) => Promise<Change[]>) => {
    const initial = session.snapshot().document!.scene;
    if (JSON.stringify(initial.nodes[node.id]) !== JSON.stringify(node))
      throw Error(t("The link changed. Try again.", "تغيّر الارتباط. أعد المحاولة."));
    const before = referenceNodeKey(initial, node.id);
    let finished = false;
    try {
      reservation.current = await beginDrawingGesture(session.pageId, [node.id]);
      if (!active.current || reservation.current?.state() === "lost") throw Error(t("The reservation was lost", "فُقد حجز العنصر"));
      const current = session.snapshot().document!.scene;
      if (referenceNodeKey(current, node.id) !== before) throw Error(t("The link changed. Try again.", "تغيّر الارتباط. أعد المحاولة."));
      const changes = await work(current);
      if (
        !active.current ||
        reservation.current?.state() === "lost" ||
        referenceNodeKey(session.snapshot().document!.scene, node.id) !== before
      )
        throw Error(t("The link changed. Try again.", "تغيّر الارتباط. أعد المحاولة."));
      const operation = commit(label, changes, undefined, true);
      if (!operation) throw Error(t("The change could not be saved", "تعذر حفظ التغيير"));
      await session.flush();
      if (session.snapshot().error) throw Error(session.snapshot().error!);
      reservation.current?.finish([operation]);
      finished = true;
    } finally {
      if (!finished) reservation.current?.cancel();
      reservation.current = null;
    }
  };
  const region = (): { frameId: string; camera: Rect } => {
    const current = session.snapshot().document!.scene,
      nodes = selected.map((key) => current.nodes[key]).filter(Boolean),
      selectedFrame = nodes[0]?.frameId && nodes.every((n) => n.frameId === nodes[0].frameId) ? nodes[0].frameId : frameId;
    const f = current.frames[selectedFrame] ?? current.frames[current.defaultFrameId];
    return {
      frameId: f.id,
      camera: nodes.length
        ? bounds(
            nodes.flatMap((n) =>
              [
                { x: 0, y: 0 },
                { x: n.w, y: 0 },
                { x: n.w, y: n.h },
                { x: 0, y: n.h },
              ].map((p) => localToWorld(n, p)),
            ),
            24,
          )
        : { x: f.x, y: f.y, w: f.w, h: f.h },
    };
  };
  const card = (sourceId: string, camera: Rect, frame: string): DrawingNode => {
    const f = session.snapshot().document!.scene.frames[frame],
      w = Math.min(360, f.w),
      h = Math.min(200, f.h),
      node = newNode("reference", layerId, frame, {
        x: Math.max(f.x, Math.min(f.x + f.w - w, camera.x + camera.w + 30)),
        y: Math.max(f.y, Math.min(f.y + f.h - h, camera.y)),
        w,
        h,
      });
    node.sourceId = sourceId;
    node.sourceMode = "live";
    node.name = t("Linked resource", "مصدر مرتبط");
    node.textStyle.direction = arabic ? "rtl" : "auto";
    node.paint.fill = "#f6f6f6";
    return node;
  };
  const choose = (page: PageMeta) =>
    run(async () => {
      const access = await readDrawingReference(page.id);
      if (access.state !== "ready") throw new Error(t("The source is unavailable", "المصدر غير متاح"));
      if (picker === "embed") {
        await session.flush();
        if (session.snapshot().pending) throw new Error(t("Save the drawing first", "احفظ الرسم أولًا"));
        const r = region(),
          source = session.snapshot().document,
          pin = pinEmbed ? await api.drawingVersionSave(session.pageId, t("Embedded frame", "إطار مضمّن")) : undefined;
        if (pin && (!source || session.snapshot().document?.revision !== source.revision))
          throw new Error(
            t("The drawing changed while preparing the pinned frame. Try again.", "تغيّر الرسم أثناء إعداد الإطار المثبّت. حاول مجددًا."),
          );
        await api.drawingEmbedInsert(session.pageId, page.id, r.frameId, r.camera, pin?.id);
        useStore
          .getState()
          .toast({
            message: t("Drawing embedded in page", "تم تضمين الرسم في الصفحة"),
            tone: "success",
            action: { label: t("Open", "فتح"), run: () => useStore.getState().openPage(page.id, "tab") },
          });
      } else {
        const current = session.snapshot().document!.scene;
        if (picker === "relink") {
          if (!reference || !current.nodes[reference.id])
            throw new Error(t("The linked element no longer exists. Select it again.", "لم يعد العنصر المرتبط موجودًا. حدده مجددًا."));
          await changeReference(reference, "Relink source", async () => {
            if ((await readDrawingReference(page.id)).state !== "ready") throw Error(t("Source unavailable", "المصدر غير متاح"));
            return [
              {
                type: "patch",
                collection: "nodes",
                id: reference.id,
                fields: {
                  sourceId: page.id,
                  sourceMode: "live",
                  sourceTitle: null,
                  sourceUpdatedAt: null,
                  referenceSnapshot: null,
                  assetId: null,
                },
              },
            ];
          });
        } else {
          const f = current.frames[frameId];
          if (!f) throw new Error(t("The frame is no longer available", "الإطار لم يعد متاحًا"));
          const node = card(page.id, { x: f.x + 30, y: f.y + 30, w: 0, h: 0 }, f.id);
          const operation = commit(
            "Link Worlds resource",
            [
              { type: "put", collection: "nodes", id: node.id, value: node },
              { type: "order", list: "nodeOrder", ids: [...current.nodeOrder, node.id] },
            ],
            undefined,
            true,
          );
          if (!operation) throw new Error(t("The link could not be added to this drawing", "تعذرت إضافة الرابط إلى الرسم"));
          onSelect([node.id]);
        }
      }
      setPicker(null);
    });
  const freeze = () =>
    run(async () => {
      if (!reference?.sourceId) return;
      await changeReference(reference, "Freeze linked source snapshot", async (current) => {
        const data = await readDrawingReference(reference.sourceId!);
        if (data.state !== "ready") throw Error(t("Source unavailable", "المصدر غير متاح"));
        let owned = structuredClone(current),
          assetId: string | null = null;
        if (data.imageAttachmentId) {
          assetId = id();
          owned.assets[assetId] = {
            id: assetId,
            attachmentId: data.imageAttachmentId,
            name: data.title ?? "Snapshot",
            mime: data.imageMime ?? "image/png",
            width: data.imageWidth ?? 1,
            height: data.imageHeight ?? 1,
          };
          owned = await api.drawingMaterializeAssets(session.pageId, owned);
        }
        const latest = await readDrawingReference(reference.sourceId!);
        if (latest.state !== "ready" || referenceSourceKey(latest) !== referenceSourceKey(data))
          throw Error(t("The source changed while copying. Try again.", "تغيّر المصدر أثناء النسخ. أعد المحاولة."));
        Object.assign(owned.nodes[reference.id], {
          sourceMode: "snapshot",
          referenceSnapshot: referenceSnapshot(data),
          sourceUpdatedAt: data.updatedAt,
          assetId,
        });
        return sceneChanges(current, owned);
      });
    });
  const followLive = () =>
    run(async () => {
      if (!reference?.sourceId) return;
      await changeReference(reference, "Follow live source", async () => {
        if ((await readDrawingReference(reference.sourceId!)).state !== "ready")
          throw Error(t("Source unavailable. Relink the snapshot to an accessible source.", "المصدر غير متاح. اربط اللقطة بمصدر متاح."));
        return [
          {
            type: "patch",
            collection: "nodes",
            id: reference.id,
            fields: { sourceMode: "live", referenceSnapshot: null, sourceTitle: null, sourceUpdatedAt: null, assetId: null },
          },
        ];
      });
    });
  const createTask = () =>
    run(async () => {
      if (!taskTitle?.trim()) return;
      await session.flush();
      if (session.snapshot().pending) throw new Error(t("Save this drawing first", "احفظ الرسم أولًا"));
      const r = region(),
        source = session.snapshot().document,
        page = await api.drawingReferenceTask(session.pageId, r.frameId, r.camera, taskTitle.trim());
      useStore.getState().patchPageLocal(page);
      if (active.current) setTaskTitle(null);
      const openTask = { label: t("Open task", "فتح المهمة"), run: () => useStore.getState().openPage(page.id, "tab") };
      try {
        const currentDocument = session.snapshot().document;
        if (
          !active.current ||
          !source ||
          !currentDocument ||
          currentDocument.revision !== source.revision ||
          !currentDocument.scene.frames[r.frameId] ||
          !currentDocument.scene.layers[layerId]
        )
          throw new Error("stale");
        const current = currentDocument.scene,
          node = card(page.id, r.camera, r.frameId),
          arrow = newNode("shape", layerId, r.frameId, { x: r.camera.x, y: r.camera.y + r.camera.h / 2, w: r.camera.w + 30, h: 1 });
        const group = id();
        node.annotationGroup = group;
        arrow.annotationGroup = group;
        arrow.shape = "arrow";
        arrow.name = t("Task region", "منطقة المهمة");
        arrow.anchor = {
          nodeId: selected.length === 1 ? selected[0] : null,
          u: 1,
          v: 0.5,
          fallback: { x: r.camera.x + r.camera.w, y: r.camera.y + r.camera.h / 2 },
          region: r.camera,
        };
        arrow.endAnchor = { nodeId: node.id, u: 0, v: 0.5, fallback: { x: node.x, y: node.y + node.h / 2 } };
        const operation = commit(
          "Link region to Worlds task",
          [
            { type: "put", collection: "nodes", id: node.id, value: node },
            { type: "put", collection: "nodes", id: arrow.id, value: arrow },
            { type: "order", list: "nodeOrder", ids: [...current.nodeOrder, arrow.id, node.id] },
          ],
          undefined,
          true,
        );
        if (!operation) throw new Error("not linked");
        onSelect([node.id]);
      } catch {
        useStore
          .getState()
          .toast({
            message: t(
              "The task was created, but its link could not be added to the drawing.",
              "أُنشئت المهمة، لكن تعذرت إضافة رابطها إلى الرسم.",
            ),
            tone: "error",
            action: openTask,
          });
      }
    });
  return (
    <div className="drawing-references">
      <div className="drawing-step-actions">
        <Button
          icon="link"
          disabled={!canEdit || busy}
          onClick={() => {
            setQuery("");
            setPages([]);
            setPicker("link");
          }}
        >
          {t("Link resource", "ربط مصدر")}
        </Button>
        <Button icon="checklist" disabled={!canEdit || busy} onClick={() => setTaskTitle("")}>
          {t("Region to task", "تحويل منطقة إلى مهمة")}
        </Button>
        <Button
          icon="pages"
          disabled={busy}
          onClick={() => {
            setQuery("");
            setPages([]);
            setPicker("embed");
          }}
        >
          {t("Embed in page", "تضمين في صفحة")}
        </Button>
      </div>
      {error && (
        <p role="alert" className="drawing-export-error">
          {error}
        </p>
      )}
      {reference && (
        <div className="drawing-step">
          <p>{reference.sourceMode === "snapshot" ? t("Frozen snapshot", "لقطة ثابتة") : t("Live link", "ارتباط مباشر")}</p>
          {reference.sourceMode === "snapshot" && preview?.state === "unavailable" && (
            <p role="status">
              {t("Source unavailable. The frozen copy remains available.", "المصدر غير متاح. تبقى اللقطة المثبتة متاحة.")}
            </p>
          )}
          {reference.sourceMode === "snapshot" && preview?.state === "offline" && (
            <p role="status">{t("Source offline. The frozen copy remains available.", "المصدر غير متصل. تبقى اللقطة المثبتة متاحة.")}</p>
          )}
          {reference.sourceMode === "snapshot" && preview?.state === "loading" && (
            <p role="status">{t("Checking original source access", "جارٍ التحقق من صلاحية المصدر الأصلي")}</p>
          )}
          <p dir="auto">
            {reference.sourceMode === "snapshot"
              ? reference.referenceSnapshot?.title
              : preview?.state === "ready"
                ? preview.title
                : preview?.state === "offline"
                  ? t("Offline, reconnect to check source", "غير متصل، اتصل للتحقق من المصدر")
                  : preview?.state === "loading"
                    ? t("Checking source access", "جارٍ التحقق من صلاحية المصدر")
                    : t("Source unavailable", "المصدر غير متاح")}
          </p>
          {preview?.lastReadyAt && preview.state !== "ready" && (
            <small>
              {t("Last successful check", "آخر تحقق ناجح")}: {new Date(preview.lastReadyAt).toLocaleString()}
            </small>
          )}
          {reference.sourceMode === "snapshot" && reference.referenceSnapshot?.checkedAt && (
            <small>
              {t("Snapshot captured", "وقت تثبيت اللقطة")}: {new Date(reference.referenceSnapshot.checkedAt).toLocaleString()}
            </small>
          )}
          {(reference.sourceMode === "snapshot"
            ? reference.referenceSnapshot?.updatedAt
            : preview?.state === "ready"
              ? preview.updatedAt
              : null) && (
            <small>
              {t("Source modified", "تعديل المصدر")}:{" "}
              {new Date(
                (reference.sourceMode === "snapshot" ? reference.referenceSnapshot?.updatedAt : preview?.updatedAt)!,
              ).toLocaleString()}
            </small>
          )}
          {preview?.checkedAt && (
            <small>
              {t("Checked", "آخر تحقق")}: {new Date(preview.checkedAt).toLocaleString()}
            </small>
          )}
          <div className="drawing-step-actions">
            {reference.sourceMode === "live" && (
              <Button
                disabled={!canEdit || busy || preview?.state !== "ready"}
                onClick={() => {
                  if (preview?.state === "ready") setLayout({ node: structuredClone(reference), data: preview, scene });
                }}
              >
                {t("Preview card layout", "معاينة تخطيط البطاقة")}
              </Button>
            )}
            <Button
              icon="openExternal"
              disabled={preview?.state !== "ready" || busy}
              onClick={() =>
                run(async () => {
                  if ((await readDrawingReference(reference.sourceId!)).state !== "ready")
                    throw new Error(t("Source unavailable", "المصدر غير متاح"));
                  useStore.getState().openPage(reference.sourceId!, "tab");
                })
              }
            >
              {t("Open source", "فتح المصدر")}
            </Button>
            <Button
              disabled={!canEdit || busy}
              onClick={() => {
                setQuery("");
                setPages([]);
                setPicker("relink");
              }}
            >
              {t("Relink", "تغيير المصدر")}
            </Button>
            {reference.sourceMode === "snapshot" ? (
              <Button disabled={!canEdit || busy} onClick={followLive}>
                {t("Follow live source", "متابعة المصدر مباشرة")}
              </Button>
            ) : (
              <Button disabled={!canEdit || preview?.state !== "ready" || busy} onClick={freeze}>
                {t("Freeze snapshot", "تثبيت لقطة")}
              </Button>
            )}
          </div>
          <p>
            {t(
              "Live previews follow source permissions. A frozen snapshot is copied into this drawing and visible to its viewers.",
              "المعاينة المباشرة تتبع صلاحية المصدر. اللقطة الثابتة تُنسخ داخل الرسم وتظهر لمن يستطيع عرضه.",
            )}
          </p>
        </div>
      )}
      {layout && (
        <ReferenceLayoutDialog
          session={session}
          scene={layout.scene}
          node={layout.node}
          data={layout.data}
          canEdit={canEdit}
          arabic={arabic}
          commit={commit}
          onClose={() => setLayout(null)}
        />
      )}
      {picker && (
        <Modal
          title={
            picker === "embed" ? t("Embed drawing in a page", "تضمين الرسم في صفحة") : t("Choose linked resource", "اختيار المصدر المرتبط")
          }
          onClose={() => {
            if (!busy) setPicker(null);
          }}
        >
          <div className="drawing-step">
            <label>
              {t("Search", "بحث")}
              <input autoFocus dir="auto" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            {picker === "embed" && (
              <label className="drawing-check">
                <input type="checkbox" checked={pinEmbed} disabled={!canEdit} onChange={(e) => setPinEmbed(e.target.checked)} />
                {t("Pin this revision", "تثبيت هذا الإصدار")}
              </label>
            )}
            {pages.map((page) => (
              <Button key={page.id} disabled={busy} onClick={() => choose(page)}>
                {page.title || t("Untitled", "بدون عنوان")}
              </Button>
            ))}
            {!pages.length && <p>{t("No accessible resources found", "لا توجد مصادر متاحة مطابقة")}</p>}
            {error && <p role="alert">{error}</p>}
          </div>
        </Modal>
      )}
      {taskTitle !== null && (
        <Modal
          title={t("Task for the selected region", "مهمة للمنطقة المحددة")}
          onClose={() => {
            if (!busy) setTaskTitle(null);
          }}
          footer={
            <Button variant="tinted" loading={busy} disabled={!taskTitle.trim()} onClick={createTask}>
              {t("Create linked task", "إنشاء مهمة مرتبطة")}
            </Button>
          }
        >
          <div className="drawing-step">
            <label>
              {t("Task title", "عنوان المهمة")}
              <input autoFocus dir="auto" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
            </label>
            <p>
              {t(
                "Uses the selected artwork, or the current frame when nothing is selected. The task includes a drawing preview and a return link to this region.",
                "يستخدم العناصر المحددة، أو الإطار الحالي إذا لم تحدد عناصر. تتضمن المهمة معاينة للرسم ورابط عودة إلى المنطقة.",
              )}
            </p>
            {error && <p role="alert">{error}</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}
