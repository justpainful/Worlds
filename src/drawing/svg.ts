import {imageHeader,ImageHeaderError} from './imageHeaders';
import {decodeImageElement} from './imageElement';
import {validatePixelDimensions} from './pixels';
import {encodeFlattenedSvg} from './svgEncode';
const NS='http://www.w3.org/2000/svg';
export const MAX_SVG_BYTES=32*1024*1024;
export class SvgError extends Error{constructor(readonly code:'format'|'size'|'dimensions'|'payload'){super(svgErrorMessage(code,false));this.name='SvgError';}}
export function svgErrorMessage(code:SvgError['code'],arabic:boolean){return ({format:arabic?'ملف SVG غير صالح أو يتضمن محتوى غير مسموح. تُقبل الرسومات الثابتة دون روابط خارجية أو CSS.':'The SVG is invalid or contains unsupported content. Only static artwork without external links or CSS is accepted.',size:arabic?'يتجاوز SVG حد 32 ميبيبايت أو حدود تعقيد الرسومات.':'The SVG exceeds 32 MiB or the static-artwork complexity limits.',dimensions:arabic?'أبعاد SVG غير صالحة أو تتجاوز 64 مليون بكسل.':'The SVG dimensions are invalid or exceed 64 million pixels.',payload:arabic?'تتجاوز صورة SVG المسطّحة حد 24 ميبيبايت. قلّل المقياس أو اختر PNG.':'The flattened SVG image exceeds 24 MiB. Reduce the scale or choose PNG.'})[code];}
const tags=new Set(['svg','g','defs','rect','circle','ellipse','line','polyline','polygon','path','text','tspan','title','desc','linearGradient','radialGradient','stop','clipPath','mask','image']);
const attrs=new Set(['id','version','x','y','x1','y1','x2','y2','width','height','viewBox','preserveAspectRatio','rx','ry','r','cx','cy','d','points','transform','fill','fill-rule','fill-opacity','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-miterlimit','stroke-dasharray','stroke-dashoffset','stroke-opacity','opacity','clip-path','clip-rule','mask','maskUnits','maskContentUnits','gradientUnits','gradientTransform','spreadMethod','offset','stop-color','stop-opacity','font-family','font-size','font-weight','font-style','text-anchor','dominant-baseline','direction','unicode-bidi','dx','dy','rotate','textLength','lengthAdjust','href']);
const abort=(signal?:AbortSignal)=>{if(signal?.aborted)throw new DOMException('Cancelled','AbortError');};
/** Reject active XML before DOM parsing. Only UTF-8 static artwork is accepted. */
export function svgText(bytes:Uint8Array):string{
 if(!bytes.length||bytes.length>MAX_SVG_BYTES)throw new SvgError(bytes.length?'size':'format');
 let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new SvgError('format');}
 if(/<!DOCTYPE|<!ENTITY|<\?(?!xml\s)|[\u0000-\u0008\u000b\u000c\u000e-\u001f]/i.test(text))throw new SvgError('format');
 return text;
}
export function looksLikeSvg(bytes:Uint8Array,mime:string){return mime==='image/svg+xml'||/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(new TextDecoder().decode(bytes.subarray(0,4096)));}
function rasterReference(value:string){
 const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);if(!match||match[2].length>MAX_SVG_BYTES)throw new ImageHeaderError('format');
 let bytes:Uint8Array;try{bytes=Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0));}catch{throw new ImageHeaderError('format');}
 const h=imageHeader(bytes,1_000_000,MAX_SVG_BYTES);if(h.mime!==match[1])throw new ImageHeaderError('format');validatePixelDimensions(h.width,h.height);
}
/** Rebuild an inert SVG using a closed element/attribute allowlist. No CSS,
 * animation, scripts, fonts, foreign content, use expansion or network URLs. */
function sanitize(bytes:Uint8Array):{text:string;width:number;height:number}{
 const document=new DOMParser().parseFromString(svgText(bytes),'image/svg+xml'),root=document.documentElement;
 if(document.querySelector('parsererror')||root.localName!=='svg'||root.namespaceURI!==NS)throw new ImageHeaderError('format');
 const nodes=[root,...root.querySelectorAll('*')];if(nodes.length>4096)throw new ImageHeaderError('size');
 const clean=document.implementation.createDocument(NS,'svg',null),ids=new Set<string>();let geometry=0;
 const copy=(source:Element,target:Element,depth:number)=>{
  if(depth>64||!tags.has(source.localName)||source.namespaceURI!==NS)throw new ImageHeaderError('format');
  for(const attr of source.attributes){const name=attr.name,value=attr.value;
   if(name==='xmlns'&&source===root&&value===NS)continue;
   if(!attrs.has(name)||attr.namespaceURI||value.length>1_000_000)throw new ImageHeaderError('format');
   if(name==='href'){if(source.localName!=='image')throw new ImageHeaderError('format');rasterReference(value);}
   else{
    if(/[\\<>\u0000-\u001f]|(?:javascript|data|https?|file|blob):|@|\/\*/i.test(value))throw new ImageHeaderError('format');
    if(/url\s*\(/i.test(value)&&!/^url\(#[A-Za-z_][\w.-]{0,159}\)$/.test(value))throw new ImageHeaderError('format');
    if(name==='id'){if(!/^[A-Za-z_][\w.-]{0,159}$/.test(value)||ids.has(value))throw new ImageHeaderError('format');ids.add(value);}
    if(['d','points','transform'].includes(name)){geometry+=value.length;if(geometry>2_000_000)throw new ImageHeaderError('size');}
   }
   target.setAttribute(name,value);
  }
  for(const node of source.childNodes){if(node.nodeType===1){const child=clean.createElementNS(NS,(node as Element).localName);copy(node as Element,child,depth+1);target.append(child);}else if(node.nodeType===3||node.nodeType===4)target.append(clean.createTextNode(node.textContent??''));else if(node.nodeType!==8)throw new ImageHeaderError('format');}
 };
 copy(root,clean.documentElement,0);
 const edges=new Map<string,Set<string>>();for(const element of [clean.documentElement,...clean.documentElement.querySelectorAll('*')])for(const attr of element.attributes){const reference=/^url\(#([A-Za-z_][\w.-]{0,159})\)$/.exec(attr.value);if(!reference)continue;const target=reference[1];if(!ids.has(target))throw new ImageHeaderError('format');let owner:Element|null=element;while(owner){const id=owner.getAttribute('id');if(id){const refs=edges.get(id)??new Set<string>();refs.add(target);edges.set(id,refs);}owner=owner.parentElement;}}
 const visited=new Set<string>(),active=new Set<string>(),visit=(id:string)=>{if(active.has(id))throw new ImageHeaderError('format');if(visited.has(id))return;active.add(id);for(const target of edges.get(id)??[])visit(target);active.delete(id);visited.add(id);};for(const id of ids)visit(id);
 const view=root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number),validView=view?.length===4&&view.every(Number.isFinite)&&view[2]>0&&view[3]>0;
 const dimension=(name:string,index:number)=>{const value=root.getAttribute(name);if(value&&/^\d+(?:\.\d+)?(?:px)?$/.test(value))return Math.ceil(parseFloat(value));if(validView)return Math.ceil(view![index]);throw new ImageHeaderError('dimensions');};
 const width=dimension('width',2),height=dimension('height',3);validatePixelDimensions(width,height);clean.documentElement.setAttribute('width',String(width));clean.documentElement.setAttribute('height',String(height));
 return{text:new XMLSerializer().serializeToString(clean),width,height};
}
export function sanitizeSvg(bytes:Uint8Array):{text:string;width:number;height:number}{try{return sanitize(bytes);}catch(error){if(error instanceof SvgError)throw error;if(error instanceof ImageHeaderError)throw new SvgError(error.code==='size'?'size':error.code==='dimensions'?'dimensions':'format');if(error instanceof Error&&/dimension|pixel/i.test(error.message))throw new SvgError('dimensions');throw new SvgError('format');}}
/** SVG imports become owned static PNG originals; the incoming XML is never
 * persisted or inserted into a live document. Preview/Cancel remains unchanged. */
export async function rasterizeSvg(bytes:Uint8Array,signal?:AbortSignal):Promise<Blob>{
 abort(signal);const clean=sanitizeSvg(bytes);abort(signal);const loaded=await decodeImageElement(new Blob([clean.text],{type:'image/svg+xml'}),signal);let canvas:OffscreenCanvas|undefined;
 try{abort(signal);canvas=new OffscreenCanvas(clean.width,clean.height);const ctx=canvas.getContext('2d');if(!ctx)throw new Error('The image processor is unavailable');ctx.drawImage(loaded.source,0,0,clean.width,clean.height);const png=await canvas.convertToBlob({type:'image/png'});abort(signal);return png;}
 finally{loaded.dispose();if(canvas)canvas.width=canvas.height=1;}
}
/** A self-contained flattened SVG. It contains only freshly rendered PNG
 * pixels, never document XML, hidden originals, fonts or live source links. */
export async function flattenedSvg(png:Blob,signal?:AbortSignal):Promise<Blob>{
 abort(signal);if(png.size>24*1024*1024)throw new SvgError('payload');if(png.type!=='image/png')throw new SvgError('format');
 if(typeof Worker==='undefined')return encodeFlattenedSvg(png,()=>abort(signal));
 return new Promise((resolve,reject)=>{
  let worker:Worker;try{worker=new Worker(new URL('./svgEncode.worker.ts',import.meta.url),{type:'module'});}catch{void encodeFlattenedSvg(png,()=>abort(signal)).then(resolve,reject);return;}
  const stop=()=>{worker.terminate();signal?.removeEventListener('abort',cancel);},cancel=()=>{stop();reject(new DOMException('Cancelled','AbortError'));};
  signal?.addEventListener('abort',cancel,{once:true});
  worker.onmessage=(event:MessageEvent<{blob?:Blob;error?:string}>)=>{stop();if(event.data.error)reject(new Error(event.data.error));else if(event.data.blob)resolve(event.data.blob);else reject(new SvgError('format'));};
  worker.onerror=()=>{stop();void encodeFlattenedSvg(png,()=>abort(signal)).then(resolve,reject);};
  try{worker.postMessage({png});}catch{stop();void encodeFlattenedSvg(png,()=>abort(signal)).then(resolve,reject);}
 });
}
