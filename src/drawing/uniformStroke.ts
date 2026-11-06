import type { Brush, Sample } from "./model";
import { requireStrokeBudget } from "./brushWork";
/** Render the retained hardware samples on a straight endpoint line while
 * preserving pressure/time/tilt and their traveled-distance order. */
export function straightStrokeSamples(samples:Sample[],enabled?:boolean):Sample[]{
  if(!enabled||samples.length<2)return samples;const positions=new Float64Array(samples.length);for(let i=1;i<samples.length;i++)positions[i]=positions[i-1]+Math.hypot(samples[i].x-samples[i-1].x,samples[i].y-samples[i-1].y);const start=samples[0],end=samples.at(-1)!,total=positions.at(-1)!;
  return samples.map((sample,i)=>{const at=total?positions[i]/total:i/(samples.length-1);return{...sample,x:start.x+(end.x-start.x)*at,y:start.y+(end.y-start.y)*at};});
}

/** Width is mapped at each original hardware sample, then joined continuously. */
export function uniformStrokeRadii(samples: Sample[], brush: Brush): Float64Array {
  requireStrokeBudget(samples, brush);
  const positions = new Float64Array(samples.length), radii = new Float64Array(samples.length);
  for (let i = 1; i < samples.length; i++) positions[i] = positions[i - 1] + Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y);
  const total = positions[samples.length - 1] ?? 0;
  for (let i = 0; i < samples.length; i++) {
    const pressure = Math.pow(Math.max(0.01, Math.min(1, samples[i].pressure)), brush.pressureCurve);
    const taper = Math.min(1, brush.taperStart && total ? positions[i] / (total * brush.taperStart) : 1, brush.taperEnd && total ? (total - positions[i]) / (total * brush.taperEnd) : 1);
    radii[i] = Math.max(0.2, brush.size * (brush.pressureSize ? pressure : 1) * Math.max(0.03, taper)) / 2;
  }
  return radii;
}
