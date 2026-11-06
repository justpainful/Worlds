import { applyPixelEffect, floodMask, paintMask, type PixelEffect, type Pixels } from "./pixels";
import { growMask } from "./morphology";
import {applyMaskedEffect} from './maskedEffects';
export type PixelTask =
  | { kind: "fill"; image: Pixels; x: number; y: number; tolerance: number; contiguous: boolean; color: [number, number, number, number]; selection?: Uint8ClampedArray; grow?: number }
  | { kind: "effect"; image: Pixels; effect: PixelEffect }
  | {kind:'masked-effect';image:Pixels;effect:PixelEffect;mask:Uint8ClampedArray};
self.onmessage = (event: MessageEvent<{ id: number; task: PixelTask }>) => {
  try {
    const { task } = event.data;
    let result: Pixels;
    if (task.kind === "fill") {
      let mask = floodMask(task.image, task.x, task.y, task.tolerance, task.contiguous, task.selection);
      if (task.grow) mask = growMask(mask, task.image.width, task.image.height, task.grow);
      if (task.selection) for (let i = 0; i < mask.length; i++) mask[i] = Math.min(mask[i], task.selection[i]);
      result = { width: task.image.width, height: task.image.height, data: paintMask(mask, task.color) };
    } else result = task.kind==='masked-effect'?applyMaskedEffect(task.image,task.effect,task.mask):applyPixelEffect(task.image, task.effect);
    self.postMessage({ id: event.data.id, result }, { transfer: [result.data.buffer] });
  } catch (error) { self.postMessage({ id: event.data.id, error: error instanceof Error ? error.message : String(error) }); }
};
