/**
 * Presentation model. A presentation's slides are its blocks (one block per
 * slide, so slides get history, versions, undo and search like any block).
 * Coordinates are in a fixed 1280 x 720 stage; the editor scales it.
 */

export const STAGE_W = 1280;
export const STAGE_H = 720;

export type ElementType = "text" | "image" | "video" | "shape";
export type ShapeKind = "rect" | "ellipse" | "line";

export interface TextStyle {
  fontSize: number;
  fontWeight: number;
  color: string;
  align: "left" | "center" | "right";
  font?: string;
  italic?: boolean;
}

export interface SlideElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  w: number;
  h: number;
  rot?: number;
  opacity?: number;
  /** text */
  text?: string;
  style?: TextStyle;
  /** image / video */
  attachmentId?: string;
  fit?: "cover" | "contain";
  /** shape */
  shape?: ShapeKind;
  fill?: string;
  stroke?: string;
  radius?: number;
  /** a placeholder from the layout, shown with a hint until filled */
  role?: "title" | "body" | "subtitle";
}

export interface SlideBackground {
  color: string;
  attachmentId?: string | null;
}

export interface Slide {
  bid: string;
  layout: LayoutId;
  background: SlideBackground;
  notes: string;
  elements: SlideElement[];
}

export type LayoutId = "title" | "title-body" | "section" | "two-columns" | "image" | "blank";

export const LAYOUTS: { id: LayoutId; label: string }[] = [
  { id: "title", label: "Title" },
  { id: "title-body", label: "Title and Content" },
  { id: "section", label: "Section" },
  { id: "two-columns", label: "Two Columns" },
  { id: "image", label: "Picture with Caption" },
  { id: "blank", label: "Blank" },
];

export const THEME = {
  background: "#16161a",
  ink: "#f4f2ee",
  sub: "rgba(244, 242, 238, 0.66)",
  accent: "#d2a46e",
};

export const BACKGROUNDS = ["#16161a", "#0f172a", "#1b1f1d", "#2a1a1f", "#f7f5f0", "#ffffff", "#1d3557", "#3a2e5a", "#7c2d12", "#14532d"];

export const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(13)), (b) => b.toString(16).padStart(2, "0")).join("");

const text = (role: SlideElement["role"], x: number, y: number, w: number, h: number, style: Partial<TextStyle>, value = ""): SlideElement => ({
  id: newId(),
  type: "text",
  role,
  x,
  y,
  w,
  h,
  text: value,
  style: { fontSize: 32, fontWeight: 500, color: THEME.ink, align: "left", ...style },
});

/** The placeholders a layout starts with. */
export function layoutElements(layout: LayoutId): SlideElement[] {
  switch (layout) {
    case "title":
      return [
        text("title", 120, 250, 1040, 140, { fontSize: 76, fontWeight: 700, align: "center" }),
        text("subtitle", 200, 400, 880, 70, { fontSize: 30, fontWeight: 400, align: "center", color: THEME.sub }),
      ];
    case "title-body":
      return [text("title", 90, 70, 1100, 100, { fontSize: 54, fontWeight: 700 }), text("body", 90, 200, 1100, 440, { fontSize: 30, fontWeight: 400 })];
    case "section":
      return [
        text("title", 90, 280, 1100, 120, { fontSize: 64, fontWeight: 700 }),
        { id: newId(), type: "shape", shape: "rect", x: 90, y: 250, w: 90, h: 8, fill: THEME.accent, radius: 4 },
      ];
    case "two-columns":
      return [
        text("title", 90, 70, 1100, 100, { fontSize: 50, fontWeight: 700 }),
        text("body", 90, 210, 530, 430, { fontSize: 28, fontWeight: 400 }),
        text("body", 660, 210, 530, 430, { fontSize: 28, fontWeight: 400 }),
      ];
    case "image":
      return [text("title", 90, 560, 1100, 70, { fontSize: 36, fontWeight: 600, align: "center" })];
    default:
      return [];
  }
}

export function newSlide(layout: LayoutId = "title-body"): Slide {
  return { bid: newId(), layout, background: { color: THEME.background }, notes: "", elements: layoutElements(layout) };
}

/** Change a slide's layout, keeping what was typed into matching placeholders. */
export function applyLayout(slide: Slide, layout: LayoutId): Slide {
  const fresh = layoutElements(layout);
  const filled = slide.elements.filter((e) => e.role && e.text?.trim());
  for (const el of fresh) {
    const i = filled.findIndex((f) => f.role === el.role);
    if (i >= 0) {
      el.text = filled[i].text;
      filled.splice(i, 1);
    }
  }
  const own = slide.elements.filter((e) => !e.role);
  return { ...slide, layout, elements: [...fresh, ...own, ...filled.map((f) => ({ ...f, role: undefined }))] };
}

export function placeholderHint(el: SlideElement) {
  return el.role === "title" ? "Click to add a title" : el.role === "subtitle" ? "Click to add a subtitle" : el.role === "body" ? "Click to add text" : "Text";
}

/** Slide <-> block content. */
export function slideFromBlock(bid: string, content: { attrs?: Record<string, unknown> }): Slide {
  const a = (content.attrs ?? {}) as Partial<Slide>;
  return {
    bid,
    layout: (a.layout as LayoutId) ?? "blank",
    background: (a.background as SlideBackground) ?? { color: THEME.background },
    notes: (a.notes as string) ?? "",
    elements: Array.isArray(a.elements) ? (a.elements as SlideElement[]) : [],
  };
}

export function slideToBlock(s: Slide) {
  return { id: s.bid, content: { type: "slide", attrs: { bid: s.bid, layout: s.layout, background: s.background, notes: s.notes, elements: s.elements } } };
}

/** Snap a moving box to stage edges/centres and other elements; returns guides to draw. */
export function snap(
  box: { x: number; y: number; w: number; h: number },
  others: { x: number; y: number; w: number; h: number }[],
  threshold: number,
): { x: number; y: number; guides: { v: number[]; h: number[] } } {
  const vTargets = [0, STAGE_W / 2, STAGE_W];
  const hTargets = [0, STAGE_H / 2, STAGE_H];
  for (const o of others) {
    vTargets.push(o.x, o.x + o.w / 2, o.x + o.w);
    hTargets.push(o.y, o.y + o.h / 2, o.y + o.h);
  }
  const best = (edges: number[], targets: number[]) => {
    let pick: { delta: number; at: number } | null = null;
    for (const e of edges) {
      for (const t of targets) {
        const d = t - e;
        if (Math.abs(d) <= threshold && (!pick || Math.abs(d) < Math.abs(pick.delta))) pick = { delta: d, at: t };
      }
    }
    return pick;
  };
  const sx = best([box.x, box.x + box.w / 2, box.x + box.w], vTargets);
  const sy = best([box.y, box.y + box.h / 2, box.y + box.h], hTargets);
  return {
    x: box.x + (sx?.delta ?? 0),
    y: box.y + (sy?.delta ?? 0),
    guides: { v: sx ? [sx.at] : [], h: sy ? [sy.at] : [] },
  };
}
