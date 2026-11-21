/** Cognition's illustrations (Cognition Design System 2.0, hand drawn, no gradients). */
import type { CSSProperties } from "react";

const files = import.meta.glob("../assets/cognition/*.svg", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const ART: Record<string, string> = {};
for (const [path, url] of Object.entries(files)) {
  const m = path.match(/cognition\/(.+)\.svg$/);
  if (m) ART[m[1]] = url;
}

export type ArtName = string;

export function artUrl(name: ArtName): string | null {
  return ART[name] ?? ART[`cg_${name}`] ?? null;
}

/** One illustration. The names follow the library: think, mem_new, ctx_question, aha-27 ... */
export function Art({ name, size = 48, className = "", style, label }: { name: ArtName; size?: number; className?: string; style?: CSSProperties; label?: string }) {
  const url = artUrl(name);
  if (!url) return null;
  return <img src={url} width={size} height={size} alt={label ?? ""} draggable={false} className={`cg-art ${className}`} style={style} />;
}
