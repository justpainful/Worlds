import { useEffect, useState } from "react";
import { Button } from "../ui/Button";
import type { DrawingScene, TextStyle } from "./model";
import { fontAvailable } from "./textLayout";

/** Lists text dependencies without copying or changing any installed font files. */
export function FontDependencies({ scenes, arabic, mode="project" }: { scenes: DrawingScene[]; arabic: boolean; mode?:"project"|"image" }) {
  const [missing,setMissing]=useState<string[]>([]),[checking,setChecking]=useState(false),[retry,setRetry]=useState(0);
  const styles=[...new Map(scenes.flatMap(scene=>Object.values(scene.nodes)).filter(node=>node.kind==="text").map(node=>[`${node.textStyle.font}\0${node.textStyle.weight}\0${node.textStyle.italic}`,node.textStyle])).values()];
  const key=JSON.stringify(styles);
  useEffect(()=>{
    const current=JSON.parse(key) as TextStyle[];let active=true;
    if(!current.length){setMissing([]);setChecking(false);return;}
    setChecking(true);setMissing([]);
    void Promise.all(current.map(async style=>({font:style.font,available:await fontAvailable(style).catch(()=>false)}))).then(rows=>{if(active)setMissing([...new Set(rows.filter(row=>!row.available).map(row=>row.font))]);}).finally(()=>{if(active)setChecking(false);});
    return()=>{active=false;};
  },[key,retry]);
  if(!styles.length)return null;
  const names=[...new Set(styles.map(style=>style.font))];
  return <section className="drawing-step" aria-label={arabic?"تبعيات الخطوط":"Font dependencies"}>
    <p>{arabic?"الخطوط في المصدر":"Fonts in the source"}: {names.join("، ")}</p>
    <p>{mode==="image"?(arabic?"تُرسم الصورة بالخط المتاح على هذا الجهاز، وقد تستخدم خطًا بديلًا إذا لم يتوفر. راجع ترخيص الخط قبل مشاركة الصورة؛ لا يتحقق التطبيق من الترخيص.":"The image is rendered with fonts available on this device and may use a fallback. Check the font license before sharing; the app cannot verify licensing."):(arabic?"يُحفظ اسم الخط وإعداداته دون تضمين ملف الخط. يحتاج المستلم إلى تثبيته بنفسه. راجع ترخيص كل خط قبل المشاركة؛ لا يمكن للتطبيق التحقق من الترخيص.":"Font names and settings are retained, but font files are not embedded. Recipients need to install them separately. Check each font's license before sharing; the app cannot verify licensing.")}</p>
    {checking?<p role="status">{arabic?"جارٍ فحص الخطوط":"Checking fonts"}</p>:missing.length>0&&<p role="status">{arabic?"تعذر تأكيد توفر هذه الخطوط وقد يظهر خط بديل":"These fonts could not be confirmed and may use a fallback"}: {missing.join("، ")} <Button size="compact" onClick={()=>setRetry(n=>n+1)}>{arabic?"إعادة الفحص":"Check again"}</Button></p>}
  </section>;
}
