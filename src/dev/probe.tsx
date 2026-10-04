/**
 * Glass probe (dev only): the real material over test backgrounds, so the
 * optical pipeline can be checked in a WebView2-equivalent engine.
 * Open /probe.html on the dev server.
 */
import { createRoot } from "react-dom/client";
import "@fontsource-variable/instrument-sans/index.css";
import "../styles/tokens.css";
import "../styles/base.css";
import "../glass/glass.css";
import "../styles/ui.css";
import "../styles/shell.css";
import "../styles/system.css";
import { Glass } from "../glass/Glass";
import { LAYER } from "../glass/materials";
import { GlassGroup } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { installSpringTokens } from "../motion/spring";

installSpringTokens();

const BACKS: { name: string; style: React.CSSProperties }[] = [
  { name: "stripes", style: { background: "repeating-linear-gradient(90deg, #111 0 6px, #f5f5f5 6px 12px)" } },
  { name: "colour", style: { background: "linear-gradient(120deg, #ff3b30, #ff9500 25%, #34c759 50%, #0a84ff 75%, #bf5af2)" } },
  { name: "light", style: { background: "linear-gradient(180deg, #ffffff, #e9edf3)" } },
  { name: "dark", style: { background: "#141416" } },
  { name: "text", style: { background: "#f4f1ea", color: "#222", font: "600 15px/1.4 serif", padding: 8, overflow: "hidden" } },
];

function Row({ back }: { back: (typeof BACKS)[number] }) {
  return (
    <div style={{ position: "relative", height: 120, ...back.style }}>
      {back.name === "text" && <div>{"Liquid glass bends what is behind it. ".repeat(40)}</div>}
      <div style={{ position: "absolute", left: 24, top: 38, display: "flex", gap: 12, alignItems: "center" }}>
        <GlassGroup
          items={[
            { icon: "back", label: "Back", onClick: () => {} },
            { icon: "forward", label: "Forward", onClick: () => {} },
          ]}
        />
        <Glass material="regular" layer={LAYER.chrome} radius="var(--r-capsule)" style={{ height: 44, width: 220 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, height: "100%", padding: "0 16px", font: "600 14px var(--font-ui)" }}>
            <Icon name="home" size={16} /> Home
          </div>
        </Glass>
        <GlassGroup
          items={[
            { icon: "splitRight", label: "Split", onClick: () => {} },
            { icon: "more", label: "More", onClick: () => {} },
          ]}
        />
        <Glass material="regular" layer={LAYER.chrome} radius="22px" style={{ height: 64, width: 140 }} />
      </div>
      <span style={{ position: "absolute", right: 10, bottom: 6, font: "600 11px monospace", color: "#888" }}>{back.name}</span>
    </div>
  );
}

createRoot(document.getElementById("probe")!).render(
  <div style={{ width: 760 }}>
    {BACKS.map((b) => (
      <Row key={b.name} back={b} />
    ))}
  </div>,
);
