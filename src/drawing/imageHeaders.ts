/** Dimension preflight only. The browser still validates/decodes the image.
 * Layout references: docs/drawing/IMAGE-HEADERS.md. No compressed pixels are read. */
export type ImageHeaderCode = "format" | "truncated" | "dimensions" | "animation" | "size";
export class ImageHeaderError extends Error {
  constructor(readonly code: ImageHeaderCode) { super(code); this.name = "ImageHeaderError"; }
}
export interface ImageHeader { width: number; height: number; mime: string; frameCount?:number }
function fail(code: ImageHeaderCode): never { throw new ImageHeaderError(code); }
export const MAX_TIP_BYTES = 16 * 1024 * 1024;
export const MAX_TIP_SIDE = 2048;

export function imageHeader(bytes: Uint8Array, maxSide = MAX_TIP_SIDE, maxBytes = MAX_TIP_BYTES, allowAnimation=false): ImageHeader {
  if (bytes.length > maxBytes) fail("size");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const need = (at: number, length: number) => { if (at < 0 || at + length > bytes.length) fail("truncated"); };
  const tag = (at: number) => { need(at, 4); return String.fromCharCode(...bytes.subarray(at, at + 4)); };
  const u16 = (at: number, le = false) => { need(at, 2); return v.getUint16(at, le); };
  const u32 = (at: number, le = false) => { need(at, 4); return v.getUint32(at, le); };
  const u24 = (at: number) => { need(at, 3); return bytes[at] + bytes[at + 1] * 256 + bytes[at + 2] * 65536; };
  const result = (width: number, height: number, mime: string):ImageHeader => {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > maxSide || height > maxSide) fail("dimensions");
    return { width, height, mime };
  };
  need(0, 8);
  if(String.fromCharCode(...bytes.subarray(0,6))==="GIF87a"||String.fromCharCode(...bytes.subarray(0,6))==="GIF89a"){
    if(!allowAnimation)fail("animation");need(0,13);const header=result(u16(6,true),u16(8,true),"image/gif");let p=13,frames=0,ended=false;
    if(bytes[10]&128){const length=3*2**((bytes[10]&7)+1);need(p,length);p+=length;}
    const blocks=()=>{for(;;){need(p,1);const size=bytes[p++];if(!size)return;need(p,size);p+=size;}};
    while(p<bytes.length){const marker=bytes[p++];if(marker===0x3b){if(p!==bytes.length)fail("format");ended=true;break;}
      if(marker===0x21){need(p,1);p++;blocks();continue;}
      if(marker!==0x2c)fail("format");need(p,9);const x=u16(p,true),y=u16(p+2,true),w=u16(p+4,true),h=u16(p+6,true),packed=bytes[p+8];p+=9;
      if(!w||!h||x+w>header.width||y+h>header.height)fail("dimensions");if(packed&128){const length=3*2**((packed&7)+1);need(p,length);p+=length;}need(p,1);p++;blocks();frames++;
    }
    if(!ended)fail("truncated");if(!frames)fail("format");return{...header,frameCount:frames};
  }
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)) {
    if (u32(8) !== 13 || tag(12) !== "IHDR") fail("format");
    const header = result(u32(16), u32(20), "image/png");
    let end = false,frames=0;
    for (let p = 8; p < bytes.length;) {
      const length = u32(p), kind = tag(p + 4); need(p, length + 12);
      if (kind === "IHDR" && p !== 8) fail("format");
      if (["acTL", "fcTL", "fdAT"].includes(kind)) {
        if(!allowAnimation)fail("animation");
        if(kind==="acTL"){if(length!==8||header.frameCount||frames)fail("format");header.frameCount=u32(p+8);if(!header.frameCount)fail("format");}
        else if(!header.frameCount)fail("format");
        if(kind==="fcTL"){if(length!==26)fail("format");const w=u32(p+12),h=u32(p+16),x=u32(p+20),y=u32(p+24);if(!w||!h||x+w>header.width||y+h>header.height)fail("dimensions");frames++;}
      }
      p += length + 12;
      if (kind === "IEND") { if (length !== 0 || p !== bytes.length) fail("format"); end = true; break; }
    }
    if (!end) fail("truncated");
    if(header.frameCount&&frames!==header.frameCount)fail("format");
    return header;
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let header: ImageHeader | undefined;
    for (let p = 2; p < bytes.length;) {
      if (bytes[p++] !== 0xff) fail("format");
      while (bytes[p] === 0xff) p++;
      need(p, 1); const marker = bytes[p++];
      if (marker === 0xda) { if (!header) fail("format"); need(p, u16(p)); return header; }
      if (marker === 0xd9) break;
      if (marker === 0 || marker === 0xd8) fail("format");
      if (marker === 1 || marker >= 0xd0 && marker <= 0xd7) continue;
      const length = u16(p); if (length < 2) fail("format"); need(p, length);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        if (header || length < 8) fail("format");
        header = result(u16(p + 5), u16(p + 3), "image/jpeg");
      }
      p += length;
    }
    fail("truncated");
  }
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
    const dib = u32(14, true); need(14, dib);
    if (dib === 12) return result(u16(18, true), u16(20, true), "image/bmp");
    if (![40, 52, 56, 108, 124].includes(dib)) fail("format");
    const compression = u32(30, true);
    if (![0, 1, 2, 3, 6].includes(compression)) fail("format");
    return result(v.getInt32(18, true), Math.abs(v.getInt32(22, true)), "image/bmp");
  }
  if (tag(0) === "RIFF" && tag(8) === "WEBP") {
    if (u32(4, true) + 8 !== bytes.length) fail("truncated");
    let canvas: ImageHeader | undefined, image: ImageHeader | undefined,animation=false,animationHeader=false,frames=0;
    for (let p = 12; p < bytes.length;) {
      const kind = tag(p), length = u32(p + 4, true), data = p + 8; need(data, length + (length % 2));
      if (["ANIM", "ANMF"].includes(kind)) {
        if(!allowAnimation)fail("animation");if(!animation||!canvas)fail("format");
        if(kind==="ANIM"){if(length!==6||animationHeader||frames)fail("format");animationHeader=true;}
        else{if(!animationHeader||length<16)fail("format");const x=u24(data)*2,y=u24(data+3)*2,w=u24(data+6)+1,h=u24(data+9)+1;if(x+w>canvas.width||y+h>canvas.height)fail("dimensions");frames++;}
      }
      if (kind === "VP8X") {
        if (canvas || p !== 12 || length !== 10) fail("format");
        animation=!!(bytes[data]&2);if(animation&&!allowAnimation)fail("animation");
        canvas = result(u24(data + 4) + 1, u24(data + 7) + 1, "image/webp");
      }
      if (kind === "VP8 " || kind === "VP8L") {
        if (image) fail("format");
        if (kind === "VP8 ") {
          if (length < 10 || bytes[data] & 1 || bytes[data + 3] !== 0x9d || bytes[data + 4] !== 1 || bytes[data + 5] !== 0x2a) fail("format");
          image = result(u16(data + 6, true) & 0x3fff, u16(data + 8, true) & 0x3fff, "image/webp");
        } else {
          if (length < 5 || bytes[data] !== 0x2f) fail("format");
          const bits = u32(data + 1, true); if (bits >>> 29) fail("format");
          image = result((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1, "image/webp");
        }
      }
      p = data + length + length % 2;
    }
    if(animation){if(!canvas||!animationHeader||!frames||image)fail("format");return{...canvas,frameCount:frames};}
    if (!image) fail("format");
    if (canvas && (canvas.width !== image.width || canvas.height !== image.height)) fail("format");
    return image;
  }
  return fail("format");
}

/** The decoder is never invoked for oversized, unsupported or animated headers. */
export async function decodeBrushTip(file: Blob): Promise<{ bytes: Uint8Array; image: ImageBitmap; header: ImageHeader }> {
  if (file.size > MAX_TIP_BYTES) fail("size");
  const bytes = new Uint8Array(await file.arrayBuffer()), header = imageHeader(bytes);
  if (file.type && file.type !== header.mime) fail("format");
  const image = await createImageBitmap(file);
  if (image.width < 1 || image.height < 1 || image.width > MAX_TIP_SIDE || image.height > MAX_TIP_SIDE) { image.close(); fail("dimensions"); }
  return { bytes, image, header };
}
