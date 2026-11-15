/** A saved window rectangle moved and shrunk to lie inside a work area, all in physical pixels. */
export function fitWindow(saved: { x: number; y: number; w: number; h: number }, area: { x: number; y: number; w: number; h: number }) {
  const w = Math.min(saved.w, area.w);
  const h = Math.min(saved.h, area.h);
  const x = Math.min(Math.max(saved.x, area.x), area.x + area.w - w);
  const y = Math.min(Math.max(saved.y, area.y), area.y + area.h - h);
  return { w, h, x, y };
}
