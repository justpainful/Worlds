/**
 * Dev only (?glasslab): real glass controls laid over a fixed backdrop at
 * fixed positions, so renders can be compared pixel by pixel with a
 * reference. The backdrop lives in .lab/ (git-ignored).
 */
import { useEffect } from "react";
import { GlassGroup } from "../ui/Button";
import { glassScene } from "../glass/scene";
import type { IconName } from "../ui/Icon";

const noop = () => {};
const g = (...icons: IconName[]) => icons.map((icon) => ({ icon, label: icon, onClick: noop }));

const GROUPS: { x: number; w: number; icons: IconName[] }[] = [
  { x: 19.25, w: 79, icons: ["listView", "more"] },
  { x: 118.5, w: 40.5, icons: ["edit"] },
  { x: 202, w: 122.5, icons: ["back", "undo", "forward"] },
  { x: 332, w: 123, icons: ["archive", "delete", "close"] },
];

export function GlassLab() {
  const q = new URLSearchParams(location.search);
  const tone = q.get("tone");
  const extra = q.get("css") ?? "";
  useEffect(() => {
    if (tone === "light" || tone === "dark") glassScene.setLook(tone, 1);
  }, [tone]);
  return (
    <div className="glass-lab" style={{ position: "fixed", inset: 0, overflow: "hidden" }}>
      <img src="/.lab/bg.png" alt="" style={{ position: "absolute", left: 0, top: 0, width: 630, height: 340 }} />
      <style>{`.glass-lab .glass-group { height: 40px; } .glass-lab .glass, .glass-lab .glass * { transition: none !important; } ${extra}`}</style>
      {GROUPS.map((gr, i) => (
        <div key={i} className="lab-slot" style={{ position: "absolute", left: gr.x, top: 104, width: gr.w, height: 40 }}>
          <GlassGroup items={g(...gr.icons)} />
        </div>
      ))}
    </div>
  );
}
