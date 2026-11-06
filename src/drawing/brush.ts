import { type Brush, type Sample } from "./model";
import { clamp, distance } from "./geometry";
import { requireStrokeBudget } from "./brushWork";
import { normalizeBrush } from "./brushConfig";
export interface Dab { x: number; y: number; size: number; opacity: number; angle: number; roundness: number; noise: number }
export { normalizeBrush } from "./brushConfig";
export function samplePointer(e: Pick<PointerEvent, "clientX" | "clientY" | "pressure" | "pointerType" | "tiltX" | "tiltY" | "timeStamp">, x: number, y: number): Sample {
  return { x, y, pressure: e.pointerType === "pen" ? clamp(e.pressure, 0.01, 1) : 1, tiltX: e.tiltX || 0, tiltY: e.tiltY || 0, time: e.timeStamp };
}
export function smoothSample(previous: Sample, next: Sample, brush: Brush): Sample {
  const d = distance(previous, next);
  if (!d) return next;
  const a = (1 - brush.smoothing) * (brush.stabilizer ? Math.min(1, d / brush.stabilizer) : 1);
  return { ...next, x: previous.x + (next.x - previous.x) * a, y: previous.y + (next.y - previous.y) * a };
}
/** Deterministic spacing and random seed ensure reopening/export retains identical pigment. */
export function strokeDabs(samples: Sample[], raw: Brush, seed = 1): Dab[] {
  return Array.from(iterateStrokeDabs(samples, raw, seed));
}
/** Rendering consumes one pigment dab at a time, without a full-stroke array. */
export function* iterateStrokeDabs(samples: Sample[], raw: Brush, seed = 1): Generator<Dab> {
  if (!samples.length) return;
  const b = normalizeBrush(raw);
  requireStrokeBudget(samples, b);
  let randomState = seed | 0 || 1;
  const random = () => { randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5; return (randomState >>> 0) / 4294967296; };
  const lengths = samples.map((p, i) => i ? distance(samples[i - 1], p) : 0);
  const total = lengths.reduce((a, v) => a + v, 0);
  const add = function* (p: Sample, at: number): Generator<Dab> {
    const pressure = Math.pow(clamp(p.pressure, 0.01, 1), b.pressureCurve);
    const taper = Math.min(1, b.taperStart && total ? at / (total * b.taperStart) : 1, b.taperEnd && total ? (total - at) / (total * b.taperEnd) : 1);
    const size = Math.max(0.2, b.size * (b.pressureSize ? pressure : 1) * Math.max(0.03, taper));
    const opacity = b.flow * (b.pressureOpacity ? pressure : 1) * (b.pressureFlow ? pressure : 1);
    if (b.kind === "spray") {
      for (let j = 0; j < Math.max(1, Math.ceil(size / 3)); j++) {
        const a = random() * Math.PI * 2, r = Math.sqrt(random()) * size / 2;
        yield { x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r, size: Math.max(1, size / 24), opacity, angle: b.angle, roundness: 1, noise: random() };
      }
    } else yield { x: p.x, y: p.y, size, opacity, angle: b.angle, roundness: b.roundness, noise: random() };
  };
  yield* add(samples[0], 0);
  let travelled = 0, remaining = Math.max(0.25, b.size * b.spacing);
  for (let i = 1; i < samples.length; i++) {
    const start = samples[i - 1], end = samples[i], length = lengths[i];
    let pos = remaining;
    while (pos <= length) {
      const t = length ? pos / length : 0;
      const p = { ...end, x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t, pressure: start.pressure + (end.pressure - start.pressure) * t };
      yield* add(p, travelled + pos);
      pos += Math.max(0.25, b.size * b.spacing * (b.pressureSize ? Math.max(0.1, p.pressure) : 1));
    }
    remaining = pos - length; travelled += length;
  }
  if (samples.length > 1) yield* add(samples[samples.length - 1], total);
}
