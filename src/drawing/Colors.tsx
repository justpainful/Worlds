import { useEffect, useRef, useState } from "react";
import {colorAlpha,colorParts} from "./ColorField";
const DEFAULT_COLORS = ["#202023", "#ffffff", "#ed3b35", "#f59e27", "#f5d742", "#47a467", "#2b82de", "#8954a9", "#dc5692", "#936540", "#37b4b8", "#a5a5a5"];
function RgbChannel({label,value,onValue}:{label:string;value:number;onValue:(value:number)=>void}){
  const [draft,setDraft]=useState<string|null>(null);
  const commit=()=>{if(draft!==null&&draft.trim()&&Number.isFinite(Number(draft)))onValue(Math.max(0,Math.min(255,Math.round(Number(draft)))));setDraft(null);};
  return <label>{label}<input type="number" min={0} max={255} step={1} inputMode="numeric" dir="ltr" value={draft??value} onChange={e=>{const next=e.target.value;setDraft(next);const n=Number(next);if(next.trim()&&Number.isFinite(n)&&n>=0&&n<=255)onValue(Math.round(n));}} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();commit();}else if(e.key==='Escape'){e.stopPropagation();setDraft(null);}}}/></label>;
}
export function DrawingColors({ color, background, recent, palette = [], arabic, onColor, onBackground }: { color: string; background: string; recent: string[]; palette?: string[]; arabic: boolean; onColor: (color: string) => void; onBackground: (color: string) => void }) {
  const [open, setOpen] = useState(false), [hex, setHex] = useState(color), root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => setHex(color), [color]);
  useEffect(() => { if (!open) return; const close = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener("pointerdown", close, true); return () => document.removeEventListener("pointerdown", close, true); }, [open]);
  useEffect(() => { if (open) (root.current?.querySelector<HTMLButtonElement>('.drawing-color-menu [aria-pressed="true"]') ?? root.current?.querySelector<HTMLButtonElement>('.drawing-color-menu button'))?.focus(); }, [open]);
  const parts=colorParts(color),rgb = [1, 3, 5].map((at) => parseInt(parts.rgb.slice(at, at + 2), 16));
  return <div className="drawing-colors" ref={root}>
    <input type="color" aria-label={arabic ? "لون الرسم" : "Paint color"} value={parts.rgb} onChange={(e) => onColor(colorAlpha(e.target.value,parts.alpha))} />
    <button ref={trigger} className="drawing-palette-trigger" aria-label={arabic ? "لوحة الألوان" : "Color palette"} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>⌄</button>
    {open && <div className="drawing-color-menu" role="dialog" aria-label={arabic ? "اختيار اللون" : "Choose color"} onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); e.stopPropagation(); } }}>
      <div className="drawing-color-swatches">{DEFAULT_COLORS.map((value) => <button key={value} style={{ backgroundColor: value }} aria-label={value} aria-pressed={value === color} onClick={() => onColor(value)} />)}</div>
      {palette.length > 0 && <><p>{arabic ? "اللوحة النشطة" : "Active palette"}</p><div className="drawing-color-swatches">{palette.map((value, i) => <button key={`${value}-${i}`} style={{ backgroundColor: value }} aria-label={`${arabic ? "لون اللوحة" : "Palette color"} ${value}`} aria-pressed={value === color} onClick={() => onColor(value)} />)}</div></>}
      <label>HEX<input dir="ltr" value={hex} maxLength={9} onChange={(e) => setHex(e.target.value)} onBlur={() => { if (/^#[\da-f]{6}([\da-f]{2})?$/i.test(hex)) onColor(hex.toLowerCase()); else setHex(color); }} onKeyDown={(e) => { if (e.key === "Enter" && /^#[\da-f]{6}([\da-f]{2})?$/i.test(hex)) onColor(hex.toLowerCase()); }} /></label>
      <div className="drawing-rgb">{["R", "G", "B"].map((label, index) => <RgbChannel key={label} label={label} value={rgb[index]} onValue={value=>{const next=[...rgb];next[index]=value;onColor(colorAlpha(`#${next.map(v=>v.toString(16).padStart(2,"0")).join("")}`,parts.alpha));}}/>)}</div>
      <label>{arabic?"شفافية اللون":"Color alpha"}<input type="range" min={0} max={100} value={Math.round(parts.alpha*100)} onChange={e=>onColor(colorAlpha(parts.rgb,Number(e.target.value)/100))}/><output>{Math.round(parts.alpha*100)}%</output></label>
      <label>{arabic ? "اللون الخلفي" : "Background color"}<input type="color" value={colorParts(background).rgb} onChange={(e) => onBackground(colorAlpha(e.target.value,colorParts(background).alpha))} /></label>
      <button className="drawing-swap-colors" onClick={() => { onBackground(color); onColor(background); }}>{arabic ? "تبديل اللونين" : "Swap colors"}</button>
      {recent.length > 0 && <><p>{arabic ? "آخر الألوان" : "Recent colors"}</p><div className="drawing-color-swatches">{recent.map((value) => <button key={value} style={{ backgroundColor: value }} aria-label={`${arabic ? "لون سابق" : "Recent color"} ${value}`} onClick={() => onColor(value)} />)}</div></>}
    </div>}
  </div>;
}
