import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../ui/Icon";
import { freshId, type ConceptGraph, type MapEdge } from "../conceptMap";

/**
 * A concept map as a small world: concepts are points of light you can move
 * between, the way Obsidian shows a vault, with each link's phrase written on it.
 *
 * Drag the space to move, Ctrl and the wheel (or two fingers) to zoom, drag a
 * concept to place it, hover to light up its neighbours. Where the page can be
 * edited: double-click empty space for a new concept, double-click a concept or
 * a phrase to rename it, drag from one concept to another in Link mode (or with
 * Alt) to connect them, Delete to remove. Positions are kept in the diagram code
 * (see conceptMap.ts), so the world opens the same way everywhere.
 */

type Body = { id: string; x: number; y: number; vx: number; vy: number; held: boolean; depth: number; degree: number };
type Camera = { x: number; y: number; k: number };
type Hit = { kind: "node"; id: string } | { kind: "edge"; index: number } | null;
type Editing = { kind: "node"; id: string; value: string } | { kind: "edge"; index: number; value: string } | null;

const DEPTH_COLORS = ["accent", "#47a467", "#e0794a", "#a26bd6", "#d9a62e", "#37b4b8", "#dc5692"];
const LINK_LENGTH = 170;

function cssVar(el: Element, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}
const hasArabic = (s: string) => /[؀-ۿ]/.test(s);

/** Depth of each concept from the concepts nothing points to (the main ideas). */
function depths(graph: ConceptGraph): Map<string, number> {
  const incoming = new Map<string, number>();
  for (const n of graph.nodes) incoming.set(n.id, 0);
  for (const e of graph.edges) incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
  const out = new Map<string, number>();
  const queue = graph.nodes.filter((n) => !incoming.get(n.id)).map((n) => n.id);
  if (!queue.length && graph.nodes.length) queue.push(graph.nodes[0].id);
  for (const id of queue) out.set(id, 0);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    for (const e of graph.edges)
      if (e.from === id && !out.has(e.to)) {
        out.set(e.to, out.get(id)! + 1);
        queue.push(e.to);
      }
  }
  for (const n of graph.nodes) if (!out.has(n.id)) out.set(n.id, 0);
  return out;
}

export function ConceptWorld({
  graph,
  editable,
  arabic,
  full,
  onFull,
  onLayout,
  onGraph,
}: {
  graph: ConceptGraph;
  editable: boolean;
  arabic: boolean;
  full: boolean;
  onFull: (full: boolean) => void;
  /** New positions for the concepts (saved as comments in the code). */
  onLayout: (positions: Record<string, { x: number; y: number }>) => void;
  /** A changed map (only offered when the code is simple enough to rewrite). */
  onGraph: (graph: ConceptGraph) => void;
}) {
  const t = (en: string, ar: string) => (arabic ? ar : en);
  const canEdit = editable && graph.simple;
  const host = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const bodies = useRef(new Map<string, Body>()),
    camera = useRef<Camera>({ x: 0, y: 0, k: 1 }),
    alpha = useRef(1),
    frame = useRef(0),
    size = useRef({ w: 600, h: 420 }),
    graphRef = useRef(graph),
    labelBoxes = useRef<{ index: number; x: number; y: number; w: number; h: number }[]>([]),
    hover = useRef<Hit>(null),
    linkDraft = useRef<{ from: string; x: number; y: number } | null>(null),
    fitted = useRef(false),
    savedOnce = useRef(false);
  const [selected, setSelected] = useState<Hit>(null),
    [linkMode, setLinkMode] = useState(false),
    [editing, setEditing] = useState<Editing>(null),
    [, redraw] = useState(0);
  const selectedRef = useRef<Hit>(null);
  selectedRef.current = selected;
  graphRef.current = graph;
  const depth = useMemo(() => depths(graph), [graph]);

  // Keep a body for every concept; new ones start beside a neighbour or by depth.
  useLayoutEffect(() => {
    const map = bodies.current,
      ids = new Set(graph.nodes.map((n) => n.id));
    for (const id of [...map.keys()]) if (!ids.has(id)) map.delete(id);
    const degree = new Map<string, number>();
    for (const e of graph.edges) {
      degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
      degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
    }
    const vertical = graph.direction === "TD" || graph.direction === "TB" || graph.direction === "BT";
    const perDepth = new Map<number, number>();
    let added = 0;
    for (const n of graph.nodes) {
      const d = depth.get(n.id) ?? 0;
      const slot = perDepth.get(d) ?? 0;
      perDepth.set(d, slot + 1);
      const known = map.get(n.id);
      if (known) {
        known.depth = d;
        known.degree = degree.get(n.id) ?? 0;
        continue;
      }
      const stored = graph.positions[n.id];
      const neighbour = graph.edges.find((e) => e.to === n.id && map.has(e.from)) ?? graph.edges.find((e) => e.from === n.id && map.has(e.to));
      const near = neighbour ? map.get(neighbour.from === n.id ? neighbour.to : neighbour.from) : undefined;
      const spread = (slot % 2 ? 1 : -1) * Math.ceil(slot / 2) * 150;
      const p = stored ?? (near
        ? { x: near.x + (Math.random() - 0.5) * 120, y: near.y + LINK_LENGTH * 0.8 }
        : vertical
          ? { x: spread, y: d * LINK_LENGTH }
          : { x: d * LINK_LENGTH * 1.3, y: spread });
      map.set(n.id, { id: n.id, x: p.x, y: p.y, vx: 0, vy: 0, held: false, depth: d, degree: degree.get(n.id) ?? 0 });
      if (!stored) added++;
    }
    // A map that comes with its layout stays still; anything new settles in.
    alpha.current = Math.max(alpha.current, added ? 1 : 0.04);
    kick();
    // Anything placed over the canvas (the rename box) needs the new points.
    redraw((n) => n + 1);
  }, [graph, depth]);

  const radius = (b: Body) => 7 + Math.sqrt(b.degree) * 3.2 + (b.depth === 0 ? 4 : 0);

  const fit = () => {
    const list = [...bodies.current.values()];
    if (!list.length) return;
    const xs = list.map((b) => b.x),
      ys = list.map((b) => b.y);
    const minX = Math.min(...xs) - 110,
      maxX = Math.max(...xs) + 110,
      minY = Math.min(...ys) - 70,
      maxY = Math.max(...ys) + 90;
    const { w, h } = size.current;
    const k = Math.max(0.15, Math.min(1.6, w / (maxX - minX), h / (maxY - minY)));
    camera.current = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, k };
    kick();
  };

  const step = () => {
    const list = [...bodies.current.values()];
    const a = alpha.current;
    if (a < 0.003) return false;
    // Concepts push each other away, links pull their ends together, the centre holds the world.
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const p = list[i],
          q = list[j];
        let dx = q.x - p.x,
          dy = q.y - p.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          d2 = 1;
        }
        const d = Math.sqrt(d2),
          f = (26000 / d2) * a;
        const fx = (dx / d) * f,
          fy = (dy / d) * f;
        p.vx -= fx;
        p.vy -= fy;
        q.vx += fx;
        q.vy += fy;
      }
    for (const e of graphRef.current.edges) {
      const p = bodies.current.get(e.from),
        q = bodies.current.get(e.to);
      if (!p || !q || p === q) continue;
      const dx = q.x - p.x,
        dy = q.y - p.y,
        d = Math.max(1, Math.hypot(dx, dy)),
        f = (d - LINK_LENGTH) * 0.05 * a;
      p.vx += (dx / d) * f;
      p.vy += (dy / d) * f;
      q.vx -= (dx / d) * f;
      q.vy -= (dy / d) * f;
    }
    let cx = 0,
      cy = 0;
    for (const b of list) {
      cx += b.x;
      cy += b.y;
    }
    cx /= list.length || 1;
    cy /= list.length || 1;
    for (const b of list) {
      if (b.held) {
        b.vx = b.vy = 0;
        continue;
      }
      b.vx = (b.vx - cx * 0.004 * a) * 0.55;
      b.vy = (b.vy - cy * 0.004 * a) * 0.55;
      b.x += Math.max(-40, Math.min(40, b.vx));
      b.y += Math.max(-40, Math.min(40, b.vy));
    }
    alpha.current = a * 0.975;
    return true;
  };

  const toScreen = (x: number, y: number) => {
    const c = camera.current,
      { w, h } = size.current;
    return { x: (x - c.x) * c.k + w / 2, y: (y - c.y) * c.k + h / 2 };
  };
  const toWorld = (sx: number, sy: number) => {
    const c = camera.current,
      { w, h } = size.current;
    return { x: (sx - w / 2) / c.k + c.x, y: (sy - h / 2) / c.k + c.y };
  };

  const draw = () => {
    const el = canvas.current,
      root = host.current;
    if (!el || !root) return;
    const ctx = el.getContext("2d")!;
    const dpr = devicePixelRatio || 1,
      { w, h } = size.current;
    if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const text1 = cssVar(root, "--text-1", "#f5f5f7"),
      text2 = cssVar(root, "--text-2", "#aeaeb2"),
      text3 = cssVar(root, "--text-3", "#8e8e93"),
      accent = cssVar(root, "--accent", "#0a84ff"),
      paper = cssVar(root, "--cw-paper", "#202023"),
      font = getComputedStyle(root).fontFamily;
    const k = camera.current.k;
    const g = graphRef.current;
    // A faint grid of dots that moves with the world, so moving feels like moving.
    const step = 32 * k;
    if (step > 9) {
      const o = toScreen(0, 0);
      ctx.fillStyle = text3;
      ctx.globalAlpha = 0.16;
      for (let x = ((o.x % step) + step) % step; x < w; x += step)
        for (let y = ((o.y % step) + step) % step; y < h; y += step) ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
      ctx.globalAlpha = 1;
    }
    const focus = hover.current?.kind === "node" ? hover.current.id : selectedRef.current?.kind === "node" ? selectedRef.current.id : null;
    const near = new Set<string>();
    if (focus) {
      near.add(focus);
      for (const e of g.edges) {
        if (e.from === focus) near.add(e.to);
        if (e.to === focus) near.add(e.from);
      }
    }
    const lit = (e: MapEdge) => !!focus && (e.from === focus || e.to === focus);
    const colorOf = (b: Body) => {
      const c = DEPTH_COLORS[b.depth % DEPTH_COLORS.length];
      return c === "accent" ? accent : c;
    };
    // Links
    labelBoxes.current = [];
    g.edges.forEach((e, index) => {
      const p = bodies.current.get(e.from),
        q = bodies.current.get(e.to);
      if (!p || !q) return;
      const a = toScreen(p.x, p.y),
        b = toScreen(q.x, q.y);
      const dx = b.x - a.x,
        dy = b.y - a.y,
        d = Math.max(1, Math.hypot(dx, dy));
      const ra = radius(p) * k + 2,
        rb = radius(q) * k + 3;
      const sx = a.x + (dx / d) * ra,
        sy = a.y + (dy / d) * ra,
        ex = b.x - (dx / d) * rb,
        ey = b.y - (dy / d) * rb;
      const on = lit(e) || (selectedRef.current?.kind === "edge" && selectedRef.current.index === index);
      const dim = !!focus && !on;
      ctx.strokeStyle = on ? accent : text3;
      ctx.globalAlpha = dim ? 0.18 : on ? 0.95 : 0.55;
      ctx.lineWidth = (e.style === "thick" ? 2.6 : 1.4) * Math.max(0.7, Math.min(1.4, k));
      ctx.setLineDash(e.style === "dotted" ? [5, 5] : []);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.setLineDash([]);
      if (e.style !== "line") {
        const s = 7 * Math.max(0.7, Math.min(1.3, k)),
          ang = Math.atan2(dy, dx);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - s * Math.cos(ang - 0.42), ey - s * Math.sin(ang - 0.42));
        ctx.lineTo(ex - s * Math.cos(ang + 0.42), ey - s * Math.sin(ang + 0.42));
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (e.label.trim() && (k >= 0.5 || on)) {
        const size = Math.max(10, Math.min(13, 12 * k));
        ctx.font = `500 ${size}px ${font}`;
        ctx.direction = hasArabic(e.label) ? "rtl" : "ltr";
        const tw = ctx.measureText(e.label).width,
          mx = (sx + ex) / 2,
          my = (sy + ey) / 2,
          bw = tw + 14,
          bh = size + 9;
        ctx.globalAlpha = dim ? 0.3 : 1;
        ctx.fillStyle = paper;
        ctx.strokeStyle = on ? accent : text3;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(mx - bw / 2, my - bh / 2, bw, bh, bh / 2);
        ctx.fill();
        ctx.globalAlpha = dim ? 0.15 : 0.45;
        ctx.stroke();
        ctx.globalAlpha = dim ? 0.3 : 1;
        ctx.fillStyle = on ? text1 : text2;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(e.label, mx, my + 0.5);
        ctx.globalAlpha = 1;
        labelBoxes.current.push({ index, x: mx - bw / 2, y: my - bh / 2, w: bw, h: bh });
      }
    });
    // The link being drawn
    const draft = linkDraft.current;
    if (draft) {
      const from = bodies.current.get(draft.from);
      if (from) {
        const a = toScreen(from.x, from.y);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(draft.x, draft.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    // Concepts
    const labelSize = Math.max(11, Math.min(15, 13.5 * Math.sqrt(k)));
    for (const n of g.nodes) {
      const b = bodies.current.get(n.id);
      if (!b) continue;
      const s = toScreen(b.x, b.y),
        r = radius(b) * k;
      if (s.x < -200 || s.y < -200 || s.x > w + 200 || s.y > h + 200) continue;
      const dim = !!focus && !near.has(n.id);
      const isSel = selectedRef.current?.kind === "node" && selectedRef.current.id === n.id;
      const isHover = hover.current?.kind === "node" && hover.current.id === n.id;
      const color = colorOf(b);
      ctx.globalAlpha = dim ? 0.25 : 1;
      if (isHover || isSel || n.id === focus) {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.22;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r + 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = dim ? 0.25 : 1;
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (isSel) {
        ctx.strokeStyle = text1;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (k >= 0.35 || near.has(n.id) || isSel) {
        ctx.font = `${b.depth === 0 ? 650 : 520} ${b.depth === 0 ? labelSize + 1.5 : labelSize}px ${font}`;
        ctx.direction = hasArabic(n.label) ? "rtl" : "ltr";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.lineJoin = "round";
        ctx.lineWidth = 4;
        ctx.strokeStyle = paper;
        ctx.strokeText(n.label, s.x, s.y + r + 6);
        ctx.fillStyle = dim ? text3 : text1;
        ctx.fillText(n.label, s.x, s.y + r + 6);
      }
      ctx.globalAlpha = 1;
    }
  };

  function kick() {
    if (frame.current) return;
    const loop = () => {
      frame.current = 0;
      const moving = step();
      draw();
      if (moving || linkDraft.current) frame.current = requestAnimationFrame(loop);
      else settle();
    };
    frame.current = requestAnimationFrame(loop);
  }

  // When the world first comes to rest, its layout is written into the code once.
  function settle() {
    if (savedOnce.current || !editable) return;
    const g = graphRef.current;
    if (g.nodes.every((n) => g.positions[n.id])) {
      savedOnce.current = true;
      return;
    }
    savedOnce.current = true;
    saveLayout();
  }
  function saveLayout() {
    if (!editable) return;
    const out: Record<string, { x: number; y: number }> = {};
    for (const b of bodies.current.values()) out[b.id] = { x: Math.round(b.x), y: Math.round(b.y) };
    onLayout(out);
  }

  // Full screen puts the world in a new place on the page: measure it again and frame the map.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    fitted.current = false;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      size.current = { w: Math.max(50, r.width), h: Math.max(50, r.height) };
      if (!fitted.current && bodies.current.size) {
        // Let a fresh layout spread a little before framing it.
        for (let i = 0; i < 120 && alpha.current > 0.05; i++) step();
        fit();
        fitted.current = true;
      }
      draw();
    });
    ro.observe(el);
    if (full) el.focus();
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [full]);

  useEffect(() => {
    draw();
  });

  const hitAt = (sx: number, sy: number): Hit => {
    for (const box of labelBoxes.current) if (sx >= box.x && sx <= box.x + box.w && sy >= box.y && sy <= box.y + box.h) return { kind: "edge", index: box.index };
    const k = camera.current.k;
    let best: Hit = null,
      bestD = Infinity;
    for (const b of bodies.current.values()) {
      const s = toScreen(b.x, b.y),
        d = Math.hypot(s.x - sx, s.y - sy);
      if (d <= Math.max(14, radius(b) * k + 6) && d < bestD) {
        best = { kind: "node", id: b.id };
        bestD = d;
      }
    }
    return best;
  };

  // Pointer handling: one pointer pans or drags, two pointers pinch.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<
    | { type: "pan"; sx: number; sy: number; cam: Camera; moved: boolean }
    | { type: "drag"; id: string; moved: boolean }
    | { type: "link"; from: string }
    | { type: "pinch"; d: number; k: number; mid: { x: number; y: number }; cam: Camera }
    | null
  >(null);
  const local = (e: { clientX: number; clientY: number }) => {
    const r = host.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (editing) return;
    // No text selection and no dragging of the whole block from inside the world.
    e.preventDefault();
    host.current?.focus();
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { type: "pinch", d: Math.hypot(a.x - b.x, a.y - b.y), k: camera.current.k, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, cam: { ...camera.current } };
      return;
    }
    const hit = hitAt(p.x, p.y);
    if (hit?.kind === "node" && canEdit && (linkMode || e.altKey)) {
      gesture.current = { type: "link", from: hit.id };
      linkDraft.current = { from: hit.id, x: p.x, y: p.y };
      kick();
      return;
    }
    if (hit?.kind === "node") {
      const b = bodies.current.get(hit.id)!;
      b.held = true;
      gesture.current = { type: "drag", id: hit.id, moved: false };
      setSelected(hit);
      return;
    }
    if (hit?.kind === "edge") {
      setSelected(hit);
      gesture.current = null;
      return;
    }
    gesture.current = { type: "pan", sx: p.x, sy: p.y, cam: { ...camera.current }, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = local(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g) {
      const hit = hitAt(p.x, p.y);
      const same = JSON.stringify(hit) === JSON.stringify(hover.current);
      hover.current = hit;
      if (host.current) host.current.style.cursor = hit ? "pointer" : "grab";
      if (!same) draw();
      return;
    }
    if (g.type === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt(g.mid.x, g.mid.y, Math.max(0.15, Math.min(3, (g.k * d) / Math.max(1, g.d))), g.cam);
      return;
    }
    if (g.type === "pan") {
      if (Math.hypot(p.x - g.sx, p.y - g.sy) > 3) g.moved = true;
      camera.current = { ...g.cam, x: g.cam.x - (p.x - g.sx) / g.cam.k, y: g.cam.y - (p.y - g.sy) / g.cam.k };
      if (host.current) host.current.style.cursor = "grabbing";
      draw();
      return;
    }
    if (g.type === "drag") {
      const b = bodies.current.get(g.id);
      if (!b) return;
      const w = toWorld(p.x, p.y);
      b.x = w.x;
      b.y = w.y;
      g.moved = true;
      alpha.current = Math.max(alpha.current, 0.3);
      kick();
      return;
    }
    if (g.type === "link" && linkDraft.current) {
      linkDraft.current = { ...linkDraft.current, x: p.x, y: p.y };
      hover.current = hitAt(p.x, p.y);
      kick();
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.type === "drag") {
      const b = bodies.current.get(g.id);
      if (b) b.held = false;
      if (g.moved) saveLayout();
    }
    if (g.type === "pan" && !g.moved) setSelected(null);
    if (g.type === "link") {
      const p = local(e),
        hit = hitAt(p.x, p.y);
      linkDraft.current = null;
      if (hit?.kind === "node" && hit.id !== g.from) {
        const next = structuredClone(graphRef.current);
        next.edges.push({ from: g.from, to: hit.id, label: "", style: "arrow" });
        onGraph(next);
        setEditing({ kind: "edge", index: next.edges.length - 1, value: "" });
      }
      draw();
    }
    if (host.current) host.current.style.cursor = "grab";
  };

  function zoomAt(sx: number, sy: number, k: number, from = camera.current) {
    const { w, h } = size.current;
    const wx = (sx - w / 2) / from.k + from.x,
      wy = (sy - h / 2) / from.k + from.y;
    camera.current = { k, x: wx - (sx - w / 2) / k, y: wy - (sy - h / 2) / k };
    draw();
  }

  // Ctrl and the wheel zoom (a plain wheel keeps scrolling the page); in full screen the wheel always zooms.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey || full)) return;
      e.preventDefault();
      const p = local(e);
      zoomAt(p.x, p.y, Math.max(0.15, Math.min(3, camera.current.k * Math.exp(-e.deltaY * 0.0018))));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [full]);

  const addConcept = (at?: { x: number; y: number }) => {
    if (!canEdit) return;
    const next = structuredClone(graphRef.current);
    const id = freshId(next);
    const w = at ?? { x: camera.current.x + (Math.random() - 0.5) * 60, y: camera.current.y + (Math.random() - 0.5) * 60 };
    next.nodes.push({ id, label: t("New concept", "مفهوم جديد"), shape: "rect" });
    next.positions = { ...next.positions, [id]: { x: Math.round(w.x), y: Math.round(w.y) } };
    onGraph(next);
    setSelected({ kind: "node", id });
    setEditing({ kind: "node", id, value: "" });
  };

  const removeSelected = () => {
    const s = selectedRef.current;
    if (!s || !canEdit) return;
    const next = structuredClone(graphRef.current);
    if (s.kind === "node") {
      next.nodes = next.nodes.filter((n) => n.id !== s.id);
      next.edges = next.edges.filter((e) => e.from !== s.id && e.to !== s.id);
      delete next.positions[s.id];
    } else next.edges.splice(s.index, 1);
    setSelected(null);
    onGraph(next);
  };

  const commitEdit = () => {
    const ed = editing;
    setEditing(null);
    if (!ed || !canEdit) return;
    const next = structuredClone(graphRef.current);
    const value = ed.value.trim();
    if (ed.kind === "node") {
      const n = next.nodes.find((x) => x.id === ed.id);
      if (!n || !value) return;
      n.label = value;
    } else {
      const edge = next.edges[ed.index];
      if (!edge) return;
      edge.label = value;
    }
    onGraph(next);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!canEdit) return;
    const p = local(e),
      hit = hitAt(p.x, p.y);
    if (hit?.kind === "node") {
      const n = graphRef.current.nodes.find((x) => x.id === hit.id);
      if (n) setEditing({ kind: "node", id: n.id, value: n.label });
    } else if (hit?.kind === "edge") setEditing({ kind: "edge", index: hit.index, value: graphRef.current.edges[hit.index]?.label ?? "" });
    else addConcept(toWorld(p.x, p.y));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (editing) return;
    if ((e.key === "Delete" || e.key === "Backspace") && selectedRef.current) {
      e.preventDefault();
      removeSelected();
    } else if (e.key === "Escape") {
      if (linkMode) setLinkMode(false);
      else if (full) onFull(false);
      else setSelected(null);
    } else if (e.key === "Enter" && selectedRef.current && canEdit) {
      e.preventDefault();
      const s = selectedRef.current;
      if (s.kind === "node") setEditing({ kind: "node", id: s.id, value: graphRef.current.nodes.find((n) => n.id === s.id)?.label ?? "" });
      else setEditing({ kind: "edge", index: s.index, value: graphRef.current.edges[s.index]?.label ?? "" });
    } else if (e.key === "+" || e.key === "=") zoomAt(size.current.w / 2, size.current.h / 2, Math.min(3, camera.current.k * 1.2));
    else if (e.key === "-") zoomAt(size.current.w / 2, size.current.h / 2, Math.max(0.15, camera.current.k / 1.2));
  };

  // Where the rename box sits: under the concept, or on the link's phrase.
  const editBox = (() => {
    if (!editing) return null;
    if (editing.kind === "node") {
      const b = bodies.current.get(editing.id);
      if (!b) return null;
      const s = toScreen(b.x, b.y);
      return { x: s.x, y: s.y + radius(b) * camera.current.k + 4 };
    }
    const e = graph.edges[editing.index];
    const p = e && bodies.current.get(e.from),
      q = e && bodies.current.get(e.to);
    if (!p || !q) return null;
    const a = toScreen(p.x, p.y),
      b = toScreen(q.x, q.y);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 14 };
  })();

  const world = (
    <div
      className={`cw ${full ? "is-full" : ""}`}
      dir={arabic ? "rtl" : "ltr"}
      translate="no"
      draggable={false}
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="cw-bar">
        <button type="button" className="cw-btn" onClick={() => (fit(), draw())} title={t("Fit the map", "إظهار الخريطة كاملة")} aria-label={t("Fit the map", "إظهار الخريطة كاملة")}>
          <Icon name="expand" size={15} />
        </button>
        <button type="button" className="cw-btn" onClick={() => zoomAt(size.current.w / 2, size.current.h / 2, Math.min(3, camera.current.k * 1.25))} aria-label={t("Zoom in", "تكبير")} title={t("Zoom in", "تكبير")}>
          +
        </button>
        <button type="button" className="cw-btn" onClick={() => zoomAt(size.current.w / 2, size.current.h / 2, Math.max(0.15, camera.current.k / 1.25))} aria-label={t("Zoom out", "تصغير")} title={t("Zoom out", "تصغير")}>
          −
        </button>
        {canEdit && (
          <>
            <span className="cw-sep" />
            <button type="button" className="cw-btn cw-wide" onClick={() => addConcept()}>
              <Icon name="add" size={14} /> {t("Concept", "مفهوم")}
            </button>
            <button type="button" className="cw-btn cw-wide" aria-pressed={linkMode} onClick={() => setLinkMode(!linkMode)} title={t("Drag from one concept to another", "اسحب من مفهوم إلى آخر")}>
              <Icon name="link" size={14} /> {t("Link", "ربط")}
            </button>
            {selected && (
              <button type="button" className="cw-btn" onClick={removeSelected} aria-label={t("Delete", "حذف")} title={t("Delete", "حذف")}>
                <Icon name="delete" size={14} />
              </button>
            )}
          </>
        )}
        <span className="cw-grow" />
        <button type="button" className="cw-btn" onClick={() => (saveLayout(), onFull(!full))} aria-label={full ? t("Exit full screen", "إنهاء ملء الشاشة") : t("Full screen", "ملء الشاشة")} title={full ? t("Exit full screen", "إنهاء ملء الشاشة") : t("Full screen", "ملء الشاشة")}>
          <Icon name={full ? "minimize" : "maximize"} size={15} />
        </button>
      </div>
      <div
        ref={host}
        className="cw-space"
        tabIndex={0}
        role="application"
        aria-label={t("Concept map", "خريطة مفاهيم")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          if (!gesture.current && hover.current) {
            hover.current = null;
            draw();
          }
        }}
        onMouseDown={(e) => e.preventDefault()}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
      >
        <canvas ref={canvas} />
        {editing && editBox && (
          <input
            className="cw-edit"
            autoFocus
            dir="auto"
            style={{ left: editBox.x, top: editBox.y }}
            value={editing.value}
            placeholder={editing.kind === "node" ? t("Concept name", "اسم المفهوم") : t("Linking phrase, like leads to", "عبارة الربط، مثل يؤدي إلى")}
            onChange={(e) => setEditing({ ...editing, value: e.target.value } as Editing)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") commitEdit();
              if (e.key === "Escape") setEditing(null);
            }}
            onBlur={commitEdit}
            onPointerDown={(e) => e.stopPropagation()}
          />
        )}
      </div>
      <p className="cw-hint">
        {canEdit
          ? t(
              "Drag to move around · Ctrl and the wheel to zoom · double-click to add or rename · Link joins two concepts",
              "اسحب للتنقل · Ctrl مع العجلة للتكبير · انقر مرتين للإضافة أو التسمية · ربط يصل مفهومين",
            )
          : t("Drag to move around · Ctrl and the wheel to zoom", "اسحب للتنقل · Ctrl مع العجلة للتكبير")}
      </p>
    </div>
  );
  return full ? createPortal(world, document.body) : world;
}
