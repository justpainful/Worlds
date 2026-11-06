import { combineMask, featherMask, floodMask, polygonMask, validatePixelDimensions, type Pixels } from "./pixels";
import { growMask } from "./morphology";
import type { Point, Rect } from "./model";

export type SelectionKind = "rect" | "ellipse" | "lasso" | "polygon" | "magic";
export type SelectionMode = "replace" | "add" | "subtract" | "intersect";
export interface AlphaMaskPreview extends Rect { width: number; height: number; alpha: number[] }
export type SelectionOperation =
  | { kind: "shape"; shape: Exclude<SelectionKind, "magic">; points: Point[] }
  | { kind: "magic"; image: Pixels; point: Point; tolerance: number; contiguous: boolean }
  | { kind: "all" } | { kind: "invert" }
  | { kind: "edges"; grow: number; feather: number };
export interface SelectionRequest { width: number; height: number; previous?: Uint8ClampedArray; mode: SelectionMode; operation: SelectionOperation }
export interface SelectionRaster { width: number; height: number; mask: Uint8ClampedArray; bounds: Rect | null; imageBounds:Rect; pixels: number; coverage: number; preview: AlphaMaskPreview }

/** Full-resolution alpha is authoritative. Only the ephemeral peer preview is
 * downsampled, to at most 4096 alpha values over the actual occupied bounds. */
export function selectionRaster(width: number, height: number, mask: Uint8ClampedArray): SelectionRaster {
  if (mask.length !== validatePixelDimensions(width, height)) throw new Error("Invalid selection dimensions");
  let left = width, top = height, right = -1, bottom = -1, pixels = 0, alpha = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const value = mask[y * width + x]; if (value) { pixels++; alpha += value; left = Math.min(left,x); top = Math.min(top,y); right = Math.max(right,x); bottom = Math.max(bottom,y); } }
  const bounds = pixels ? { x:left, y:top, w:right-left+1, h:bottom-top+1 } : null;
  const ix=Math.max(0,left-1),iy=Math.max(0,top-1),imageBounds=bounds?{x:ix,y:iy,w:Math.min(width,right+2)-ix,h:Math.min(height,bottom+2)-iy}:{x:0,y:0,w:1,h:1};
  const box = bounds ?? { x:0, y:0, w:1, h:1 }, ratio = Math.min(1, 64 / Math.max(box.w, box.h)), pw = Math.max(1, Math.ceil(box.w*ratio)), ph = Math.max(1, Math.ceil(box.h*ratio)), values: number[] = [];
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    const x0 = Math.floor(x*box.w/pw), x1 = Math.floor((x+1)*box.w/pw), y0 = Math.floor(y*box.h/ph), y1 = Math.floor((y+1)*box.h/ph); let sum = 0;
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) sum += mask[(box.y+yy)*width+box.x+xx];
    values.push(Math.round(sum / ((x1-x0)*(y1-y0))));
  }
  return { width, height, mask, bounds,imageBounds, pixels, coverage:alpha/255, preview:{ ...box, width:pw, height:ph, alpha:values } };
}
export function computeSelection(request: SelectionRequest): SelectionRaster {
  const { width,height,previous,operation,mode } = request, size = validatePixelDimensions(width,height);
  if (previous && previous.length !== size) throw new Error("Selection dimensions do not match");
  let mask: Uint8ClampedArray;
  if (operation.kind === "all") mask = new Uint8ClampedArray(size).fill(255);
  else if (operation.kind === "invert") mask = previous ? previous.map(value=>255-value) : new Uint8ClampedArray(size).fill(255);
  else if (operation.kind === "edges") {
    if (!previous || ![operation.grow,operation.feather].every(Number.isFinite) || Math.abs(operation.grow)>128 || operation.feather<0 || operation.feather>128) throw new Error("Invalid selection edge settings");
    mask = operation.grow ? growMask(previous,width,height,operation.grow) : previous.slice();
    if (operation.feather) mask = featherMask(mask,width,height,operation.feather);
  } else {
    if (operation.kind === "shape") {
      if (operation.points.length > 65536) throw new Error("This selection has too many points");
      let points = operation.points;
      if (operation.shape === "rect" || operation.shape === "ellipse") {
        if (points.length < 2) throw new Error("Choose two selection corners");
        const a=points[0], b=points.at(-1)!; points=[a,{x:b.x,y:a.y},b,{x:a.x,y:b.y}];
      }
      mask=polygonMask(width,height,points,operation.shape==="ellipse");
    } else {
      if(operation.image.width!==width||operation.image.height!==height)throw new Error("Selection source dimensions do not match");
      mask=floodMask(operation.image,operation.point.x,operation.point.y,operation.tolerance,operation.contiguous);
    }
    if (mode!=="replace") mask=combineMask(previous??new Uint8ClampedArray(size),mask,mode);
  }
  return selectionRaster(width,height,mask);
}
export function validAlphaMaskPreview(value: unknown): value is AlphaMaskPreview {
  const p=value as AlphaMaskPreview;
  return !!p && [p.x,p.y,p.w,p.h].every(n=>typeof n==="number"&&Number.isFinite(n)&&Math.abs(n)<=1e9) && p.w>0 && p.h>0 && Number.isInteger(p.width)&&p.width>=1&&p.width<=64 && Number.isInteger(p.height)&&p.height>=1&&p.height<=64 && Array.isArray(p.alpha)&&p.alpha.length===p.width*p.height&&p.alpha.every(n=>Number.isInteger(n)&&n>=0&&n<=255);
}
