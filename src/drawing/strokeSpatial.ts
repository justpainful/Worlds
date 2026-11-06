import { brushFootprint } from "./brushBounds";
import type { Brush, Rect, Sample } from "./model";

/** Conservative segment hierarchy. It skips empty mip subtrees without
 * materializing dabs, changing random state or losing original pen samples. */
export class StrokeSpatialIndex {
  private boxes: Float64Array;
  private ranges: Uint32Array;
  private nodes = 0;
  private tip: { x: number; y: number };
  constructor(private readonly samples: Sample[], brush: Brush) {
    const count = Math.max(1, samples.length - 1), capacity = 2 ** (Math.ceil(Math.log2(Math.max(1, Math.ceil(count / 16)))) + 1);
    this.boxes = new Float64Array(capacity * 4); this.ranges = new Uint32Array(capacity * 4); this.tip = brushFootprint(brush);
    if (samples.length) this.build(0, count);
  }
  get bytes() { return this.boxes.byteLength + this.ranges.byteLength; }
  private build(start: number, end: number): number {
    const id = this.nodes++, at = id * 4; this.ranges[at] = start; this.ranges[at + 1] = end;
    if (end - start <= 16) {
      let x = Infinity, y = Infinity, r = -Infinity, b = -Infinity;
      for (let i = start; i <= Math.min(this.samples.length - 1, end); i++) { const p = this.samples[i]; x = Math.min(x, p.x); y = Math.min(y, p.y); r = Math.max(r, p.x); b = Math.max(b, p.y); }
      this.boxes.set([x, y, r, b], at);
    } else {
      const middle = (start + end) >>> 1, a = this.build(start, middle), b = this.build(middle, end); this.ranges[at + 2] = a; this.ranges[at + 3] = b;
      this.boxes.set([Math.min(this.boxes[a * 4], this.boxes[b * 4]), Math.min(this.boxes[a * 4 + 1], this.boxes[b * 4 + 1]), Math.max(this.boxes[a * 4 + 2], this.boxes[b * 4 + 2]), Math.max(this.boxes[a * 4 + 3], this.boxes[b * 4 + 3])], at);
    }
    return id;
  }
  intersects(rect: Rect): boolean {
    if (!this.nodes) return false;
    const x = rect.x - this.tip.x - 2, y = rect.y - this.tip.y - 2, r = rect.x + rect.w + this.tip.x + 2, b = rect.y + rect.h + this.tip.y + 2;
    const stack = [0];
    while (stack.length) {
      const at = stack.pop()! * 4;
      if (this.boxes[at] > r || this.boxes[at + 2] < x || this.boxes[at + 1] > b || this.boxes[at + 3] < y) continue;
      if (this.ranges[at + 2]) { stack.push(this.ranges[at + 2], this.ranges[at + 3]); continue; }
      for (let i = this.ranges[at]; i < this.ranges[at + 1]; i++) {
        const p = this.samples[Math.min(i, this.samples.length - 1)], q = this.samples[Math.min(i + 1, this.samples.length - 1)], dx = q.x - p.x, dy = q.y - p.y;
        let low = 0, high = 1, hit = true;
        for (const [a, d] of [[-dx, p.x - x], [dx, r - p.x], [-dy, p.y - y], [dy, b - p.y]]) {
          if (!a) { if (d < 0) { hit = false; break; } continue; }
          const t = d / a; if (a < 0) low = Math.max(low, t); else high = Math.min(high, t); if (low > high) { hit = false; break; }
        }
        if (hit) return true;
      }
    }
    return false;
  }
}
