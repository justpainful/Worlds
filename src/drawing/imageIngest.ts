import { imageHeader,ImageHeaderError,type ImageHeader } from "./imageHeaders";
import { validatePixelDimensions } from "./pixels";
import { imageOrientation } from "./imageOrientation";
import { decodeImageElement,type LoadedImageElement } from "./imageElement";
import { orientDecodedImage } from "./imageDisplay";
import {decodeAnimatedFrame} from "./animatedImage";
import {validateAnimation} from "./animatedImageLimits";
import {looksLikeSvg,rasterizeSvg,MAX_SVG_BYTES,SvgError} from './svg';
export {decodeImageElement} from "./imageElement";
export const MAX_IMAGE_BYTES=256*1024*1024,MAX_IMAGE_SIDE=1_000_000;
export interface DecodedDrawingImage { original:Blob;name:string;header:ImageHeader;orientation:number;animation?:{frameCount:number;index:number};source:HTMLImageElement;dispose:()=>void }
export interface DrawingImageDecoder { decode:(blob:Blob,signal?:AbortSignal)=>Promise<LoadedImageElement>;orientationSupport?:(mime:string,orientation:number)=>Promise<boolean> }
const abort=(signal?:AbortSignal)=>{if(signal?.aborted)throw new DOMException("Cancelled","AbortError");};
export function drawingImageName(file:Blob,mime:string):string{
  const ext=({"image/png":"png","image/jpeg":"jpg","image/webp":"webp","image/bmp":"bmp","image/gif":"gif"} as Record<string,string>)[mime];
  const supplied="name"in file&&typeof file.name==="string"?file.name:"",base=supplied.split(/[\\/]/).at(-1)?.replace(/[\u0000-\u001f\u007f]/g,"").trim().slice(0,160)||"Pasted image";
  return /\.(png|jpe?g|webp|bmp|gif)$/i.test(base)?base.replace(/\.(png|jpe?g|webp|bmp|gif)$/i,`.${ext}`):`${base}.${ext}`;
}
/** Signature, encoded size, dimensions and area are checked before any image
 * decoder runs. The incoming encoded file is retained without resampling. */
export async function decodeDrawingImage(file:Blob,signal?:AbortSignal,io:DrawingImageDecoder={decode:decodeImageElement},frameIndex=0):Promise<DecodedDrawingImage>{
  abort(signal);if(file.size>MAX_IMAGE_BYTES)throw new ImageHeaderError("size");
  if(file.type==='image/svg+xml'&&file.size>MAX_SVG_BYTES)throw new SvgError('size');
  let bytes=new Uint8Array(await file.arrayBuffer());abort(signal);
  if(looksLikeSvg(bytes,file.type)){const png=await rasterizeSvg(bytes,signal),supplied='name'in file&&typeof file.name==='string'?file.name.replace(/\.svg$/i,''):undefined;file=supplied?new File([png],`${supplied}.png`,{type:'image/png'}):png;bytes=new Uint8Array(await file.arrayBuffer());abort(signal);}
  const encoded=imageHeader(bytes,MAX_IMAGE_SIDE,MAX_IMAGE_BYTES,true),orientation=imageOrientation(bytes,encoded.mime),header=orientation>=5?{...encoded,width:encoded.height,height:encoded.width}:encoded;
  try{validatePixelDimensions(header.width,header.height);}catch{throw new ImageHeaderError("dimensions");}
  const aliases:Record<string,string>={"image/jpg":"image/jpeg","image/x-ms-bmp":"image/bmp"},mime=aliases[file.type]??file.type;
  if(mime&&mime!=="application/octet-stream"&&mime!==header.mime)throw new ImageHeaderError("format");
  let animation:DecodedDrawingImage["animation"],display:Blob=new Blob([file],{type:header.mime});
  if(encoded.frameCount){validateAnimation(encoded,frameIndex);const frame=await decodeAnimatedFrame({bytes,mime:header.mime,index:frameIndex,orientation},signal);display=frame.blob;animation={frameCount:frame.frameCount,index:frame.index};}
  let decoded=await io.decode(display,signal);
  try{abort(signal);if(!animation)decoded=await orientDecodedImage(decoded,header.mime,orientation,signal,io.orientationSupport);abort(signal);if(decoded.source.naturalWidth!==header.width||decoded.source.naturalHeight!==header.height)throw new ImageHeaderError("dimensions");}
  catch(error){decoded.dispose();throw error;}
  return{original:file,name:drawingImageName(file,header.mime),header,orientation,animation,...decoded};
}
export async function readDrawingClipboard(signal?:AbortSignal,read?:()=>Promise<readonly Pick<ClipboardItem,"types"|"getType">[]>):Promise<Blob>{
  abort(signal);const readItems=read??(()=>{if(typeof navigator==="undefined"||!navigator.clipboard?.read)throw new Error("Image clipboard reading is unavailable in this window");return navigator.clipboard.read();});
  const items=await readItems();abort(signal);
  for(const type of["image/png","image/jpeg","image/webp","image/bmp"]){const item=items.find(item=>item.types.includes(type));if(item){const blob=await item.getType(type);abort(signal);return blob;}}
  throw new Error("The clipboard contains no supported image");
}
