import {Button} from "../ui/Button";
import {id,type Frame} from "./model";
export function GridControls({frame,arabic,onChange}:{frame:Frame;arabic:boolean;onChange:(fields:Partial<Frame>)=>void}){
 const t=(en:string,ar:string)=>arabic?ar:en,grid=frame.grid??{visible:false,size:20,snap:false},guides=frame.guides??[];
 return <section aria-label={t("Grid and guides","الشبكة والأدلة")}>
 <label className="drawing-check"><input type="checkbox" checked={grid.visible} onChange={e=>onChange({grid:{...grid,visible:e.target.checked}})}/>{t("Show grid","إظهار الشبكة")}</label><label className="drawing-check"><input type="checkbox" checked={grid.snap} onChange={e=>onChange({grid:{...grid,snap:e.target.checked}})}/>{t("Snap to grid, guides and objects","التقاط للشبكة والأدلة والعناصر")}</label>
 <label className="drawing-field"><span>{t("Grid spacing","تباعد الشبكة")}</span><input type="number" min={1} max={10000} value={grid.size} onChange={e=>{const size=e.target.valueAsNumber;if(size>=1&&size<=10000)onChange({grid:{...grid,size}});}}/></label>
 <p className="drawing-selection-help">{t("Hold Alt to bypass snapping. Guides use positions relative to this frame.","اضغط Alt لتجاوز الالتقاط. مواضع الأدلة محسوبة من بداية هذا الإطار.")}</p>
 {guides.map((guide,index)=><div className="drawing-guide-row" key={guide.id}><label><span>{t(`Guide ${index+1} axis`,`اتجاه الدليل ${index+1}`)}</span><select value={guide.axis} onChange={e=>onChange({guides:guides.map(g=>g.id===guide.id?{...g,axis:e.target.value as "x"|"y"}:g)})}><option value="x">{t("Vertical","رأسي")}</option><option value="y">{t("Horizontal","أفقي")}</option></select></label><label><span>{t(`Guide ${index+1} position`,`موضع الدليل ${index+1}`)}</span><input type="number" value={guide.at} onChange={e=>{const at=e.target.valueAsNumber;if(Number.isFinite(at)&&Math.abs(at)<=1e9)onChange({guides:guides.map(g=>g.id===guide.id?{...g,at}:g)});}}/></label><Button size="compact" onClick={()=>onChange({guides:guides.filter(g=>g.id!==guide.id)})}>{t("Remove guide","حذف الدليل")}</Button></div>)}
 <Button size="compact" disabled={guides.length>=128} onClick={()=>onChange({guides:[...guides,{id:id(),axis:"x",at:frame.w/2}]})}>{t("Add guide","إضافة دليل")}</Button>
 </section>;
}
