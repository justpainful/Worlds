/** Pure pixel algorithms shared by the worker and tests. All coordinates are image pixels. */
export interface Pixels { width: number; height: number; data: Uint8ClampedArray }
export interface PixelPoint { x: number; y: number }
export function validatePixelDimensions(width: number, height: number): number {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width * height > 64 * 1024 * 1024) throw new Error("Invalid image dimensions");
  return width * height;
}
export function trimTransparent(image: Pixels): (Pixels & { x: number; y: number }) | null {
  validatePixels(image); let left = image.width, top = image.height, right = -1, bottom = -1;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) if (image.data[(y * image.width + x) * 4 + 3]) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
  if (right < 0) return null;
  const width = right - left + 1, height = bottom - top + 1, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) data.set(image.data.subarray(((y + top) * image.width + left) * 4, ((y + top) * image.width + left + width) * 4), y * width * 4);
  return { width, height, data, x: left, y: top };
}
export function validatePixels(image: Pixels) {
  if (image.data.length !== validatePixelDimensions(image.width, image.height) * 4) throw new Error("Invalid image dimensions");
}
export function floodMask(image: Pixels, x: number, y: number, tolerance: number, contiguous = true, selection?: Uint8ClampedArray): Uint8ClampedArray {
  validatePixels(image);
  if (![x, y, tolerance].every(Number.isFinite)) throw new Error("Invalid fill coordinates or tolerance");
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) throw new Error("The fill point is outside the image");
  const { width, height, data } = image, size = width * height, seed = (y * width + x) * 4;
  if (selection && selection.length !== size) throw new Error("Selection dimensions do not match");
  const result = new Uint8ClampedArray(size), seen = new Uint8Array(size);
  const limit = Math.max(0, Math.min(255, tolerance));
  // Premultiplied channels prevent invisible RGB values from breaking transparent fills.
  const alpha = data[seed + 3] / 255;
  const target = [data[seed] * alpha, data[seed + 1] * alpha, data[seed + 2] * alpha, data[seed + 3]];
  const matches = (index: number) => {
    if (selection && !selection[index]) return false;
    const at = index * 4, a = data[at + 3] / 255;
    return Math.max(Math.abs(data[at] * a - target[0]), Math.abs(data[at + 1] * a - target[1]), Math.abs(data[at + 2] * a - target[2]), Math.abs(data[at + 3] - target[3])) <= limit;
  };
  if (!contiguous) {
    for (let i = 0; i < size; i++) if (matches(i)) result[i] = selection?.[i] ?? 255;
    return result;
  }
  const stack: number[] = [y * width + x];
  while (stack.length) {
    const at = stack.pop()!;
    if (seen[at]) continue;
    seen[at] = 1;
    if (!matches(at)) continue;
    let left = at, right = at;
    const start = Math.floor(at / width) * width, end = start + width;
    while (left > start && !seen[left - 1] && matches(left - 1)) left--;
    while (right + 1 < end && !seen[right + 1] && matches(right + 1)) right++;
    for (let i = left; i <= right; i++) {
      seen[i] = 1; result[i] = selection?.[i] ?? 255;
      if (i >= width && !seen[i - width]) stack.push(i - width);
      if (i + width < size && !seen[i + width]) stack.push(i + width);
    }
  }
  return result;
}
export function polygonMask(width: number, height: number, points: PixelPoint[], ellipse = false): Uint8ClampedArray {
  const size = validatePixelDimensions(width, height);
  if (points.length < 2 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error("Invalid selection bounds");
  const mask = new Uint8ClampedArray(size);
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const p of points) { left = Math.min(left, p.x); right = Math.max(right, p.x); top = Math.min(top, p.y); bottom = Math.max(bottom, p.y); }
  const y0 = Math.max(0, Math.ceil(top - 0.5)), y1 = Math.min(height, Math.ceil(bottom - 0.5));
  if (ellipse) {
    // Preserve the original ellipse before clipping to the frame. Clipping its
    // bounding box first changes the curve and selects the wrong pixels.
    const cx = (left + right) / 2, cy = (top + bottom) / 2, rx = (right - left) / 2, ry = (bottom - top) / 2;
    if (!rx || !ry) return mask;
    for (let y = y0; y < y1; y++) { const q = (y + 0.5 - cy) / ry, dx = rx * Math.sqrt(Math.max(0, 1 - q * q)); const x0 = Math.max(0, Math.ceil(cx - dx - 0.5)), x1 = Math.min(width, Math.floor(cx + dx - 0.5) + 1); if (x1 > x0) mask.fill(255, y * width + x0, y * width + x1); }
    return mask;
  }
  interface Edge { start: number; end: number; x: number; step: number }
  const starts = new Map<number, Edge[]>(); let active: Edge[] = [];
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    let a = points[j], b = points[i]; if (a.y === b.y) continue; if (a.y > b.y) [a,b] = [b,a];
    const start = Math.max(y0, Math.ceil(a.y - 0.5)), end = Math.min(y1, Math.ceil(b.y - 0.5)); if (start >= end) continue;
    const step = (b.x - a.x) / (b.y - a.y), edge = { start, end, x: a.x + (start + 0.5 - a.y) * step, step };
    const bucket = starts.get(start) ?? []; bucket.push(edge); starts.set(start, bucket);
  }
  for (let y = y0; y < y1; y++) {
    active = active.filter(edge => edge.end > y); for (const edge of starts.get(y) ?? []) active.push(edge);
    const xs = active.map(edge => edge.x + (y - edge.start) * edge.step).sort((a,b) => a-b);
    for (let i = 0; i + 1 < xs.length; i += 2) { const x0 = Math.max(0, Math.ceil(xs[i] - 0.5)), x1 = Math.min(width, Math.ceil(xs[i+1] - 0.5)); if (x1 > x0) mask.fill(255, y * width + x0, y * width + x1); }
  }
  return mask;
}
export function combineMask(a: Uint8ClampedArray, b: Uint8ClampedArray, mode: "replace" | "add" | "subtract" | "intersect"): Uint8ClampedArray {
  if (a.length !== b.length) throw new Error("Selection dimensions do not match");
  return b.map((v, i) => mode === "add" ? Math.max(a[i], v) : mode === "subtract" ? Math.max(0, a[i] - v) : mode === "intersect" ? Math.min(a[i], v) : v);
}
export function featherMask(mask: Uint8ClampedArray, width: number, height: number, radius: number): Uint8ClampedArray {
  if (mask.length !== validatePixelDimensions(width, height) || !Number.isFinite(radius)) throw new Error("Selection dimensions do not match");
  const r = Math.min(128, Math.max(0, Math.round(radius))); if (!r) return mask.slice();
  const tmp = new Float32Array(mask.length), out = new Uint8ClampedArray(mask.length), size = r * 2 + 1;
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = -r; x <= r; x++) if (x >= 0 && x < width) sum += mask[y * width + x];
    for (let x = 0; x < width; x++) { tmp[y * width + x] = sum / size; if (x - r >= 0) sum -= mask[y * width + x - r]; if (x + r + 1 < width) sum += mask[y * width + x + r + 1]; }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) if (y >= 0 && y < height) sum += tmp[y * width + x];
    for (let y = 0; y < height; y++) { out[y * width + x] = sum / size; if (y - r >= 0) sum -= tmp[(y - r) * width + x]; if (y + r + 1 < height) sum += tmp[(y + r + 1) * width + x]; }
  }
  return out;
}
export function paintMask(mask: Uint8ClampedArray, color: [number, number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(mask.length * 4);
  for (let i = 0; i < mask.length; i++) { out[i * 4] = color[0]; out[i * 4 + 1] = color[1]; out[i * 4 + 2] = color[2]; out[i * 4 + 3] = color[3] * mask[i] / 255; }
  return out;
}
export interface PixelEffect { kind: "brightness" | "contrast" | "saturation" | "temperature" | "grayscale" | "invert" | "pixelate" | "sharpen" | "blur"; amount: number }
export function applyPixelEffect(image: Pixels, effect: PixelEffect): Pixels {
  validatePixels(image);
  const data = image.data.slice(), { width, height } = image, amount = effect.amount;
  if (effect.kind === "blur") {
    const channels = Array.from({ length: 4 }, () => new Uint8ClampedArray(width * height));
    for (let i = 0; i < width * height; i++) for (let c = 0; c < 4; c++) channels[c][i] = c === 3 ? data[i * 4 + c] : data[i * 4 + c] * data[i * 4 + 3] / 255;
    const blurred = channels.map((channel) => featherMask(channel, width, height, amount));
    for (let i = 0; i < width * height; i++) { const alpha = blurred[3][i]; for (let c = 0; c < 3; c++) data[i * 4 + c] = alpha ? blurred[c][i] * 255 / alpha : 0; data[i * 4 + 3] = alpha; }
  } else if (effect.kind === "pixelate") {
    const size = Math.max(1, Math.min(256, Math.round(amount)));
    for (let y = 0; y < height; y += size) for (let x = 0; x < width; x += size) {
      const channels = [0, 0, 0, 0]; let count = 0;
      for (let yy = y; yy < Math.min(height, y + size); yy++) for (let xx = x; xx < Math.min(width, x + size); xx++) { const at = (yy * width + xx) * 4,alpha=image.data[at+3]; for (let c = 0; c < 3; c++) channels[c] += image.data[at + c]*alpha/255;channels[3]+=alpha; count++; }
      for (let yy = y; yy < Math.min(height, y + size); yy++) for (let xx = x; xx < Math.min(width, x + size); xx++) { const at = (yy * width + xx) * 4;for(let c=0;c<3;c++)data[at+c]=channels[3]?channels[c]*255/channels[3]:0;data[at+3]=channels[3]/count; }
    }
  } else if (effect.kind === "sharpen") {
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
      const at = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {const alpha=image.data[at+3],pigment=(p:number)=>image.data[p+c]*image.data[p+3]/255,value=pigment(at)*(1+4*amount)-amount*(pigment(at-4)+pigment(at+4)+pigment(at-width*4)+pigment(at+width*4));data[at+c]=alpha?value*255/alpha:0;}
    }
  } else for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    for (let c = 0; c < 3; c++) {
      const value = data[i + c];
      switch (effect.kind) {
        case "brightness": data[i + c] = value * (1 + amount); break;
        case "contrast": data[i + c] = (value - 127.5) * (1 + amount) + 127.5; break;
        case "saturation": data[i + c] = luminance + (value - luminance) * (1 + amount); break;
        case "temperature": data[i + c] = value + (c === 0 ? 1 : c === 2 ? -1 : 0) * amount * 64; break;
        case "grayscale": data[i + c] = value + (luminance - value) * amount; break;
        case "invert": data[i + c] = value + (255 - value * 2) * amount; break;
      }
    }
  }
  return { width, height, data };
}
