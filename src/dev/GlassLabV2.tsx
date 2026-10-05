/**
 * Dev only (?glasslab2): Liquid Glass V2 against the reference and the
 * current engine, at identical scale, with switches that isolate each part
 * of the pipeline. Backdrop images live in .lab/ (git-ignored).
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { GlassV2, debugV2, setDebugV2, statsV2, type DebugV2 } from "../glass/v2/GlassV2";
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

function V2Group({ icons, w }: { icons: IconName[]; w: number }) {
  return (
    <GlassV2 style={{ width: w, height: 40 }} radius={20}>
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

function Panel({ title, bg, engine = "v2", children }: { title: string; bg: CSSProperties; engine?: "v2" | "old" | "none"; children?: ReactNode }) {
  return (
    <section className="lab2-panel">
      <h3>{title}</h3>
      <div className="lab2-stage" style={{ width: W, height: H, ...bg }}>
        {children}
        {engine !== "none" &&
          GROUPS.map((g, i) => (
            <div key={i} style={{ position: "absolute", left: g.x, top: TOP, width: g.w, height: 40 }}>
              {engine === "v2" ? (
                <V2Group icons={g.icons} w={g.w} />
              ) : (
                <GlassGroup items={g.icons.map((icon) => ({ icon, label: icon, onClick: () => {} }))} />
              )}
            </div>
          ))}
      </div>
    </section>
  );
}

const backdrop = (y = BAND): CSSProperties => ({ background: `url(/.lab/bg.png) 0 ${-y}px / 630px 340px no-repeat` });
const stripes = (deg: number): CSSProperties => ({ background: `repeating-linear-gradient(${deg}deg, #000 0 6px, #fff 6px 12px)` });
const colourful: CSSProperties = {
  background:
    "radial-gradient(circle at 18% 40%, #ff5f3a 0 18%, transparent 19%), radial-gradient(circle at 62% 60%, #2e7dff 0 22%, transparent 23%), linear-gradient(115deg, #ffb321, #19c37d 40%, #8a5cff 70%, #ff4f8b)",
};

export function GlassLabV2() {
  const [dbg, setDbg] = useState<DebugV2>({ ...debugV2 });
  const [stats, setStats] = useState("");
  const apply = (p: Partial<DebugV2>) => {
    setDebugV2(p);
    setDbg({ ...debugV2 });
  };
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const init: Partial<DebugV2> = {};
    for (const k of ["optics", "displacement", "frost", "lighting"] as const) if (q.has(k)) init[k] = q.get(k) !== "0";
    if (q.get("view")) init.view = q.get("view") as DebugV2["view"];
    if (q.get("sign")) init.sign = q.get("sign") === "-1" ? -1 : 1;
    const t = setTimeout(() => apply(init), 300);
    const s = setInterval(() => setStats(JSON.stringify(statsV2().slice(0, 4))), 1500);
    return () => (clearTimeout(t), clearInterval(s));
  }, []);
  const only = new URLSearchParams(location.search).get("only");
  const toggle = (k: "optics" | "displacement" | "frost" | "lighting") => (
    <button className={dbg[k] ? "on" : ""} onClick={() => apply({ [k]: !dbg[k] })}>
      {k} {dbg[k] ? "on" : "off"}
    </button>
  );
  const panels: [string, ReactNode][] = [
    ["1 Target reference (macOS 26 Mail)", <Panel key="1" title="1 Target reference" bg={{ background: `url(/.lab/ref.jpg) 0 ${-BAND}px / 630px 340px no-repeat` }} engine="none" />],
    ["2 Current engine", <Panel key="2" title="2 Current engine (old), same backdrop" bg={backdrop()} engine="old" />],
    ["3 V2 reference backdrop", <Panel key="3" title="3 V2 over the reference backdrop" bg={backdrop()} />],
    ["4 V2 white", <Panel key="4" title="4 V2 over white" bg={{ background: "#fff" }} />],
    ["5 V2 black", <Panel key="5" title="5 V2 over black #000" bg={{ background: "#000" }} />],
    ["5b V2 dark", <Panel key="5b" title="5b V2 over the app dark #1c1c1e" bg={{ background: "#1c1c1e" }} />],
    ["6 V2 vertical stripes", <Panel key="6" title="6 V2 over vertical 6px stripes" bg={stripes(90)} />],
    ["7 V2 horizontal stripes", <Panel key="7" title="7 V2 over horizontal 6px stripes" bg={stripes(0)} />],
    ["8 V2 colourful", <Panel key="8" title="8 V2 over colourful content" bg={colourful} />],
  ];
  return (
    <div className="lab2">
      <style>{`
        .lab2 { position: fixed; inset: 0; overflow: auto; background: #f2f2f4; color: #111; font: 13px system-ui; padding: 12px 16px; }
        .lab2-bar { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-bottom: 10px; }
        .lab2-bar button { padding: 4px 9px; border-radius: 7px; background: #ddd; color: #111; }
        .lab2-bar button.on { background: #111; color: #fff; }
        .lab2-panel h3 { font: 600 12px system-ui; margin: 8px 0 4px; }
        .lab2-stage { position: relative; overflow: hidden; }
        .lab2-stats { font: 11px ui-monospace, monospace; color: #555; }
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
      {panels.filter(([k]) => !only || k.startsWith(only)).map(([, el]) => el)}
      <div className="lab2-stats">{stats}</div>
    </div>
  );
}
