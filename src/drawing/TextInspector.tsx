import {useEffect,useRef,useState,type ReactNode} from "react";
import type {DrawingNode,TextStyle} from "./model";
import {ColorField} from "./ColorField";
import {fontAvailable} from "./textLayout";
export function TextInspector({node,arabic,onChange}:{node:DrawingNode;arabic:boolean;onChange:(style:TextStyle)=>void}){
  const s=node.textStyle,t=(en:string,ar:string)=>arabic?ar:en,[available,setAvailable]=useState<boolean|null>(null),[font,setFont]=useState(s.font),[custom,setCustom]=useState(!["IBM Plex Sans Arabic","Instrument Sans","IBM Plex Mono"].includes(s.font)),fontInput=useRef<HTMLInputElement>(null);
  const patch=(fields:Partial<TextStyle>)=>onChange({...s,...fields});
  useEffect(()=>{setFont(s.font);setAvailable(null);let active=true;void fontAvailable(s).then(value=>{if(active)setAvailable(value);},()=>{if(active)setAvailable(false);});return()=>{active=false;};},[s.font,s.weight,s.italic]);
  const field=(en:string,ar:string,children:ReactNode)=><label className="drawing-field"><span>{t(en,ar)}</span>{children}</label>;
  return <section aria-label={t("Text formatting","تنسيق النص")}>
    {field("Typeface","نوع الخط",<select value={custom?"custom":s.font} onChange={e=>{const local=e.target.value==="custom";setCustom(local);if(local)fontInput.current?.focus();else patch({font:e.target.value});}}><option>IBM Plex Sans Arabic</option><option>Instrument Sans</option><option>IBM Plex Mono</option><option value="custom">{t("Installed font","خط مثبت على الجهاز")}</option></select>)}
    {field("Font name","اسم الخط",<input ref={fontInput} dir="ltr" maxLength={120} value={font} onChange={e=>{setFont(e.target.value);setCustom(true);}} onBlur={()=>{if(font.trim())patch({font:font.trim()});else setFont(s.font);}}/>)}
    {available===false&&<p role="status" className="drawing-selection-help">{t("This font is unavailable. Preview and image export use the fallback font. Install it or choose a bundled font.","هذا الخط غير متاح. تستخدم المعاينة والصورة المصدّرة الخط البديل. ثبّته أو اختر خطًا مضمّنًا.")}</p>}
    {!["IBM Plex Sans Arabic","Instrument Sans","IBM Plex Mono"].includes(s.font)&&<p className="drawing-selection-help">{t("Projects store the font name without embedding its files. Check its license before sharing.","يحفظ المشروع اسم الخط دون تضمين ملفاته. تحقق من ترخيصه قبل المشاركة.")}</p>}
    {field("Font size","حجم الخط",<input type="number" min={1} max={2048} value={s.size} onChange={e=>{const size=e.target.valueAsNumber;if(size>=1&&size<=2048)patch({size});}}/>)}
    {field("Weight","وزن الخط",<select value={s.weight} onChange={e=>patch({weight:Number(e.target.value)})}>{[300,400,500,600,700,800,900].map(w=><option key={w} value={w}>{w}</option>)}</select>)}
    <label className="drawing-check"><input type="checkbox" checked={s.italic} onChange={e=>patch({italic:e.target.checked})}/>{t("Italic","مائل")}</label>
    {field("Alignment","المحاذاة",<select value={s.align} onChange={e=>patch({align:e.target.value as TextStyle["align"]})}><option value="start">{t("Start","البداية")}</option><option value="center">{t("Center","الوسط")}</option><option value="end">{t("End","النهاية")}</option></select>)}
    {field("Direction","اتجاه النص",<select value={s.direction} onChange={e=>patch({direction:e.target.value as TextStyle["direction"]})}><option value="auto">{t("Automatic","تلقائي")}</option><option value="rtl">{t("Right to left","من اليمين لليسار")}</option><option value="ltr">{t("Left to right","من اليسار لليمين")}</option></select>)}
    {field("Line height","تباعد الأسطر",<input type="number" min={0.5} max={8} step={0.1} value={s.leading} onChange={e=>{const leading=e.target.valueAsNumber;if(leading>=0.5&&leading<=8)patch({leading});}}/>)}
    {([['color','Text color','لون النص'],['background','Text background','خلفية النص'],['border','Text border','إطار النص']]as const).map(([key,en,ar])=><div key={key}><ColorField label={t(en,ar)} value={s[key]} arabic={arabic} onChange={value=>patch({[key]:value})}/>{key!=="color"&&<label className="drawing-check"><input type="checkbox" checked={s[key]==="transparent"} onChange={e=>patch({[key]:e.target.checked?"transparent":"#ffffff"})}/>{t("Transparent","شفاف")}</label>}</div>)}
    {field("When resizing","عند تغيير المقاس",<select value={s.resizeMode??"scale"} onChange={e=>patch({resizeMode:e.target.value as "wrap"|"scale"})}><option value="wrap">{t("Wrap text, keep font size","التفاف النص مع ثبات حجم الخط")}</option><option value="scale">{t("Scale text with box","تحجيم النص مع الإطار")}</option></select>)}
  </section>;
}
