import type { Point } from "./model";
export interface LaserStroke { id: string; actor: string; color: string; width: number; points: Point[]; releasedAt: number | null; lifetime: number; opacity?: number }
/** Session-only overlay. This type is intentionally absent from DrawingScene. */
export class LaserOverlay {
  readonly strokes = new Map<string, LaserStroke>();
  update(stroke: LaserStroke) { this.strokes.set(stroke.id, stroke); }
  opacity(stroke: LaserStroke, now: number): number {
    if (stroke.releasedAt === null) return 1;
    return Math.max(0, 1 - (now - stroke.releasedAt) / Math.max(100, stroke.lifetime));
  }
  prune(now: number) {
    for (const [id, stroke] of this.strokes) if (this.opacity(stroke, now) === 0) this.strokes.delete(id);
  }
  removeActor(actor: string) { for (const [id, stroke] of this.strokes) if (stroke.actor === actor) this.strokes.delete(id); }
  draw(ctx: CanvasRenderingContext2D, now: number, reducedMotion: boolean) {
    this.prune(now);
    ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const stroke of this.strokes.values()) {
      if (!stroke.points.length) continue;
      ctx.globalAlpha = (reducedMotion ? 1 : this.opacity(stroke, now)) * (stroke.opacity ?? 1);
      ctx.strokeStyle = stroke.color; ctx.fillStyle = stroke.color; ctx.lineWidth = stroke.width;
      ctx.beginPath();
      stroke.points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      if (stroke.points.length === 1) { const p = stroke.points[0]; ctx.arc(p.x, p.y, stroke.width / 2, 0, Math.PI * 2); ctx.fill(); }
      else ctx.stroke();
    }
    ctx.restore();
  }
}
