import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, errorMessage } from "../../lib/api";
import type { Page } from "../../lib/types";
import { useStore } from "../../state/store";
import { Glass } from "../../glass/Glass";
import { LAYER } from "../../glass/materials";
import { Button } from "../../ui/Button";
import { Icon, type IconName } from "../../ui/Icon";
import { menuAt, type MenuItem } from "../../ui/Menu";
import { EmptyState, Spinner } from "../../ui/misc";
import { Canvas } from "../deck/Canvas";
import { Navigator } from "../deck/Navigator";
import { Present } from "../deck/Present";
import {
  applyLayout,
  BACKGROUNDS,
  LAYOUTS,
  newId,
  newSlide,
  slideFromBlock,
  slideToBlock,
  STAGE_H,
  STAGE_W,
  THEME,
  type LayoutId,
  type ShapeKind,
  type Slide,
  type SlideElement,
} from "../deck/model";
import { ResourceHeader, useResource } from "./ResourceHeader";

const SWATCHES = ["#f4f2ee", "#16161a", "#d2a46e", "#e5484d", "#f76b15", "#ffc53d", "#46a758", "#0090ff", "#8e4ec6", "#d6409f", "#8b8d98"];
const SIZES = [14, 18, 20, 24, 28, 32, 40, 48, 56, 64, 76, 96, 120];

/** A presentation: its own editor with a slide navigator, a canvas, notes and present mode. */
export function PresentationView({ id }: { id: string }) {
  const meta = useStore((s) => s.pages[id]);
  const { page, error } = useResource(id);
  if (error) return <EmptyState icon="warning" title="This presentation could not be opened" text={error} />;
  if (!page || !meta) return <div className="page-loading"><Spinner /></div>;
  return <Deck key={id} page={page} />;
}

function readSlides(page: Page): Slide[] {
  return page.blocks.filter((b) => b.content.type === "slide").map((b) => slideFromBlock(b.id, b.content));
}

function Deck({ page }: { page: Page }) {
  const id = page.id;
  const meta = useStore((s) => s.pages[id]) ?? page;
  const toast = useStore((s) => s.toast);
  const [slides, setSlides] = useState<Slide[]>(() => {
    const s = readSlides(page);
    return s.length ? s : [newSlide("title")];
  });
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [saving, setSaving] = useState(false);
  const undo = useRef<Slide[][]>([]);
  const redo = useRef<Slide[][]>([]);
  const syncedAt = useRef(page.updatedAt);
  const dirty = useRef(readSlides(page).length === 0);
  const timer = useRef(0);
  const latest = useRef(slides);
  latest.current = slides;
  const clipboard = useRef<SlideElement[]>([]);
  const gestureBase = useRef<Slide[] | null>(null);

  // ---- persistence --------------------------------------------------------
  const save = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    setSaving(true);
    try {
      const res = await api.saveBlocks(id, latest.current.map(slideToBlock), syncedAt.current);
      syncedAt.current = res.updatedAt;
      const s = useStore.getState();
      const m = s.pages[id];
      if (m) s.patchPageLocal({ ...m, updatedAt: res.updatedAt });
    } catch (e) {
      const message = errorMessage(e);
      if (message.startsWith("conflict")) {
        const fresh = await api.page(id);
        if (fresh) {
          syncedAt.current = fresh.updatedAt;
          const s = readSlides(fresh);
          if (s.length) setSlides(s);
        }
        toast({ message: "This presentation changed elsewhere and was reloaded.", tone: "info" });
      } else {
        dirty.current = true;
        toast({ message: `Could not save: ${message}`, tone: "error" });
      }
    } finally {
      setSaving(false);
    }
  }, [id, toast]);

  useEffect(() => {
    const flush = () => save();
    window.addEventListener("blur", flush);
    return () => {
      window.removeEventListener("blur", flush);
      save();
    };
  }, [save]);
  useEffect(() => {
    if (dirty.current) save();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Replace the slide list; `commit` adds an undo step and schedules a save. */
  const commit = (next: Slide[], record = true) => {
    if (record) {
      undo.current.push(latest.current);
      if (undo.current.length > 120) undo.current.shift();
      redo.current = [];
    }
    latest.current = next;
    setSlides(next);
    dirty.current = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(save, 500);
  };
  const slide = slides[Math.min(current, slides.length - 1)];
  const setSlide = (s: Slide, record = true) => commit(slides.map((x, i) => (i === current ? s : x)), record);
  const sel = slide.elements.filter((e) => selected.includes(e.id));
  const one = sel.length === 1 ? sel[0] : undefined;
  const patchSel = (patch: (e: SlideElement) => SlideElement) => setSlide({ ...slide, elements: slide.elements.map((e) => (selected.includes(e.id) ? patch(e) : e)) });

  const doUndo = () => {
    const prev = undo.current.pop();
    if (!prev) return;
    redo.current.push(latest.current);
    commit(prev, false);
  };
  const doRedo = () => {
    const next = redo.current.pop();
    if (!next) return;
    undo.current.push(latest.current);
    commit(next, false);
  };

  // ---- slide operations -------------------------------------------------------
  const addSlide = (after: number, layout: LayoutId) => {
    const s = newSlide(layout);
    const next = [...slides.slice(0, after + 1), s, ...slides.slice(after + 1)];
    commit(next);
    setCurrent(after + 1);
    setSelected([]);
  };
  const duplicateSlide = (i: number) => {
    const copy: Slide = { ...structuredClone(slides[i]), bid: newId() };
    copy.elements = copy.elements.map((e) => ({ ...e, id: newId() }));
    commit([...slides.slice(0, i + 1), copy, ...slides.slice(i + 1)]);
    setCurrent(i + 1);
  };
  const deleteSlide = (i: number) => {
    if (slides.length === 1) return;
    commit(slides.filter((_, k) => k !== i));
    setCurrent(Math.max(0, Math.min(i, slides.length - 2)));
    setSelected([]);
  };
  const moveSlide = (from: number, to: number) => {
    if (from === to) return;
    const next = [...slides];
    const [s] = next.splice(from, 1);
    next.splice(to, 0, s);
    commit(next);
    setCurrent(to);
  };

  // ---- elements -------------------------------------------------------------------
  const addElement = (el: SlideElement) => {
    setSlide({ ...slide, elements: [...slide.elements, el] });
    setSelected([el.id]);
  };
  const addText = () => {
    const el: SlideElement = { id: newId(), type: "text", x: 340, y: 300, w: 600, h: 110, text: "", style: { fontSize: 36, fontWeight: 500, color: THEME.ink, align: "left" } };
    addElement(el);
    setEditing(el.id);
  };
  const addShape = (shape: ShapeKind) =>
    addElement(
      shape === "line"
        ? { id: newId(), type: "shape", shape, x: 440, y: 358, w: 400, h: 4, stroke: THEME.ink }
        : { id: newId(), type: "shape", shape, x: 490, y: 210, w: 300, h: 300, fill: THEME.accent, radius: shape === "rect" ? 18 : 0 },
    );
  const addMedia = async (kind: "image" | "video") => {
    const picked = await openDialog({
      multiple: false,
      title: kind === "image" ? "Insert a picture" : "Insert a video",
      filters: [{ name: kind === "image" ? "Pictures" : "Videos", extensions: kind === "image" ? ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"] : ["mp4", "webm", "mov", "m4v"] }],
    });
    if (!picked || Array.isArray(picked)) return;
    try {
      const a = await api.importFile(id, picked);
      const ratio = a.width && a.height ? a.width / a.height : 16 / 9;
      let w = 720;
      let h = w / ratio;
      if (h > 560) {
        h = 560;
        w = h * ratio;
      }
      addElement({ id: newId(), type: kind, attachmentId: a.id, x: Math.round((STAGE_W - w) / 2), y: Math.round((STAGE_H - h) / 2), w: Math.round(w), h: Math.round(h), fit: kind === "image" ? "cover" : "contain" });
    } catch (e) {
      toast({ message: errorMessage(e), tone: "error" });
    }
  };
  const setBackgroundPicture = async () => {
    const picked = await openDialog({ multiple: false, title: "Background picture", filters: [{ name: "Pictures", extensions: ["png", "jpg", "jpeg", "webp", "avif"] }] });
    if (!picked || Array.isArray(picked)) return;
    try {
      const a = await api.importFile(id, picked);
      setSlide({ ...slide, background: { ...slide.background, attachmentId: a.id } });
    } catch (e) {
      toast({ message: errorMessage(e), tone: "error" });
    }
  };
  const removeSelected = () => {
    if (!selected.length) return;
    setSlide({ ...slide, elements: slide.elements.filter((e) => !selected.includes(e.id)) });
    setSelected([]);
  };
  const duplicateSelected = () => {
    if (!sel.length) return;
    const copies = sel.map((e) => ({ ...structuredClone(e), id: newId(), x: e.x + 24, y: e.y + 24 }));
    setSlide({ ...slide, elements: [...slide.elements, ...copies] });
    setSelected(copies.map((c) => c.id));
  };
  const arrange = (to: "front" | "forward" | "backward" | "back") => {
    const els = [...slide.elements];
    for (const sid of to === "front" || to === "backward" ? [...selected] : [...selected].reverse()) {
      const i = els.findIndex((e) => e.id === sid);
      if (i < 0) continue;
      const [el] = els.splice(i, 1);
      const j = to === "front" ? els.length : to === "back" ? 0 : to === "forward" ? Math.min(els.length, i + 1) : Math.max(0, i - 1);
      els.splice(j, 0, el);
    }
    setSlide({ ...slide, elements: els });
  };

  // ---- keyboard ---------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (presenting || editing) return;
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable='true'], [contenteditable='plaintext-only']")) return;
      if (!t.closest(".res-presentation") && t !== document.body) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        doRedo();
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelected();
      } else if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelected(slide.elements.map((x) => x.id));
      } else if (mod && e.key.toLowerCase() === "c" && sel.length) {
        clipboard.current = structuredClone(sel);
      } else if (mod && e.key.toLowerCase() === "v" && clipboard.current.length) {
        e.preventDefault();
        const copies = clipboard.current.map((x) => ({ ...structuredClone(x), id: newId(), x: x.x + 20, y: x.y + 20 }));
        setSlide({ ...slide, elements: [...slide.elements, ...copies] });
        setSelected(copies.map((c) => c.id));
      } else if ((e.key === "Delete" || e.key === "Backspace") && selected.length) {
        e.preventDefault();
        removeSelected();
      } else if (e.key === "Escape") setSelected([]);
      else if (e.key === "Enter" && one?.type === "text") {
        e.preventDefault();
        setEditing(one.id);
      } else if (e.key.startsWith("Arrow") && selected.length) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0;
        const dy = e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0;
        patchSel((x) => ({ ...x, x: x.x + dx, y: x.y + dy }));
      } else if (!selected.length && (e.key === "PageDown" || e.key === "ArrowDown")) setCurrent((c) => Math.min(slides.length - 1, c + 1));
      else if (!selected.length && (e.key === "PageUp" || e.key === "ArrowUp")) setCurrent((c) => Math.max(0, c - 1));
      else if (e.key === "F5") {
        e.preventDefault();
        setPresenting(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---- canvas size --------------------------------------------------------------------
  const area = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const fit = () => setScale(Math.max(0.2, Math.min((el.clientWidth - 8) / STAGE_W, (el.clientHeight - 8) / STAGE_H)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- toolbar ------------------------------------------------------------------------------
  const tb = (icon: IconName, label: string, run: () => void, opts: { on?: boolean; disabled?: boolean } = {}) => (
    <button className={`dt-btn ${opts.on ? "is-on" : ""}`} aria-label={label} data-tip={label} disabled={opts.disabled} onMouseDown={(e) => e.preventDefault()} onClick={run}>
      <Icon name={icon} size={16} />
    </button>
  );
  const colorMenu = (el: HTMLElement, pick: (c: string) => void): void =>
    menuAt(el, SWATCHES.map((c) => ({ label: c, onSelect: () => pick(c) })) as MenuItem[]);
  const textEls = sel.filter((e) => e.type === "text");
  const shapeEls = sel.filter((e) => e.type === "shape");
  const fontSize = textEls[0]?.style?.fontSize ?? 32;

  return (
    <div className="res-view res-presentation">
      <ResourceHeader
        meta={meta}
        subtitle={<span>{saving ? "Saving" : `${slides.length} slide${slides.length === 1 ? "" : "s"}`}</span>}
        actions={<Button variant="tinted" icon="play" onClick={() => setPresenting(true)}>Present</Button>}
      />
      <div className="doc-toolbar-wrap dk-toolbar-wrap">
        <Glass material="regular" layer={LAYER.floating} radius="var(--r-capsule)" className="doc-toolbar" contentClassName="doc-toolbar-row">
          {tb("text", "Text box", addText)}
          {tb("image", "Picture", () => addMedia("image"))}
          {tb("video", "Video", () => addMedia("video"))}
          <button className="dt-btn" aria-label="Shape" data-tip="Shape" onMouseDown={(e) => e.preventDefault()} onClick={(e) => menuAt(e.currentTarget, [{ label: "Rectangle", onSelect: () => addShape("rect") }, { label: "Ellipse", onSelect: () => addShape("ellipse") }, { label: "Line", onSelect: () => addShape("line") }])}>
            <Icon name="square" size={16} />
          </button>
          <span className="dt-sep" />
          <button className="dt-select" onMouseDown={(e) => e.preventDefault()} onClick={(e) => menuAt(e.currentTarget, LAYOUTS.map((l) => ({ label: l.label, checked: l.id === slide.layout, onSelect: () => setSlide(applyLayout(slide, l.id)) })))}>
            {LAYOUTS.find((l) => l.id === slide.layout)?.label ?? "Layout"} <Icon name="chevronDown" size={12} />
          </button>
          <button
            className="dt-btn"
            aria-label="Background"
            data-tip="Background"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) =>
              menuAt(e.currentTarget, [
                ...BACKGROUNDS.map((c) => ({ label: c, checked: slide.background.color === c && !slide.background.attachmentId, onSelect: () => setSlide({ ...slide, background: { color: c } }) })),
                { kind: "separator" as const },
                { label: "Picture…", icon: "image" as IconName, onSelect: setBackgroundPicture },
                { label: "Remove Picture", disabled: !slide.background.attachmentId, onSelect: () => setSlide({ ...slide, background: { color: slide.background.color } }) },
              ])
            }
          >
            <span className="dk-bg-chip" style={{ background: slide.background.color }} />
          </button>
          {textEls.length > 0 && (
            <>
              <span className="dt-sep" />
              <button className="dt-btn dt-text" aria-label="Smaller" onMouseDown={(e) => e.preventDefault()} onClick={() => patchSel((x) => (x.type === "text" ? { ...x, style: { ...x.style!, fontSize: [...SIZES].reverse().find((s) => s < fontSize) ?? fontSize } } : x))}>−</button>
              <button className="dt-btn dt-text dt-size-value" onMouseDown={(e) => e.preventDefault()} onClick={(e) => menuAt(e.currentTarget, SIZES.map((s) => ({ label: `${s}`, checked: s === fontSize, onSelect: () => patchSel((x) => (x.type === "text" ? { ...x, style: { ...x.style!, fontSize: s } } : x)) })))}>{fontSize}</button>
              <button className="dt-btn dt-text" aria-label="Larger" onMouseDown={(e) => e.preventDefault()} onClick={() => patchSel((x) => (x.type === "text" ? { ...x, style: { ...x.style!, fontSize: SIZES.find((s) => s > fontSize) ?? fontSize } } : x))}>+</button>
              <button className={`dt-btn dt-text is-bold ${(textEls[0].style?.fontWeight ?? 500) >= 700 ? "is-on" : ""}`} aria-label="Bold" onMouseDown={(e) => e.preventDefault()} onClick={() => patchSel((x) => (x.type === "text" ? { ...x, style: { ...x.style!, fontWeight: (x.style?.fontWeight ?? 500) >= 700 ? 500 : 700 } } : x))}>B</button>
              <button className={`dt-btn dt-text is-italic ${textEls[0].style?.italic ? "is-on" : ""}`} aria-label="Italic" onMouseDown={(e) => e.preventDefault()} onClick={() => patchSel((x) => (x.type === "text" ? { ...x, style: { ...x.style!, italic: !x.style?.italic } } : x))}>I</button>
              <button className="dt-btn" aria-label="Text colour" data-tip="Text colour" onMouseDown={(e) => e.preventDefault()} onClick={(e) => colorMenu(e.currentTarget, (c) => patchSel((x) => (x.type === "text" ? { ...x, style: { ...x.style!, color: c } } : x)))}>
                <span className="dt-color" style={{ borderColor: textEls[0].style?.color }}>A</span>
              </button>
              {tb("alignLeft", "Align left", () => patchSel((x) => (x.type === "text" ? { ...x, style: { ...x.style!, align: "left" } } : x)), { on: textEls[0].style?.align === "left" })}
              {tb("alignCenter", "Center", () => patchSel((x) => (x.type === "text" ? { ...x, style: { ...x.style!, align: "center" } } : x)), { on: textEls[0].style?.align === "center" })}
              {tb("alignRight", "Align right", () => patchSel((x) => (x.type === "text" ? { ...x, style: { ...x.style!, align: "right" } } : x)), { on: textEls[0].style?.align === "right" })}
            </>
          )}
          {shapeEls.length > 0 && (
            <>
              <span className="dt-sep" />
              <button className="dt-btn" aria-label="Fill" data-tip="Fill" onMouseDown={(e) => e.preventDefault()} onClick={(e) => colorMenu(e.currentTarget, (c) => patchSel((x) => (x.type === "shape" ? (x.shape === "line" ? { ...x, stroke: c } : { ...x, fill: c }) : x)))}>
                <span className="dk-bg-chip" style={{ background: shapeEls[0].fill ?? shapeEls[0].stroke }} />
              </button>
            </>
          )}
          {sel.length > 0 && (
            <>
              <span className="dt-sep" />
              <button
                className="dt-btn"
                aria-label="Arrange"
                data-tip="Arrange"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) =>
                  menuAt(e.currentTarget, [
                    { label: "Bring to Front", onSelect: () => arrange("front") },
                    { label: "Bring Forward", onSelect: () => arrange("forward") },
                    { label: "Send Backward", onSelect: () => arrange("backward") },
                    { label: "Send to Back", onSelect: () => arrange("back") },
                  ])
                }
              >
                <Icon name="layers" size={16} />
              </button>
              {tb("duplicate", "Duplicate  Ctrl+D", duplicateSelected)}
              {tb("delete", "Delete", removeSelected)}
            </>
          )}
          <span className="dt-sep" />
          {tb("undo", "Undo  Ctrl+Z", doUndo, { disabled: !undo.current.length })}
          {tb("redo", "Redo  Ctrl+Y", doRedo, { disabled: !redo.current.length })}
        </Glass>
      </div>

      <div className="dk-body">
        <Navigator slides={slides} current={current} onPick={(i) => { setCurrent(i); setSelected([]); setEditing(null); }} onMove={moveSlide} onAdd={addSlide} onDuplicate={duplicateSlide} onDelete={deleteSlide} />
        <div className="dk-main">
          <div className="dk-area" ref={area}>
            <Canvas
              slide={slide}
              scale={scale}
              selected={selected}
              onSelect={setSelected}
              onChange={(s, done) => {
                const next = latest.current.map((x, i) => (i === current ? s : x));
                if (!done) {
                  // Live (drag, resize, typing): remember where the gesture started.
                  if (!gestureBase.current) gestureBase.current = latest.current;
                  latest.current = next;
                  setSlides(next);
                  return;
                }
                // Finished: one undo step back to before the gesture.
                undo.current.push(gestureBase.current ?? latest.current);
                gestureBase.current = null;
                redo.current = [];
                commit(next, false);
              }}
              editingId={editing}
              onEditing={setEditing}
            />
          </div>
          <textarea
            key={slide.bid}
            className="dk-notes bidi"
            dir="auto"
            placeholder="Speaker notes"
            defaultValue={slide.notes}
            onBlur={(e) => e.target.value !== slide.notes && setSlide({ ...slide, notes: e.target.value })}
          />
        </div>
      </div>
      {presenting && <Present slides={slides} start={current} onClose={(at) => { setPresenting(false); setCurrent(at); }} />}
    </div>
  );
}
