import type { Brush, Sample } from "./model";

export const MAX_STROKE_SAMPLES = 65536;
export const MAX_STROKE_WORK = 1000000;

/** Conservative primitive count, including pigment particles inside each dab. */
export function strokeWorkForLength(length: number, b: Brush): number {
  const spacing = Math.max(0.25, b.size * b.spacing * (b.pressureSize !== false ? 0.1 : 1));
  const pigment = b.kind === "spray" ? Math.max(1, Math.ceil(b.size / 3))
    : b.kind === "crayon" || b.kind === "natural-pencil" ? Math.min(256, Math.max(5, Math.ceil(b.size * (b.kind === "crayon" ? 5 : 4))))
    : b.kind === "oil" ? 13 : b.kind === "watercolor" ? 2 : 1;
  return (2 + length / spacing) * pigment;
}

export function strokePaintWork(samples: Sample[], brush: Brush): number {
  if (!samples.length) return 0;
  let length = 0;
  for (let i = 1; i < samples.length; i++) length += Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y);
  return strokeWorkForLength(length, brush);
}

export function requireStrokeBudget(samples: Sample[], brush: Brush): void {
  if (samples.length > MAX_STROKE_SAMPLES || !samples.every((p) => [p.x, p.y, p.pressure, p.tiltX, p.tiltY, p.time].every(Number.isFinite)) || !(strokePaintWork(samples, brush) <= MAX_STROKE_WORK)) {
    throw new Error("This stroke exceeds the paint limit; start another stroke");
  }
}

/** Keeps the painted portion available for release/undo after a limit is hit. */
export class StrokeInput {
  readonly samples: Sample[];
  readonly brush: Brush;
  limited = false;
  private length = 0;
  constructor(first: Sample, brush: Brush) {
    this.brush = { ...brush };
    this.samples = [{ ...first }];
    requireStrokeBudget(this.samples, this.brush);
  }
  append(next: Sample): boolean {
    if (this.limited) return false;
    const last = this.samples[this.samples.length - 1];
    const length = this.length + Math.hypot(next.x - last.x, next.y - last.y);
    if (this.samples.length >= MAX_STROKE_SAMPLES || ![next.x, next.y, next.pressure, next.tiltX, next.tiltY, next.time].every(Number.isFinite) || !(strokeWorkForLength(length, this.brush) <= MAX_STROKE_WORK)) {
      this.limited = true;
      return false;
    }
    this.samples.push({ ...next });
    this.length = length;
    return true;
  }
}
