import type { TileMatrix } from "./tileCompositor";
/** Keep at most four source pixels per output-pixel axis before final linear
 * sampling. Independent axes preserve detail under nonuniform content scale. */
export function strokeLod(m: TileMatrix): { x: number; y: number } {
  const det = Math.abs(m.a * m.d - m.b * m.c);
  if (!(det > 0) || !Number.isFinite(det)) return { x: 0, y: 0 };
  const axis = (footprint: number) => Math.max(0, Math.floor(Math.log2(Math.max(1, footprint / 2))));
  return { x: axis(Math.hypot(m.d, m.c) / det), y: axis(Math.hypot(m.b, m.a) / det) };
}
