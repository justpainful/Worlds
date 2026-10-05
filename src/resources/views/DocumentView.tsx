import { useEffect, useReducer, useRef, useState, type CSSProperties } from "react";
import type { Editor } from "@tiptap/core";
import type { Page } from "../../lib/types";
import { useStore } from "../../state/store";
import { PageEditor, type PageEditorHandle } from "../../editor/PageEditor";
import type { ParagraphStyle } from "../../editor/extensions/document";
import { Glass } from "../../glass/Glass";
import { LAYER } from "../../glass/materials";
import { Button } from "../../ui/Button";
import { Icon, type IconName } from "../../ui/Icon";
import { menuAt, Popover } from "../../ui/Menu";
import { EmptyState, Spinner } from "../../ui/misc";
import { ResourceHeader, saveMeta, useResource } from "./ResourceHeader";

export interface DocSettings {
  size: keyof typeof PAPER;
  orientation: "portrait" | "landscape";
  margins: { top: number; right: number; bottom: number; left: number };
  header: string;
  footer: string;
  font: string;
  fontSize: number;
  lineHeight: number;
}

/** Paper sizes in millimetres. */
export const PAPER = {
  A4: { w: 210, h: 297, label: "A4" },
  A5: { w: 148, h: 210, label: "A5" },
  Letter: { w: 215.9, h: 279.4, label: "Letter" },
  Legal: { w: 215.9, h: 355.6, label: "Legal" },
} as const;

const MM = 96 / 25.4;

export const FONTS: { label: string; value: string }[] = [
  { label: "Default", value: "" },
  { label: "Instrument Sans", value: "Instrument Sans Variable" },
  { label: "IBM Plex Sans Arabic", value: "IBM Plex Sans Arabic" },
  { label: "Segoe UI", value: "Segoe UI" },
  { label: "Calibri", value: "Calibri" },
  { label: "Arial", value: "Arial" },
  { label: "Tahoma", value: "Tahoma" },
  { label: "Georgia", value: "Georgia" },
  { label: "Cambria", value: "Cambria" },
  { label: "Times New Roman", value: "Times New Roman" },
  { label: "Courier New", value: "Courier New" },
];
const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72];

const DEFAULTS: DocSettings = {
  size: "A4",
  orientation: "portrait",
  margins: { top: 25, right: 22, bottom: 25, left: 22 },
  header: "",
  footer: "",
  font: "",
  fontSize: 12,
  lineHeight: 1.5,
};

export function docSettings(page: Page): DocSettings {
  const d = (page.metadata as { doc?: Partial<DocSettings> }).doc ?? {};
  return { ...DEFAULTS, ...d, margins: { ...DEFAULTS.margins, ...(d.margins ?? {}) } };
}

/** Paper size in px for the current orientation. */
function paperPx(s: DocSettings) {
  const p = PAPER[s.size] ?? PAPER.A4;
  const [w, h] = s.orientation === "landscape" ? [p.h, p.w] : [p.w, p.h];
  return { w: w * MM, h: h * MM, wmm: w, hmm: h };
}

/**
 * A document: Worlds' word processor. The text sits on paper of a real size
 * with real margins; formatting tools appear in one calm toolbar; and
 * character formatting always carries on from the text around the caret.
 */
export function DocumentView({ id }: { id: string }) {
  const meta = useStore((s) => s.pages[id]);
  const { page, error } = useResource(id);
  if (error) return <EmptyState icon="warning" title="This document could not be opened" text={error} />;
  if (!page || !meta) return <div className="page-loading"><Spinner /></div>;
  return <LoadedDocument key={`${page.id}`} page={page} />;
}

function LoadedDocument({ page }: { page: Page }) {
  const meta = useStore((s) => s.pages[page.id]) ?? page;
  const [settings, setSettings] = useState(() => docSettings(page));
  const [saving, setSaving] = useState(false);
  const [setup, setSetup] = useState<DOMRect | null>(null);
  const editorRef = useRef<PageEditorHandle>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  useEffect(() => {
    let raf = 0;
    const grab = () => {
      const ed = editorRef.current?.editor ?? null;
      if (ed) setEditor(ed);
      else raf = requestAnimationFrame(grab);
    };
    grab();
    return () => cancelAnimationFrame(raf);
  }, []);

  const update = (patch: Partial<DocSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveMeta(page.id, "doc", next);
  };
  const paper = paperPx(settings);
  const m = settings.margins;
  const style = {
    "--paper-w": `${paper.w}px`,
    "--paper-h": `${paper.h}px`,
    "--m-top": `${m.top * MM}px`,
    "--m-right": `${m.right * MM}px`,
    "--m-bottom": `${m.bottom * MM}px`,
    "--m-left": `${m.left * MM}px`,
    "--doc-font": settings.font ? `"${settings.font}", var(--font-ui)` : "var(--font-ui)",
    "--doc-size": `${settings.fontSize}pt`,
    "--doc-leading": String(settings.lineHeight),
  } as CSSProperties;

  const print = () => printDocument(settings);

  return (
    <div className="res-view res-document" style={style}>
      <ResourceHeader
        meta={meta}
        subtitle={<span>{saving ? "Saving" : `${PAPER[settings.size]?.label ?? settings.size} · ${settings.orientation}`}</span>}
        actions={
          <>
            <Button variant="quiet" icon="sliders" onClick={(e) => setSetup(e.currentTarget.getBoundingClientRect())}>Page setup</Button>
            <Button variant="quiet" icon="download" onClick={print}>Print or PDF</Button>
          </>
        }
      />
      {editor && <DocToolbar editor={editor} />}
      <div className="doc-desk">
        <div className="doc-paper">
          {settings.header && <div className="doc-running is-header bidi">{settings.header}</div>}
          <PageEditor ref={editorRef} page={page} variant="document" onSaving={setSaving} />
          {settings.footer && <div className="doc-running is-footer bidi">{settings.footer}</div>}
        </div>
      </div>
      {setup && <PageSetup anchor={setup} settings={settings} onChange={update} onClose={() => setSetup(null)} />}
    </div>
  );
}

/** Print (or save as PDF) on the document's own paper and margins. */
function printDocument(s: DocSettings) {
  const p = paperPx(s);
  const css = document.createElement("style");
  css.textContent = `@page { size: ${p.wmm}mm ${p.hmm}mm; margin: ${s.margins.top}mm ${s.margins.right}mm ${s.margins.bottom}mm ${s.margins.left}mm; }`;
  document.head.appendChild(css);
  document.documentElement.classList.add("is-printing-doc");
  setTimeout(() => {
    window.print();
    document.documentElement.classList.remove("is-printing-doc");
    css.remove();
  }, 60);
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

const PARA: { id: string; label: string; apply: (e: Editor) => void; active: (e: Editor) => boolean }[] = [
  { id: "normal", label: "Normal", apply: (e) => e.chain().focus().setParagraph().setParagraphStyle("normal").run(), active: (e) => e.isActive("paragraph", { pstyle: "normal" }) },
  { id: "title", label: "Title", apply: (e) => e.chain().focus().setParagraph().setParagraphStyle("title").run(), active: (e) => e.isActive("paragraph", { pstyle: "title" }) },
  { id: "subtitle", label: "Subtitle", apply: (e) => e.chain().focus().setParagraph().setParagraphStyle("subtitle").run(), active: (e) => e.isActive("paragraph", { pstyle: "subtitle" }) },
  { id: "h1", label: "Heading 1", apply: (e) => e.chain().focus().setHeading({ level: 1 }).run(), active: (e) => e.isActive("heading", { level: 1 }) },
  { id: "h2", label: "Heading 2", apply: (e) => e.chain().focus().setHeading({ level: 2 }).run(), active: (e) => e.isActive("heading", { level: 2 }) },
  { id: "h3", label: "Heading 3", apply: (e) => e.chain().focus().setHeading({ level: 3 }).run(), active: (e) => e.isActive("heading", { level: 3 }) },
  { id: "quote", label: "Quote", apply: (e) => e.chain().focus().setParagraph().toggleBlockquote().run(), active: (e) => e.isActive("blockquote") },
  { id: "caption", label: "Caption", apply: (e) => e.chain().focus().setParagraph().setParagraphStyle("caption" as ParagraphStyle).run(), active: (e) => e.isActive("paragraph", { pstyle: "caption" }) },
];

const SWATCHES = ["", "#e5484d", "#f76b15", "#ffc53d", "#46a758", "#0090ff", "#8e4ec6", "#d6409f", "#8b8d98"];
const MARKERS = ["", "rgba(255, 213, 0, 0.45)", "rgba(70, 167, 88, 0.35)", "rgba(0, 144, 255, 0.3)", "rgba(214, 64, 159, 0.3)", "rgba(247, 107, 21, 0.35)"];

function DocToolbar({ editor }: { editor: Editor }) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    editor.on("transaction", rerender);
    return () => {
      editor.off("transaction", rerender);
    };
  }, [editor]);
  const ts = editor.getAttributes("textStyle") as { fontFamily?: string; fontSize?: string; color?: string };
  const para = PARA.find((p) => p.active(editor)) ?? PARA[0];
  const sizeNow = ts.fontSize ? parseFloat(ts.fontSize) : null;
  const font = FONTS.find((f) => f.value && ts.fontFamily?.includes(f.value))?.label ?? "Default";
  const stepSize = (dir: 1 | -1) => {
    const cur = sizeNow ?? 12;
    const next = dir > 0 ? SIZES.find((s) => s > cur) ?? cur : [...SIZES].reverse().find((s) => s < cur) ?? cur;
    editor.chain().focus().setFontSize(`${next}pt`).run();
  };
  const b = (icon: IconName, label: string, on: boolean, run: () => void) => (
    <button className={`dt-btn ${on ? "is-on" : ""}`} aria-label={label} data-tip={label} onMouseDown={(e) => e.preventDefault()} onClick={run}>
      <Icon name={icon} size={16} />
    </button>
  );
  const t = (text: string, label: string, on: boolean, run: () => void, cls = "") => (
    <button className={`dt-btn dt-text ${cls} ${on ? "is-on" : ""}`} aria-label={label} data-tip={label} onMouseDown={(e) => e.preventDefault()} onClick={run}>
      {text}
    </button>
  );
  const align = (["left", "center", "right", "justify"] as const).find((a) => editor.isActive({ textAlign: a })) ?? "left";

  return (
    <div className="doc-toolbar-wrap">
      <Glass material="regular" layer={LAYER.floating} radius="var(--r-capsule)" className="doc-toolbar" contentClassName="doc-toolbar-row">
        <button
          className="dt-select"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => menuAt(e.currentTarget, PARA.map((p) => ({ label: p.label, checked: p.id === para.id, onSelect: () => p.apply(editor) })))}
        >
          {para.label} <Icon name="chevronDown" size={12} />
        </button>
        <span className="dt-sep" />
        <button
          className="dt-select dt-font"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) =>
            menuAt(
              e.currentTarget,
              FONTS.map((f) => ({
                label: f.label,
                checked: f.label === font,
                onSelect: () => (f.value ? editor.chain().focus().setFontFamily(f.value).run() : editor.chain().focus().unsetFontFamily().run()),
              })),
            )
          }
        >
          {font} <Icon name="chevronDown" size={12} />
        </button>
        <span className="dt-size">
          {t("−", "Smaller", false, () => stepSize(-1))}
          <button
            className="dt-btn dt-text dt-size-value"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) =>
              menuAt(
                e.currentTarget,
                [{ label: "Document size", checked: !sizeNow, onSelect: () => editor.chain().focus().unsetFontSize().run() }, { kind: "separator" as const }, ...SIZES.map((s) => ({ label: `${s}`, checked: sizeNow === s, onSelect: () => editor.chain().focus().setFontSize(`${s}pt`).run() }))],
              )
            }
          >
            {sizeNow ?? "Auto"}
          </button>
          {t("+", "Larger", false, () => stepSize(1))}
        </span>
        <span className="dt-sep" />
        {t("B", "Bold  Ctrl+B", editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), "is-bold")}
        {t("I", "Italic  Ctrl+I", editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), "is-italic")}
        {t("U", "Underline  Ctrl+U", editor.isActive("underline"), () => editor.chain().focus().toggleUnderline().run(), "is-underline")}
        {t("S", "Strikethrough", editor.isActive("strike"), () => editor.chain().focus().toggleStrike().run(), "is-strike")}
        <button
          className="dt-btn"
          aria-label="Text colour"
          data-tip="Text colour"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) =>
            menuAt(e.currentTarget, [
              { kind: "label", label: "Text" },
              ...SWATCHES.map((c) => ({ label: c ? c : "Automatic", onSelect: () => (c ? editor.chain().focus().setColor(c).run() : editor.chain().focus().unsetColor().run()) })),
              { kind: "label", label: "Highlight" },
              ...MARKERS.map((c, i) => ({ label: c ? `Marker ${i}` : "No highlight", onSelect: () => (c ? editor.chain().focus().setHighlight({ color: c }).run() : editor.chain().focus().unsetHighlight().run()) })),
            ])
          }
        >
          <span className="dt-color" style={{ borderColor: ts.color || "currentColor" }}>A</span>
        </button>
        <span className="dt-sep" />
        {b("alignLeft", "Align left", align === "left", () => editor.chain().focus().setTextAlign("left").run())}
        {b("alignCenter", "Center", align === "center", () => editor.chain().focus().setTextAlign("center").run())}
        {b("alignRight", "Align right", align === "right", () => editor.chain().focus().setTextAlign("right").run())}
        {b("listView", "Justify", align === "justify", () => editor.chain().focus().setTextAlign("justify").run())}
        <span className="dt-sep" />
        {b("bulletList", "Bulleted list", editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run())}
        {b("numberedList", "Numbered list", editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run())}
        {b("checklist", "Checklist", editor.isActive("taskList"), () => editor.chain().focus().toggleTaskList().run())}
        <button
          className="dt-btn"
          aria-label="Line spacing"
          data-tip="Line spacing"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) =>
            menuAt(e.currentTarget, [
              { label: "Document spacing", onSelect: () => editor.chain().focus().unsetLineHeight().run() },
              ...["1", "1.15", "1.5", "2"].map((v) => ({ label: v, onSelect: () => editor.chain().focus().setLineHeight(v).run() })),
            ])
          }
        >
          <Icon name="sliders" size={15} />
        </button>
        {b("table", "Table", false, () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}
        {b("history", "Clear formatting", false, () => editor.chain().focus().unsetAllMarks().setParagraphStyle("normal").run())}
      </Glass>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page setup
// ---------------------------------------------------------------------------

function PageSetup({ anchor, settings, onChange, onClose }: { anchor: DOMRect; settings: DocSettings; onChange: (p: Partial<DocSettings>) => void; onClose: () => void }) {
  const num = (v: string, min: number, max: number, fallback: number) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  return (
    <Popover anchor={anchor} onClose={onClose} width={360} align="end">
      <div className="doc-setup">
        <span className="field-label">Paper</span>
        <div className="doc-setup-row">
          {(Object.keys(PAPER) as (keyof typeof PAPER)[]).map((k) => (
            <button key={k} className={`chip-btn ${settings.size === k ? "is-on" : ""}`} onClick={() => onChange({ size: k })}>{PAPER[k].label}</button>
          ))}
        </div>
        <span className="field-label">Orientation</span>
        <div className="doc-setup-row">
          {(["portrait", "landscape"] as const).map((o) => (
            <button key={o} className={`chip-btn ${settings.orientation === o ? "is-on" : ""}`} onClick={() => onChange({ orientation: o })}>{o === "portrait" ? "Portrait" : "Landscape"}</button>
          ))}
        </div>
        <span className="field-label">Margins (mm)</span>
        <div className="doc-setup-grid">
          {(["top", "right", "bottom", "left"] as const).map((side) => (
            <label key={side}>
              <span>{side[0].toUpperCase() + side.slice(1)}</span>
              <input className="field" type="number" min={0} max={80} defaultValue={settings.margins[side]} onBlur={(e) => onChange({ margins: { ...settings.margins, [side]: num(e.target.value, 0, 80, settings.margins[side]) } })} />
            </label>
          ))}
        </div>
        <span className="field-label">Body text</span>
        <div className="doc-setup-grid">
          <label>
            <span>Size (pt)</span>
            <input className="field" type="number" min={6} max={48} step={0.5} defaultValue={settings.fontSize} onBlur={(e) => onChange({ fontSize: num(e.target.value, 6, 48, settings.fontSize) })} />
          </label>
          <label>
            <span>Line spacing</span>
            <input className="field" type="number" min={1} max={3} step={0.05} defaultValue={settings.lineHeight} onBlur={(e) => onChange({ lineHeight: num(e.target.value, 1, 3, settings.lineHeight) })} />
          </label>
        </div>
        <span className="field-label">Header and footer</span>
        <input className="field bidi" dir="auto" placeholder="Header (top of every printed page)" defaultValue={settings.header} onBlur={(e) => onChange({ header: e.target.value })} />
        <input className="field bidi" dir="auto" placeholder="Footer (bottom of every printed page)" defaultValue={settings.footer} onBlur={(e) => onChange({ footer: e.target.value })} />
      </div>
    </Popover>
  );
}
