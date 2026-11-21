/**
 * The world: your workspace as hand-drawn islands you can pan, zoom and walk
 * into. Built from your data by the rules in world.ts.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { pageTitle, useStore } from "../state/store";
import { tr } from "../i18n/ui";
import { Icon } from "../ui/Icon";
import { DATA_KINDS } from "../planning/model";
import { cardState, dayOf } from "./model";
import { useCognition } from "./store";
import { buildWorld, type House, type Island } from "./world";

const LAND = ["#F6E7C1", "#E9F2C8", "#F7DCE6", "#DDE8FA", "#F9EBC8"];
const ROOF = ["#FF9EC6", "#055BEE", "#FFD63D", "#FF9EC6", "#055BEE"];
const INK = "#171820";

export function WorldView() {
  const pagesMap = useStore((s) => s.pages);
  const openPage = useStore((s) => s.openPage);
  const cards = useCognition("cards");
  const questions = useCognition("questions");
  const sparks = useCognition("sparks");
  const aha = useCognition("aha");
  const [links, setLinks] = useState<[string, string][]>([]);
  const [hover, setHover] = useState<{ house: House; island: Island } | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  useEffect(() => {
    api.linkGraph().then(setLinks).catch(() => setLinks([]));
  }, [pagesMap]);

  const world = useMemo(() => {
    const today = dayOf(Date.now());
    const hidden = new Set<string>([...DATA_KINDS, "template"]);
    const pages = Object.values(pagesMap)
      .filter((p) => !p.deletedAt && !p.archived && !hidden.has(p.kind))
      .map((p) => ({ id: p.id, title: pageTitle(p), parentId: p.parentId, kind: p.kind, size: (p.preview ?? "").length + 40, touched: p.openedAt ?? p.updatedAt }));
    const q: Record<string, number> = {};
    for (const x of questions) if (x.state !== "resolved" && x.pageId) q[x.pageId] = (q[x.pageId] ?? 0) + 1;
    const per: Record<string, { all: number; kept: number }> = {};
    for (const c of cards) {
      if (!c.pageId || c.outdated) continue;
      const e = (per[c.pageId] ??= { all: 0, kept: 0 });
      e.all += 1;
      if (cardState(c, today) === "remembered") e.kept += 1;
    }
    const mastery = Object.fromEntries(Object.entries(per).map(([k, v]) => [k, v.kept / v.all]));
    return buildWorld({ pages, links, sparks: sparks.map((s) => [s.a.pageId, s.b.pageId] as [string, string]), questions: q, mastery, stars: aha.length + sparks.length, now: Date.now() });
  }, [pagesMap, links, cards, questions, sparks, aha]);

  // Fit the whole world on first sight.
  useEffect(() => {
    const el = box.current;
    if (!el || !world.width) return;
    const k = Math.min(el.clientWidth / world.width, el.clientHeight / world.height, 1.4);
    setView({ k, x: (el.clientWidth - world.width * k) / 2, y: (el.clientHeight - world.height * k) / 2 });
  }, [world.width, world.height]);

  const hour = new Date().getHours();
  const night = hour < 6 || hour >= 19;

  const onWheel = (e: React.WheelEvent) => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const k = Math.min(3, Math.max(0.25, view.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    setView({ k, x: mx - ((mx - view.x) / view.k) * k, y: my - ((my - view.y) / view.k) * k });
  };

  const empty = world.islands.length === 0;

  return (
    <div className="cg-stack">
      <div className="cg-ask">
        <Icon name="globe" size={22} />
        <p className="cg-note cg-grow">
          {tr("Each top-level page is an island and the pages under it are its houses. Links are bridges, sparks glow, open questions are fog, and pages you have not opened for a month grow grass. Stars are your Aha! moments.")}
        </p>
      </div>
      <div
        ref={box}
        className={`cg-world ${night ? "is-night" : ""}`}
        onWheel={onWheel}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
        }}
        onPointerUp={() => (drag.current = null)}
      >
        {empty ? (
          <div className="cg-empty">
            <div className="cg-empty-title">{tr("Your world is still empty")}</div>
            <div className="cg-empty-text">{tr("Make a page and it becomes your first island.")}</div>
          </div>
        ) : (
          <svg width="100%" height="100%" role="img" aria-label={tr("Your world")}>
            <defs>
              <pattern id="cg-waves" width="46" height="22" patternUnits="userSpaceOnUse">
                <path d="M4 12 q5 -5 10 0 t10 0" fill="none" stroke={night ? "rgba(255,255,255,.10)" : "rgba(5,91,238,.16)"} strokeWidth="1.6" strokeLinecap="round" />
              </pattern>
              <filter id="cg-fog" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="9" />
              </filter>
            </defs>
            <rect width="100%" height="100%" fill="url(#cg-waves)" />
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
              {world.stars.map((s, i) => (
                <path key={i} d={`M${s.x} ${s.y - 6 * s.s} L${s.x + 1.6 * s.s} ${s.y - 1.6 * s.s} L${s.x + 6 * s.s} ${s.y} L${s.x + 1.6 * s.s} ${s.y + 1.6 * s.s} L${s.x} ${s.y + 6 * s.s} L${s.x - 1.6 * s.s} ${s.y + 1.6 * s.s} L${s.x - 6 * s.s} ${s.y} L${s.x - 1.6 * s.s} ${s.y - 1.6 * s.s}Z`} fill="#FFD63D" stroke={INK} strokeWidth="1.2" className="cg-star" style={{ animationDelay: `${(i % 7) * 0.4}s` }} />
              ))}
              {world.bridges.map((b) => (
                <g key={b.from + b.to} className={b.spark ? "cg-bridge is-spark" : "cg-bridge"}>
                  <path d={b.path} fill="none" stroke={INK} strokeWidth={6 + Math.min(6, b.weight * 1.5)} strokeLinecap="round" />
                  <path d={b.path} fill="none" stroke={b.spark ? "#FF9EC6" : "#C9A26B"} strokeWidth={3 + Math.min(6, b.weight * 1.5)} strokeLinecap="round" strokeDasharray={b.spark ? undefined : "2 7"} />
                </g>
              ))}
              {world.islands.map((isl, i) => (
                <g key={isl.id} className="cg-island">
                  <path d={isl.path} fill={night ? "#2c3a33" : "#7FC8F8"} opacity=".35" transform="translate(5 8)" />
                  <path d={isl.path} fill={LAND[i % LAND.length]} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
                  {isl.houses.map((h) => (
                    <HouseShape key={h.id} h={h} roof={ROOF[(i + h.id.length) % ROOF.length]} onOpen={() => openPage(h.id)} onHover={(on) => setHover(on ? { house: h, island: isl } : null)} />
                  ))}
                  {isl.fog > 0 && (
                    <g filter="url(#cg-fog)" opacity={Math.min(0.75, 0.3 + isl.fog * 0.12)} pointerEvents="none">
                      <ellipse cx={isl.x - isl.r * 0.2} cy={isl.y - isl.r * 0.25} rx={isl.r * 0.55} ry={isl.r * 0.22} fill="#ffffff" />
                      <ellipse cx={isl.x + isl.r * 0.25} cy={isl.y - isl.r * 0.1} rx={isl.r * 0.45} ry={isl.r * 0.18} fill="#ffffff" />
                    </g>
                  )}
                  <text x={isl.x} y={isl.y + isl.r * 0.78 + 26} textAnchor="middle" className="cg-island-name">
                    {isl.title.length > 28 ? isl.title.slice(0, 27) + "..." : isl.title}
                  </text>
                </g>
              ))}
            </g>
          </svg>
        )}
        {hover && (
          <div className="cg-world-tip">
            <b className="bidi" dir="auto">{hover.house.title || tr("Untitled")}</b>
            <span>
              {hover.island.title}
              {hover.house.tower ? ` · ${tr("well remembered")}` : ""}
              {hover.house.overgrown ? ` · ${tr("not opened for a month")}` : ""}
            </span>
          </div>
        )}
        <div className="cg-world-zoom">
          <button className="cg-icon-btn" title={tr("Zoom in")} onClick={() => setView((v) => ({ ...v, k: Math.min(3, v.k * 1.25) }))}>
            <Icon name="add" size={16} />
          </button>
          <button className="cg-icon-btn" title={tr("Zoom out")} onClick={() => setView((v) => ({ ...v, k: Math.max(0.25, v.k / 1.25) }))}>
            <Icon name="minimize" size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function HouseShape({ h, roof, onOpen, onHover }: { h: House; roof: string; onOpen: () => void; onHover: (on: boolean) => void }) {
  const x = h.x - h.w / 2;
  const y = h.y - h.h;
  return (
    <g className="cg-house" onClick={onOpen} onPointerEnter={() => onHover(true)} onPointerLeave={() => onHover(false)} onPointerDown={(e) => e.stopPropagation()}>
      {h.tower && <rect x={h.x + h.w / 2 - 9} y={y - 22} width="11" height={h.h + 22} fill="#FFF3D9" stroke={INK} strokeWidth="2.2" />}
      {h.tower && <path d={`M${h.x + h.w / 2 - 11} ${y - 22} L${h.x + h.w / 2 - 3.5} ${y - 34} L${h.x + h.w / 2 + 4} ${y - 22}Z`} fill="#FFD63D" stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />}
      <rect x={x} y={y} width={h.w} height={h.h} rx="2" fill="#FFF3D9" stroke={INK} strokeWidth="2.4" />
      <path d={`M${x - 4} ${y + 1} L${h.x} ${y - h.roof} L${x + h.w + 4} ${y + 1}Z`} fill={roof} stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
      <rect x={h.x - 3} y={h.y - Math.min(10, h.h * 0.55)} width="6" height={Math.min(10, h.h * 0.55)} fill={INK} rx="1" />
      {h.overgrown && (
        <path d={`M${x - 3} ${h.y + 1} q3 -9 5 0 q2 -7 4 0 q2 -10 5 0 M${x + h.w - 9} ${h.y + 1} q2 -8 4 0 q2 -6 5 0`} fill="none" stroke="#2E9E62" strokeWidth="2" strokeLinecap="round" />
      )}
    </g>
  );
}
