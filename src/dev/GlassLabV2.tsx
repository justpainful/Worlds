/**
 * Dev only (?glasslab2): Liquid Glass V2 against the reference and the
 * current engine, at identical scale, with switches that isolate each part
 * of the pipeline, debug views of the maps, and the surface profile curves.
 * Backdrop images live in .lab/ (git-ignored).
 *
 * ?only=<prefix> shows one section; ?p=<curve power> overrides the candidate's curve.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { GlassV2, debugV2, mapsOf, setDebugV2, statsV2, type DebugV2 } from "../glass/v2/GlassV2";
import { regularToolbarV2, regularToolbarV2Phase1, regularToolbarV2Phase1_1, type ProfileV2 } from "../glass/v2/profile";
import { displacement, makeSdf, surfaceAt, surfaceSpec } from "../glass/v2/surface";
import { GlassGroup } from "../ui/Button";
import { Icon, type IconName } from "../ui/Icon";

const W = 630;
const H = 120;
const TOP = 40; // capsule top inside a panel (the reference's toolbar band)
const BAND = 64; // where that band starts in the 630x340 backdrop

const GROUPS: { x: number; w: number; icons: IconName[] }[] = [
  { x: 19.25, w: 79, icons: ["listView", "more"] },
  { x: 118.5, w: 40.5, icons: ["edit"] },
  { x: 202, w: 122.5, icons: ["back", "undo", "forward"] },
  { x: 332, w: 123, icons: ["archive", "delete", "close"] },
];

function V2Group({ icons, w, profile, debugMaps }: { icons: IconName[]; w: number; profile: ProfileV2; debugMaps?: boolean }) {
  return (
    <GlassV2 style={{ width: w, height: 40 }} radius={20} profile={profile} debugMaps={debugMaps} className="lab2-group">
      <div className="lg2-row">
        {icons.map((ic, i) => (
          <span key={ic} style={{ display: "contents" }}>
            {i > 0 && <span className="lg2-sep" />}
            <span className="lg2-btn">
              <Icon name={ic} size={21} />
            </span>
          </span>
        ))}
      </div>
    </GlassV2>
  );
}

type Engine = { kind: "v2"; profile: ProfileV2 } | { kind: "old" } | { kind: "none" };

function Panel({ id, title, bg, engine, children }: { id: string; title: string; bg: CSSProperties; engine: Engine; children?: ReactNode }) {
  return (
    <section className="lab2-panel" data-panel={id}>
      <h3>{title}</h3>
      <div className="lab2-stage" style={{ width: W, height: H, ...bg }}>
        {children}
        {engine.kind !== "none" &&
          GROUPS.map((g, i) => (
            <div key={i} style={{ position: "absolute", left: g.x, top: TOP, width: g.w, height: 40 }}>
              {engine.kind === "v2" ? (
                <V2Group icons={g.icons} w={g.w} profile={engine.profile} debugMaps={i === 2} />
              ) : (
                <GlassGroup items={g.icons.map((icon) => ({ icon, label: icon, onClick: () => {} }))} />
              )}
            </div>
          ))}
      </div>
    </section>
  );
}

const backdrop: CSSProperties = { background: `url(/.lab/bg.png) 0 ${-BAND}px / 630px 340px no-repeat` };
const stripes = (deg: number): CSSProperties => ({ background: `repeating-linear-gradient(${deg}deg, #000 0 6px, #fff 6px 12px)` });
const colourful: CSSProperties = {
  background:
    "radial-gradient(circle at 18% 40%, #ff5f3a 0 18%, transparent 19%), radial-gradient(circle at 62% 60%, #2e7dff 0 22%, transparent 23%), linear-gradient(115deg, #ffb321, #19c37d 40%, #8a5cff 70%, #ff4f8b)",
};

/** The surface profile across the bevel: height, slope, normal tilt, displacement (macro surface). */
function curveRows(p: ProfileV2) {
  const w = 122.5;
  const h = 40;
  const spec = surfaceSpec(p, w, h);
  const sdf = makeSdf([{ x: 0, y: 0, w, h, r: 20 }]);
  const rows: { d: number; height: number; slope: number; tilt: number; disp: number }[] = [];
  for (let d = 0; d <= 16.0001; d += 1) {
    const pt = surfaceAt(sdf, spec, w / 2, d + 0.0001);
    const q = Math.min(1, d / spec.W);
    rows.push({
      d,
      height: +(spec.Hb * (1 - Math.pow(1 - q, spec.P))).toFixed(3),
      slope: +Math.hypot(pt.gx, pt.gy).toFixed(3),
      tilt: +((Math.acos(pt.Nm[2]) * 180) / Math.PI).toFixed(1),
      disp: +Math.hypot(...displacement(spec, pt, 1)).toFixed(3),
    });
  }
  return rows;
}

function CurvePlot({ profiles }: { profiles: [string, ProfileV2, string][] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const PW = 300;
    const PH = 150;
    const plots: [string, (r: ReturnType<typeof curveRows>[number]) => number, number][] = [
      ["height (px)", (r) => r.height, 9],
      ["slope", (r) => r.slope, 1.6],
      ["normal tilt (deg)", (r) => r.tilt, 60],
      ["displacement (px)", (r) => r.disp, 3.6],
    ];
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    plots.forEach(([label, f, max], k) => {
      const ox = 40 + (k % 2) * (PW + 60);
      const oy = 20 + Math.floor(k / 2) * (PH + 50);
      ctx.strokeStyle = "#bbb";
      ctx.strokeRect(ox, oy, PW, PH);
      ctx.fillStyle = "#111";
      ctx.font = "12px system-ui";
      ctx.fillText(`${label} vs distance from edge (0..16px)`, ox, oy - 6);
      profiles.forEach(([, p, color]) => {
        const rows = curveRows(p);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        rows.forEach((r, i) => {
          const x = ox + (r.d / 16) * PW;
          const y = oy + PH - (f(r) / max) * PH;
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        });
        ctx.stroke();
      });
    });
    profiles.forEach(([name, , color], i) => {
      ctx.fillStyle = color;
      ctx.fillRect(40 + i * 170, c.height - 22, 14, 10);
      ctx.fillStyle = "#111";
      ctx.fillText(name, 60 + i * 170, c.height - 13);
    });
  }, [profiles]);
  return <canvas ref={ref} width={760} height={440} />;
}

function DebugMaps() {
  const [maps, setMaps] = useState<Record<string, string>>({});
  useEffect(() => {
    const t = setTimeout(() => {
      const el = document.querySelector('[data-panel="12"] .lab2-group:nth-of-type(1)') ?? null;
      const groups = [...document.querySelectorAll('[data-panel="12"] .lab2-group')];
      const m = mapsOf(groups.find((g) => mapsOf(g)?.debug) ?? el);
      if (m?.debug) setMaps({ "outer interface": m.debug.outer, "inner rim": m.debug.rim, "surface normal": m.debug.normal, "displacement (lens map, padded)": m.lens, "Fresnel output (x4)": m.debug.fresnel, "final lighting": m.debug.lighting });
    }, 1500);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="lab2-maps">
      {Object.entries(maps).map(([k, v]) => (
        <figure key={k}>
          <figcaption>{k}</figcaption>
          <img src={v} alt={k} />
        </figure>
      ))}
    </div>
  );
}

export function GlassLabV2() {
  const q = new URLSearchParams(location.search);
  const only = q.get("only");
  const power = q.get("p");
  const candidate: ProfileV2 = power ? { ...regularToolbarV2, surfaceCurvePower: +power } : regularToolbarV2;
  const [dbg, setDbg] = useState<DebugV2>({ ...debugV2 });
  const [stats, setStats] = useState("");
  const apply = (p: Partial<DebugV2>) => {
    setDebugV2(p);
    setDbg({ ...debugV2 });
  };
  useEffect(() => {
    const init: Partial<DebugV2> = {};
    for (const k of ["optics", "displacement", "frost", "lighting"] as const) if (q.has(k)) init[k] = q.get(k) !== "0";
    if (q.get("view")) init.view = q.get("view") as DebugV2["view"];
    if (q.get("sign")) init.sign = q.get("sign") === "-1" ? -1 : 1;
    const t = setTimeout(() => apply(init), 300);
    const s = setInterval(() => setStats(JSON.stringify(statsV2().slice(0, 4))), 1500);
    return () => (clearTimeout(t), clearInterval(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toggle = (k: "optics" | "displacement" | "frost" | "lighting") => (
    <button className={dbg[k] ? "on" : ""} onClick={() => apply({ [k]: !dbg[k] })}>
      {k} {dbg[k] ? "on" : "off"}
    </button>
  );
  const v2 = (profile: ProfileV2): Engine => ({ kind: "v2", profile });
  const curves: [string, ProfileV2, string][] = [
    ["P 2.25 (phase 1)", { ...regularToolbarV2Phase1 }, "#999"],
    ["P 2.6", { ...regularToolbarV2, surfaceCurvePower: 2.6 }, "#e0702a"],
    ["P 2.9 (candidate)", { ...regularToolbarV2, surfaceCurvePower: 2.9 }, "#1a7f37"],
    ["P 3.2", { ...regularToolbarV2, surfaceCurvePower: 3.2 }, "#2f5bd3"],
  ];
  const set = q.get("set") ?? "main";
  const P = (id: string, title: string, bg: CSSProperties, engine: Engine): [string, ReactNode] => [id, <Panel key={id} id={id} title={title} bg={bg} engine={engine} />];
  const target = P("1", "1 macOS target", { background: `url(/.lab/ref.jpg) 0 ${-BAND}px / 630px 340px no-repeat` }, { kind: "none" });
  const variant = (o: Partial<ProfileV2>): ProfileV2 => ({ ...candidate, ...o });
  const sets: Record<string, [string, ReactNode][]> = {
    main: [
      target,
      P("11", "2 V2 phase 1.1", backdrop, v2(regularToolbarV2Phase1_1)),
      P("12", "3 V2 phase 1.2 candidate", backdrop, v2(candidate)),
      P("5", "Phase 1.2 over white", { background: "#fff" }, v2(candidate)),
      P("6", "Phase 1.2 over #1c1c1e", { background: "#1c1c1e" }, v2(candidate)),
      P("7", "Phase 1.2 over #000", { background: "#000" }, v2(candidate)),
      P("8", "Phase 1.2 over colourful content", colourful, v2(candidate)),
      P("9", "Phase 1.2 over vertical 6px stripes", stripes(90), v2(candidate)),
      P("10", "Phase 1.2 over horizontal 6px stripes", stripes(0), v2(candidate)),
    ],
    counter: [target, ...[0.78, 0.83, 0.88].map((hc) => P(`hc${hc}`, `horizonCounter ${hc}`, backdrop, v2(variant({ horizonCounter: hc }))))],
    refr: (
      [
        ["A", 2.6, 0.95],
        ["B", 2.5, 0.9],
        ["C", 2.35, 0.9],
      ] as const
    ).flatMap(([n, e, m]): [string, ReactNode][] => [
      P(`r${n}v`, `${n}: edge ${e} / mid ${m}, vertical stripes`, stripes(90), v2(variant({ edgeDisplacement: e, midDisplacement: m }))),
      P(`r${n}h`, `${n}: edge ${e} / mid ${m}, horizontal stripes`, stripes(0), v2(variant({ edgeDisplacement: e, midDisplacement: m }))),
      P(`r${n}c`, `${n}: edge ${e} / mid ${m}, reference backdrop`, backdrop, v2(variant({ edgeDisplacement: e, midDisplacement: m }))),
    ]),
    old: [
      target,
      P("2", "Old engine", backdrop, { kind: "old" }),
      P("3", "V2 phase 1", backdrop, v2(regularToolbarV2Phase1)),
    ],
  };
  const sections: [string, ReactNode][] = sets[set] ?? sets.main;
  return (
    <div className="lab2">
      <style>{`
        .lab2 { position: fixed; inset: 0; overflow: auto; background: #f2f2f4; color: #111; font: 13px system-ui; padding: 12px 16px; }
        .lab2-bar { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-bottom: 10px; }
        .lab2-bar button { padding: 4px 9px; border-radius: 7px; background: #ddd; color: #111; }
        .lab2-bar button.on { background: #111; color: #fff; }
        .lab2-panel h3 { font: 600 12px system-ui; margin: 8px 0 4px; }
        .lab2-stage { position: relative; overflow: hidden; }
        .lab2-stats, .lab2-table { font: 11px ui-monospace, monospace; color: #444; white-space: pre; }
        .lab2-maps { display: flex; flex-wrap: wrap; gap: 10px; }
        .lab2-maps figure { margin: 0; }
        .lab2-maps img { width: 490px; image-rendering: pixelated; background: #000; display: block; }
        .lab2-maps figcaption { font: 600 12px system-ui; margin: 6px 0 3px; }
      `}</style>
      <div className="lab2-bar">
        {toggle("optics")}
        {toggle("displacement")}
        {toggle("frost")}
        {toggle("lighting")}
        {(["glass", "A", "B", "w"] as const).map((v) => (
          <button key={v} className={dbg.view === v ? "on" : ""} onClick={() => apply({ view: v })}>
            view {v}
          </button>
        ))}
        <button className={dbg.sign === 1 ? "on" : ""} onClick={() => apply({ sign: 1 })}>
          refraction inward
        </button>
        <button className={dbg.sign === -1 ? "on" : ""} onClick={() => apply({ sign: -1 })}>
          refraction outward
        </button>
      </div>
      {sections.filter(([k]) => !only || k === only || (only.endsWith("*") && k.startsWith(only.slice(0, -1)))).map(([, el]) => el)}
      {(!only || only === "graphs") && set === "main" && (
        <section className="lab2-panel" data-panel="graphs">
          <h3>Surface profile (macro bevel, top edge of a 40px capsule)</h3>
          <CurvePlot profiles={curves} />
          <div className="lab2-table" id="curve-table">
            {curves
              .map(([name, p]) => `${name}\n d   height  slope  tilt  disp\n` + curveRows(p).map((r) => `${String(r.d).padStart(2)}  ${r.height.toFixed(2).padStart(6)}  ${r.slope.toFixed(3)}  ${r.tilt.toFixed(1).padStart(4)}  ${r.disp.toFixed(2)}`).join("\n"))
              .join("\n\n")}
          </div>
        </section>
      )}
      {(!only || only === "12" || only === "maps") && set === "main" && (
        <section className="lab2-panel">
          <h3>Debug views of the candidate (reply group, device pixels)</h3>
          <DebugMaps />
        </section>
      )}
      <div className="lab2-stats">{stats}</div>
    </div>
  );
}
