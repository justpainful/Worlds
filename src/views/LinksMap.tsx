/**
 * The links map: every page as a dot, every link between pages as a line,
 * laid out by a small force simulation. Drag to move around, scroll to zoom,
 * click a page to open it. Subpages can be shown as links too.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { api } from "../lib/api";
import type { PageMeta } from "../lib/types";
import { useStore, pageTitle } from "../state/store";
import { isResource } from "../resources/kinds";
import { tr, uiLanguage } from "../i18n/ui";
import { Icon } from "../ui/Icon";
import { SearchField } from "../ui/SearchField";

interface Node {
  id: string;
  title: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  degree: number;
}

function layout(nodes: Node[], edges: [number, number][], steps = 260) {
  const k = 70;
  for (let s = 0; s < steps; s++) {
    const t = 1 - s / steps;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          d2 = 0.5;
        }
        if (d2 > 250000) continue;
        const f = (k * k) / d2;
        a.vx += dx * f * 0.02;
        a.vy += dy * f * 0.02;
        b.vx -= dx * f * 0.02;
        b.vy -= dy * f * 0.02;
      }
    }
    for (const [i, j] of edges) {
      const a = nodes[i];
      const b = nodes[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - k) * 0.02;
      a.vx += (dx / d) * f * d * 0.05;
      a.vy += (dy / d) * f * d * 0.05;
      b.vx -= (dx / d) * f * d * 0.05;
      b.vy -= (dy / d) * f * d * 0.05;
    }
    for (const n of nodes) {
      n.vx -= n.x * 0.004;
      n.vy -= n.y * 0.004;
      const sp = Math.min(30, Math.hypot(n.vx, n.vy));
      const ang = Math.atan2(n.vy, n.vx);
      n.x += Math.cos(ang) * sp * t;
      n.y += Math.sin(ang) * sp * t;
      n.vx *= 0.5;
      n.vy *= 0.5;
    }
  }
}

function LinksMap({ close }: { close: () => void }) {
  const pages = useStore((s) => s.pages);
  const [links, setLinks] = useState<[string, string][] | null>(null);
  const [withTree, setWithTree] = useState(false);
  const [query, setQuery] = useState("");
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, z: 1 });
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  useEffect(() => {
    api
      .linkGraph()
      .then(setLinks)
      .catch(() => setLinks([]));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const graph = useMemo(() => {
    if (!links) return null;
    const live = (p?: PageMeta) => !!p && !p.deletedAt && !p.archived && isResource(p);
    const pairs = new Set<string>();
    const add = (a: string, b: string) => {
      if (a !== b && live(pages[a]) && live(pages[b])) pairs.add(a < b ? `${a}|${b}` : `${b}|${a}`);
    };
    for (const [a, b] of links) add(a, b);
    if (withTree) for (const p of Object.values(pages)) if (p.parentId) add(p.parentId, p.id);
    const ids = new Set<string>();
    for (const pr of pairs) pr.split("|").forEach((id) => ids.add(id));
    const nodes: Node[] = [...ids].map((id, i) => {
      const a = (i / Math.max(1, ids.size)) * Math.PI * 2;
      const r = 40 + Math.sqrt(i) * 30;
      return { id, title: pageTitle(pages[id]), x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, degree: 0 };
    });
    const index = new Map(nodes.map((n, i) => [n.id, i]));
    const edges: [number, number][] = [...pairs].map((pr) => {
      const [a, b] = pr.split("|");
      return [index.get(a)!, index.get(b)!];
    });
    for (const [a, b] of edges) {
      nodes[a].degree++;
      nodes[b].degree++;
    }
    layout(nodes, edges);
    const unlinked = Object.values(pages).filter((p) => live(p) && !ids.has(p.id)).length;
    return { nodes, edges, unlinked };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [links, withTree]);

  const q = query.trim().toLowerCase();
  const neighbours = useMemo(() => {
    const set = new Set<string>();
    if (!graph || !hover) return set;
    for (const [a, b] of graph.edges) {
      if (graph.nodes[a].id === hover) set.add(graph.nodes[b].id);
      if (graph.nodes[b].id === hover) set.add(graph.nodes[a].id);
    }
    return set;
  }, [graph, hover]);

  const open = (id: string) => {
    useStore.getState().openPage(id);
    close();
  };

  return (
    <div className="links-map" dir={uiLanguage() === "ar" ? "rtl" : "ltr"} role="dialog" aria-label={tr("Links map")}>
      <header className="lm-head">
        <Icon name="graph" size={18} />
        <h2>{tr("Links map")}</h2>
        <span className="lm-note">{graph ? `${graph.nodes.length} ${tr("linked pages")} · ${graph.unlinked} ${tr("without links")}` : tr("Loading")}</span>
        <span className="grow" />
        <SearchField size="compact" placeholder={tr("Find a page")} value={query} onChange={setQuery} />
        <label className="lm-check">
          <input type="checkbox" checked={withTree} onChange={(e) => setWithTree(e.target.checked)} />
          {tr("Show subpages")}
        </label>
        <button className="icon-btn" aria-label={tr("Close")} onClick={close}>
          <Icon name="close" size={16} />
        </button>
      </header>
      <div
        ref={box}
        className="lm-canvas"
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
        }}
        onPointerMove={(e) => drag.current && setView({ ...view, x: drag.current.vx + e.clientX - drag.current.x, y: drag.current.vy + e.clientY - drag.current.y })}
        onPointerUp={() => (drag.current = null)}
        onWheel={(e) => setView({ ...view, z: Math.min(4, Math.max(0.2, view.z * (e.deltaY < 0 ? 1.12 : 1 / 1.12))) })}
      >
        {graph && graph.nodes.length === 0 && <p className="lm-empty">{tr("No pages link to each other yet. Mention a page with @ to link it.")}</p>}
        {graph && (
          <svg className="lm-svg" width="100%" height="100%">
            <g transform={`translate(${(box.current?.clientWidth ?? 800) / 2 + view.x} ${(box.current?.clientHeight ?? 600) / 2 + view.y}) scale(${view.z})`}>
              {graph.edges.map(([a, b], i) => {
                const na = graph.nodes[a];
                const nb = graph.nodes[b];
                const lit = hover && (na.id === hover || nb.id === hover);
                return <line key={i} x1={na.x} y1={na.y} x2={nb.x} y2={nb.y} className={`lm-edge ${lit ? "is-lit" : hover ? "is-dim" : ""}`} />;
              })}
              {graph.nodes.map((n) => {
                const match = q && n.title.toLowerCase().includes(q);
                const dim = (hover && n.id !== hover && !neighbours.has(n.id)) || (q && !match);
                const r = 4 + Math.min(10, Math.sqrt(n.degree) * 2.4);
                return (
                  <g
                    key={n.id}
                    className={`lm-node ${dim ? "is-dim" : ""} ${match || n.id === hover ? "is-on" : ""}`}
                    transform={`translate(${n.x} ${n.y})`}
                    onPointerEnter={() => setHover(n.id)}
                    onPointerLeave={() => setHover(null)}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => open(n.id)}
                  >
                    <circle r={r} />
                    {(view.z > 0.7 || n.degree > 2 || n.id === hover || match) && (
                      <text y={r + 13} textAnchor="middle">
                        {n.title.length > 28 ? `${n.title.slice(0, 27)}...` : n.title}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        )}
      </div>
    </div>
  );
}

let openMap: (() => void) | null = null;

export function openLinksMap() {
  openMap?.();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const close = () => {
    root.unmount();
    host.remove();
    openMap = null;
  };
  openMap = close;
  root.render(<LinksMap close={close} />);
}
