import type {TextStyle} from "./model";
export function textDirection(text:string,direction:TextStyle["direction"]):"rtl"|"ltr"{
  if(direction!=="auto")return direction;
  for(const letter of text){if(!/\p{Letter}/u.test(letter))continue;return /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(letter)?"rtl":"ltr";}
  return"ltr";
}
export const canvasFont=(style:TextStyle)=>`${style.italic?"italic ":""}${style.weight} ${style.size}px '${style.font.replace(/[\\']/g,"\\$&")}', sans-serif`;
/** Wrap whole Arabic/Latin runs before drawing, preserving shaping within each
 * line. Oversized tokens split on graphemes, never inside a combining sequence. */
export function textLines(text:string,width:number,measure:(text:string)=>number):string[]{
  const lines:string[]=[],segments=new Intl.Segmenter(undefined,{granularity:"grapheme"});
  for(const paragraph of text.split("\n")){let line="";for(const token of paragraph.match(/\s+|\S+/gu)??[]){
    if(measure(line+token)<=width){line+=token;continue;}
    if(line.trim()){lines.push(line.trimEnd());line="";}
    if(!token.trim())continue;
    for(const{segment}of segments.segment(token)){if(line&&measure(line+segment)>width){lines.push(line);line="";}line+=segment;}
  }lines.push(line.trimEnd());}return lines;
}
export async function fontAvailable(style:TextStyle):Promise<boolean>{
  const font=canvasFont(style);await document.fonts.load(font);if([...document.fonts].some(face=>face.family.replace(/['"]/g,"")===style.font&&face.status==="loaded"))return true;
  if(["sans-serif","serif","monospace","system-ui"].includes(style.font))return true;
  const c=document.createElement("canvas"),ctx=c.getContext("2d");if(!ctx)return false;const sample="Wi1ملخص الرسم 1980",family=`'${style.font.replace(/[\\']/g,"\\$&")}'`;
  return["serif","monospace","sans-serif"].some(fallback=>{ctx.font=`72px ${fallback}`;const base=ctx.measureText(sample).width;ctx.font=`72px ${family},${fallback}`;return Math.abs(ctx.measureText(sample).width-base)>0.01;});
}
