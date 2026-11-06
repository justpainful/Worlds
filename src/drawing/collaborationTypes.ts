import { validDrawingDraft, type DrawingDraft } from "./drafts";
export interface DrawingCommentAnchor {
  kind: "drawing"; frameId: string; nodeId: string | null; u: number; v: number;
  /** Camera region relative to the frame, plus a fallback for deleted frames. */
  region: { x: number; y: number; w: number; h: number }; fallback: { x: number; y: number };
}
export function validDrawingAnchor(value: unknown): value is DrawingCommentAnchor {
  const a = value as DrawingCommentAnchor, id = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 160 && !["__proto__", "constructor", "prototype"].includes(v);
  const coordinate = (v: unknown) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e8;
  return !!a && a.kind === "drawing" && id(a.frameId) && (a.nodeId === null || id(a.nodeId)) && Number.isFinite(a.u) && a.u >= 0 && a.u <= 1 && Number.isFinite(a.v) && a.v >= 0 && a.v <= 1
    && !!a.region && coordinate(a.region.x) && coordinate(a.region.y) && coordinate(a.region.w) && coordinate(a.region.h) && a.region.w > 0 && a.region.h > 0 && a.region.w <= 32768 && a.region.h <= 32768 && !!a.fallback && coordinate(a.fallback.x) && coordinate(a.fallback.y);
}
export interface DrawingPresence {
  frameId: string; cursor: { x: number; y: number } | null; tool: string; selected: string[];
  camera: { x: number; y: number; w: number; h: number }; following: number | null;
  location?: { sequence: number; frameId: string; camera: { x: number; y: number; w: number; h: number } };
  draft?: DrawingDraft | null;
  laser: { id: string; color: string; width: number; opacity: number; points: { x: number; y: number }[]; released: boolean; lifetime: number; sequence: number } | null;
}
export function readDrawingPresence(value: unknown): DrawingPresence | null {
  const p = value as DrawingPresence, finite = (n: unknown) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1e8;
  const point = (v: unknown) => !!v && finite((v as { x: unknown }).x) && finite((v as { y: unknown }).y);
  if (!p || typeof p.frameId !== "string" || p.frameId.length > 160 || typeof p.tool !== "string" || p.tool.length > 32 || !Array.isArray(p.selected) || p.selected.length > 100 || p.selected.some((id) => typeof id !== "string" || id.length > 160) || p.cursor !== null && !point(p.cursor) || !point(p.camera) || !finite(p.camera.w) || !finite(p.camera.h) || p.camera.w <= 0 || p.camera.h <= 0 || p.following !== null && !Number.isSafeInteger(p.following)) return null;
  if (p.laser) {
    const l = p.laser;
    if (typeof l.id !== "string" || l.id.length > 160 || !/^#[a-f\d]{6}$/i.test(l.color) || !finite(l.width) || l.width < 1 || l.width > 2048 || !finite(l.opacity) || l.opacity < 0 || l.opacity > 1 || !Array.isArray(l.points) || l.points.length > 256 || !l.points.every(point) || typeof l.released !== "boolean" || !Number.isSafeInteger(l.sequence) || !finite(l.lifetime) || l.lifetime < 100 || l.lifetime > 4000) return null;
  }
  if (p.location && (!Number.isSafeInteger(p.location.sequence) || typeof p.location.frameId !== "string" || p.location.frameId.length > 160 || !point(p.location.camera) || !finite(p.location.camera.w) || !finite(p.location.camera.h) || p.location.camera.w <= 0 || p.location.camera.h <= 0)) return null;
  if (p.draft !== undefined && p.draft !== null && !validDrawingDraft(p.draft)) return null;
  return structuredClone(p);
}
